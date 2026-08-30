import { unzipSync } from 'fflate';

export const DOCUMENT_EXTRACTION_LIMITS = Object.freeze({
  maxFileBytes: 5_000_000,
  maxExtractedCharacters: 100_000,
  maxPdfPages: 50,
  maxDocxParagraphs: 5_000,
  maxXlsxSheets: 20,
  maxXlsxRowsPerSheet: 5_000,
  maxXlsxCells: 25_000,
  maxCellCharacters: 10_000,
  maxZipEntries: 1_000,
  maxZipExpansionBytes: 12_000_000,
  maxCompressionRatio: 100,
  timeoutMs: 8_000,
});

const TYPE_BY_EXTENSION = Object.freeze({ pdf: 'pdf', docx: 'docx', xlsx: 'xlsx' });
const MIME_BY_TYPE = Object.freeze({
  pdf: new Set(['application/pdf', 'application/octet-stream', '']),
  docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream', '']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream', '']),
});
const ACTIVE_PACKAGE_PATH = /(?:^|\/)(?:vbaproject\.bin|activex(?:\/|$)|embeddings(?:\/|$)|oleobject[^/]*)(?:$|\/)/i;

class ExtractionTimeoutError extends TypeError {}

const extensionFor = (name) => String(name || '').trim().toLowerCase().split('.').at(-1);
const normalizeBytes = (bytes) => bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
const decodeUtf8 = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const xmlEntity = (entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] || (entity.startsWith('#x') ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16)) : entity.startsWith('#') ? String.fromCodePoint(Number.parseInt(entity.slice(1), 10)) : `&${entity};`));
const decodeXml = (value) => String(value || '').replace(/&([a-z]+|#x[0-9a-f]+|#\d+);/gi, (_match, entity) => xmlEntity(entity));
const cleanText = (value) => decodeXml(String(value || '').replace(/<[^>]*>/g, '')).replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const attribute = (tag, name) => {
  const escaped = name.replace(':', '\\:');
  return tag.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find((value) => value !== undefined) ?? null;
};

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new ExtractionTimeoutError(`${label} exceeded the ${timeoutMs} ms extraction limit.`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function assertWithinDeadline(execution, label) {
  if (execution.now() > execution.deadline) throw new ExtractionTimeoutError(`${label} exceeded the ${execution.timeoutMs} ms extraction limit.`);
}

function remainingTime(execution, label) {
  assertWithinDeadline(execution, label);
  return Math.max(1, execution.deadline - execution.now());
}

function inspectZip(bytes, limits, execution) {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new TypeError('The Office document does not have a valid ZIP signature.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new TypeError('The Office document ZIP container is malformed.');
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new TypeError('ZIP64 Office documents are unsupported.');
  if (entries > limits.maxZipEntries || centralOffset + centralSize > bytes.length) throw new TypeError('The Office document exceeds the ZIP entry limit or has a malformed directory.');
  let offset = centralOffset;
  let expanded = 0;
  let compressed = 0;
  const names = [];
  for (let index = 0; index < entries; index += 1) {
    assertWithinDeadline(execution, 'Office document inspection');
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new TypeError('The Office document ZIP directory is malformed.');
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new TypeError('The Office document ZIP directory is malformed.');
    if (flags & 0x1) throw new TypeError('Encrypted Office packages are unsupported.');
    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new TypeError('The Office package contains an unsafe entry path.');
    names.push(name);
    compressed += compressedSize;
    expanded += expandedSize;
    offset = end;
  }
  if (expanded > limits.maxZipExpansionBytes) throw new TypeError('The Office document exceeds the ZIP expansion limit.');
  if (expanded / Math.max(1, compressed) > limits.maxCompressionRatio) throw new TypeError('The Office document exceeds the permitted compression ratio.');
  if (names.some((name) => ACTIVE_PACKAGE_PATH.test(name))) throw new TypeError('Office documents containing active or embedded content are unsupported.');
  return names;
}

function unzipOffice(bytes, limits, execution) {
  const names = inspectZip(bytes, limits, execution);
  try {
    const entries = unzipSync(bytes);
    assertWithinDeadline(execution, 'Office document decompression');
    return { entries, names };
  } catch (error) {
    if (error instanceof ExtractionTimeoutError) throw error;
    throw new TypeError('The Office document ZIP container is malformed.');
  }
}

function relationshipStats(entries, execution) {
  let externalLinksIgnored = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    assertWithinDeadline(execution, 'Office relationship inspection');
    if (!name.endsWith('.rels')) continue;
    externalLinksIgnored += [...decodeUtf8(bytes).matchAll(/<Relationship\b[^>]*\bTargetMode=(?:"External"|'External')[^>]*\/?\s*>/gi)].length;
  }
  return externalLinksIgnored;
}

function boundedSections(sections, limits, execution) {
  const accepted = [];
  let used = 0;
  for (const section of sections) {
    assertWithinDeadline(execution, 'Document text bounding');
    const text = cleanText(section.text).slice(0, limits.maxCellCharacters);
    if (!text || used >= limits.maxExtractedCharacters) continue;
    const remaining = limits.maxExtractedCharacters - used;
    const bounded = text.slice(0, remaining);
    accepted.push({ locator: section.locator, text: bounded });
    used += bounded.length;
  }
  if (!accepted.length) throw new TypeError('The document contains no extractable text.');
  return accepted;
}

function extractDocx(bytes, limits, execution) {
  const { entries } = unzipOffice(bytes, limits, execution);
  const documentBytes = entries['word/document.xml'];
  if (!documentBytes) throw new TypeError('The DOCX package is missing word/document.xml.');
  const xml = decodeUtf8(documentBytes);
  const paragraphs = [];
  for (const match of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi)) {
    assertWithinDeadline(execution, 'DOCX extraction');
    if (paragraphs.length >= limits.maxDocxParagraphs) throw new TypeError('The DOCX paragraph limit was exceeded.');
    const parts = [];
    for (const token of match[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?\s*>|<w:br\b[^>]*\/?\s*>/gi)) {
      assertWithinDeadline(execution, 'DOCX extraction');
      parts.push(token[1] === undefined ? ' ' : decodeXml(token[1]));
    }
    const text = cleanText(parts.join(''));
    if (text) paragraphs.push({ locator: `docx:paragraph:${paragraphs.length + 1}`, text });
  }
  const sections = boundedSections(paragraphs, limits, execution);
  return {
    detectedType: 'docx', sections,
    security: { macrosExecuted: false, embeddedObjectsExecuted: false, externalLinksIgnored: relationshipStats(entries, execution) },
  };
}

function parseSharedStrings(entries, execution) {
  const bytes = entries['xl/sharedStrings.xml'];
  if (!bytes) return [];
  const strings = [];
  for (const match of decodeUtf8(bytes).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    assertWithinDeadline(execution, 'XLSX shared-string extraction');
    strings.push(cleanText([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((token) => token[1]).join('')));
  }
  return strings;
}

function workbookSheets(entries, execution) {
  const workbook = entries['xl/workbook.xml'];
  const relationships = entries['xl/_rels/workbook.xml.rels'];
  if (!workbook || !relationships) throw new TypeError('The XLSX package is missing workbook metadata.');
  const targetById = new Map();
  for (const match of decodeUtf8(relationships).matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    assertWithinDeadline(execution, 'XLSX workbook inspection');
    const id = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');
    if (id && target && attribute(match[0], 'TargetMode') !== 'External') {
      const normalized = target.replaceAll('\\', '/').replace(/^\//, '');
      if (normalized.split('/').includes('..')) throw new TypeError('The XLSX workbook contains an unsafe worksheet path.');
      targetById.set(id, normalized.startsWith('xl/') ? normalized : `xl/${normalized}`);
    }
  }
  return [...decodeUtf8(workbook).matchAll(/<sheet\b[^>]*\/?\s*>/gi)].map((match) => ({
    name: decodeXml(attribute(match[0], 'name') || 'Sheet'),
    path: targetById.get(attribute(match[0], 'r:id')),
  })).filter((sheet) => sheet.path);
}

function extractXlsx(bytes, limits, execution) {
  const { entries } = unzipOffice(bytes, limits, execution);
  const sharedStrings = parseSharedStrings(entries, execution);
  const sheets = workbookSheets(entries, execution);
  if (sheets.length > limits.maxXlsxSheets) throw new TypeError('The XLSX sheet limit was exceeded.');
  const sections = [];
  let formulasIgnored = 0;
  for (const sheet of sheets) {
    assertWithinDeadline(execution, 'XLSX extraction');
    const sheetBytes = entries[sheet.path];
    if (!sheetBytes) throw new TypeError(`The XLSX package is missing ${sheet.path}.`);
    const xml = decodeUtf8(sheetBytes);
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)];
    if (rows.length > limits.maxXlsxRowsPerSheet) throw new TypeError('The XLSX row limit was exceeded.');
    for (const row of rows) {
      assertWithinDeadline(execution, 'XLSX extraction');
      for (const cell of row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/gi)) {
        assertWithinDeadline(execution, 'XLSX extraction');
        if (sections.length >= limits.maxXlsxCells) throw new TypeError('The XLSX cell limit was exceeded.');
        const ref = attribute(cell[0].slice(0, cell[0].indexOf('>') + 1), 'r');
        if (!ref || !/^[A-Z]{1,3}[1-9]\d{0,6}$/i.test(ref)) continue;
        const type = attribute(cell[0].slice(0, cell[0].indexOf('>') + 1), 't');
        if (/<f\b/i.test(cell[1])) formulasIgnored += 1;
        const inline = cell[1].match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1];
        const rawValue = cell[1].match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
        let value = inline ? [...inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join('') : decodeXml(rawValue || '');
        if (type === 's' && /^\d+$/.test(value)) value = sharedStrings[Number(value)] ?? '';
        const text = cleanText(value).slice(0, limits.maxCellCharacters);
        if (text) sections.push({ locator: `xlsx:sheet:'${sheet.name.replaceAll("'", "''")}'!${ref.toUpperCase()}`, text });
      }
    }
  }
  const bounded = boundedSections(sections, limits, execution);
  return {
    detectedType: 'xlsx', sections: bounded,
    security: { formulasEvaluated: false, formulasIgnored, macrosExecuted: false, embeddedObjectsExecuted: false, externalLinksIgnored: relationshipStats(entries, execution) },
  };
}

async function defaultPdfLoader(options) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return getDocument(options).promise;
}

async function extractPdf(bytes, limits, execution, pdfLoader = defaultPdfLoader) {
  const signature = decodeUtf8(bytes.subarray(0, 5));
  if (signature !== '%PDF-') throw new TypeError('The PDF file signature does not match its extension.');
  let document;
  try {
    document = await withTimeout(Promise.resolve(pdfLoader({ data: bytes.slice(), isEvalSupported: false, stopAtErrors: true, disableFontFace: true, useSystemFonts: true })), remainingTime(execution, 'PDF loading'), 'PDF loading');
  } catch (error) {
    if (error instanceof ExtractionTimeoutError) throw error;
    if (error?.name === 'PasswordException' || /password|encrypted/i.test(error?.message || '')) throw new TypeError('Encrypted or password-protected PDFs are unsupported.');
    throw new TypeError('The PDF is malformed or could not be safely parsed.');
  }
  try {
    if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new TypeError('The PDF contains no readable pages.');
    if (document.numPages > limits.maxPdfPages) throw new TypeError('The PDF page limit was exceeded.');
    const sections = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await withTimeout(document.getPage(pageNumber), remainingTime(execution, `PDF page ${pageNumber}`), `PDF page ${pageNumber}`);
      const content = await withTimeout(page.getTextContent({ disableNormalization: false }), remainingTime(execution, `PDF page ${pageNumber}`), `PDF page ${pageNumber}`);
      const text = cleanText((content.items || []).map((item) => typeof item?.str === 'string' ? item.str : '').join(' '));
      if (text) sections.push({ locator: `pdf:page:${pageNumber}`, text });
    }
    return { detectedType: 'pdf', sections: boundedSections(sections, limits, execution), security: { scriptsExecuted: false, formsSubmitted: false, linksFetched: false, embeddedObjectsExecuted: false } };
  } finally {
    await document.destroy?.();
  }
}

export async function extractResearchDocument({ name, bytes: inputBytes, declaredMime = '', pdfLoader, limits: limitOverrides = {}, now = Date.now }) {
  const limits = Object.freeze({ ...DOCUMENT_EXTRACTION_LIMITS, ...limitOverrides });
  const startedAt = now();
  const execution = Object.freeze({ now, deadline: startedAt + limits.timeoutMs, timeoutMs: limits.timeoutMs });
  const bytes = normalizeBytes(inputBytes);
  const detectedType = TYPE_BY_EXTENSION[extensionFor(name)];
  if (!detectedType) throw new TypeError('Upload a PDF, DOCX, or XLSX document.');
  if (!bytes || !bytes.length) throw new TypeError('The document is empty or unreadable.');
  if (bytes.length > limits.maxFileBytes) throw new TypeError(`The document exceeds the ${limits.maxFileBytes} byte limit.`);
  const mime = String(declaredMime || '').trim().toLowerCase();
  if (!MIME_BY_TYPE[detectedType].has(mime)) throw new TypeError('The document MIME type does not match its extension.');
  const extracted = detectedType === 'pdf' ? await extractPdf(bytes, limits, execution, pdfLoader) : detectedType === 'docx' ? extractDocx(bytes, limits, execution) : extractXlsx(bytes, limits, execution);
  const extractedText = extracted.sections.map((section) => `[${section.locator}] ${section.text}`).join('\n');
  const extractedCharacterCount = extracted.sections.reduce((sum, section) => sum + section.text.length, 0);
  return {
    extractionVersion: 'research-document-extraction-v1',
    detectedType: extracted.detectedType,
    originalByteCount: bytes.length,
    extractedCharacterCount,
    truncated: extractedCharacterCount >= limits.maxExtractedCharacters,
    sections: extracted.sections,
    extractedText,
    security: extracted.security,
  };
}

export async function extractResearchDocumentFile(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Choose a readable PDF, DOCX, or XLSX file.');
  if (Number.isFinite(file.size) && file.size > (options.limits?.maxFileBytes ?? DOCUMENT_EXTRACTION_LIMITS.maxFileBytes)) {
    throw new TypeError(`The document exceeds the ${options.limits?.maxFileBytes ?? DOCUMENT_EXTRACTION_LIMITS.maxFileBytes} byte limit.`);
  }
  return extractResearchDocument({ name: file.name, bytes: await file.arrayBuffer(), declaredMime: file.type || '', ...options });
}
