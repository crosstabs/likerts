import { DOCUMENT_EXTRACTION_LIMITS, extractResearchDocument } from './researchDocumentExtraction.js';
import { buildResearchRetrievalIndex, retrieveResearchChunks } from './researchRetrieval.js';

export const MAX_RESEARCH_MATERIALS = 4;
export const MAX_RESEARCH_MATERIAL_CHARACTERS = 100_000;
export const MAX_RESEARCH_EXCERPT_CHARACTERS = 2_000;
export const RESEARCH_MATERIAL_BOUNDARY = 'Your research materials are unverified grounding—not human validation.';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);
const SOURCE_KINDS = new Set(['UPLOADED_TEXT', 'UPLOADED_DOCUMENT', 'PASTED_TEXT']);

function extensionFor(name) {
  const pieces = String(name || '').trim().toLowerCase().split('.');
  return pieces.length > 1 ? pieces.at(-1) : '';
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createResearchMaterial({ name, text, language, sourceKind, declaredMime = null }) {
  const title = String(name || '').trim().slice(0, 180);
  const rawText = String(text || '');
  if (!title) throw new TypeError('Research material requires a filename or title.');
  if (!SOURCE_KINDS.has(sourceKind)) throw new TypeError('Research material source kind is unsupported.');
  if (sourceKind === 'UPLOADED_TEXT' && !TEXT_EXTENSIONS.has(extensionFor(title))) throw new TypeError('Upload a txt, md, csv, or json file.');
  if (sourceKind === 'UPLOADED_DOCUMENT') throw new TypeError('Use bounded document extraction for PDF, DOCX, and XLSX files.');
  if (!rawText.trim()) throw new TypeError('Research material is empty.');
  if (rawText.length > MAX_RESEARCH_MATERIAL_CHARACTERS) throw new TypeError(`Research material is too large. The limit is ${MAX_RESEARCH_MATERIAL_CHARACTERS.toLocaleString()} characters.`);
  if (rawText.includes('\0')) throw new TypeError('Research material must be plain text and cannot contain NUL bytes.');
  const excerpt = rawText.trim().slice(0, MAX_RESEARCH_EXCERPT_CHARACTERS);
  const detectedType = sourceKind === 'UPLOADED_TEXT' ? extensionFor(title) : 'plain-text';
  return {
    id: `material-${(await sha256(`${title}\n${rawText}`)).slice(0, 20)}`,
    title,
    excerpt,
    language: language || null,
    sourceKind,
    contentHandling: 'BOUNDED_RAW_TEXT',
    detectedType,
    declaredMime: declaredMime || null,
    contentHash: await sha256(rawText),
    originalCharacterCount: rawText.length,
    truncated: rawText.trim().length > excerpt.length,
  };
}

export async function createExtractedResearchMaterial({ name, fileBytes, extraction, language, declaredMime = null }) {
  const title = String(name || '').trim().slice(0, 180);
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  if (!title || !DOCUMENT_EXTENSIONS.has(extensionFor(title))) throw new TypeError('Upload a PDF, DOCX, or XLSX document.');
  if (!extraction?.sections?.length || !extraction.extractedText?.trim()) throw new TypeError('The document contains no bounded extracted text.');
  const contentHash = await sha256(bytes);
  const extractedTextHash = await sha256(extraction.extractedText);
  const excerpt = extraction.extractedText.trim().slice(0, MAX_RESEARCH_EXCERPT_CHARACTERS);
  const locators = await Promise.all(extraction.sections.slice(0, 20).map(async (section) => ({ locator: section.locator, textHash: await sha256(section.text), characterCount: section.text.length })));
  return {
    id: `material-${(await sha256(`${title}\n${contentHash}`)).slice(0, 20)}`,
    title,
    excerpt,
    language: language || null,
    sourceKind: 'UPLOADED_DOCUMENT',
    contentHandling: 'BOUNDED_EXTRACTED_TEXT',
    detectedType: extraction.detectedType,
    declaredMime: declaredMime || null,
    contentHash,
    extractedTextHash,
    extractionVersion: extraction.extractionVersion,
    originalByteCount: bytes.length,
    originalCharacterCount: extraction.extractedCharacterCount,
    truncated: Boolean(extraction.truncated || extraction.extractedText.trim().length > excerpt.length),
    sections: extraction.sections,
    locators,
    security: extraction.security,
  };
}

export async function readResearchMaterialFile(file, language) {
  if (!file) throw new TypeError('Choose a readable research file.');
  const extension = extensionFor(file.name);
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    if (typeof file.arrayBuffer !== 'function') throw new TypeError('Choose a readable PDF, DOCX, or XLSX file.');
    if (Number.isFinite(file.size) && file.size > DOCUMENT_EXTRACTION_LIMITS.maxFileBytes) {
      throw new TypeError(`The document exceeds the ${DOCUMENT_EXTRACTION_LIMITS.maxFileBytes} byte limit.`);
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const extraction = await extractResearchDocument({ name: file.name, bytes: fileBytes, declaredMime: file.type || '' });
    return createExtractedResearchMaterial({ name: file.name, fileBytes, extraction, language, declaredMime: file.type || null });
  }
  if (!TEXT_EXTENSIONS.has(extension) || typeof file.text !== 'function') throw new TypeError('Upload a txt, md, csv, json, PDF, DOCX, or XLSX file.');
  if (Number.isFinite(file.size) && file.size > MAX_RESEARCH_MATERIAL_CHARACTERS * 4) throw new TypeError('Research material is too large. Use a text file below 400 KB.');
  return createResearchMaterial({ name: file.name, text: await file.text(), language, sourceKind: 'UPLOADED_TEXT', declaredMime: file.type || null });
}

export function mergeResearchMaterials(existingMaterials = [], candidateMaterials = []) {
  const merged = [];
  const seenHashes = new Set();
  for (const material of [...existingMaterials, ...candidateMaterials]) {
    if (!material?.contentHash || seenHashes.has(material.contentHash)) continue;
    seenHashes.add(material.contentHash);
    merged.push(material);
    if (merged.length >= MAX_RESEARCH_MATERIALS) break;
  }
  return merged;
}

export function researchMaterialEvidence(materials = []) {
  if (!Array.isArray(materials) || materials.length > MAX_RESEARCH_MATERIALS) throw new TypeError('Add up to four research materials.');
  return materials.map((material) => ({
    clientMaterialId: material.id,
    title: material.title,
    excerpt: material.excerpt,
    ...(material.language ? { language: material.language } : {}),
    sourceKind: material.sourceKind,
    contentHandling: material.contentHandling,
    detectedType: material.detectedType,
    ...(material.declaredMime ? { declaredMime: material.declaredMime } : {}),
    clientContentHash: material.contentHash,
    originalCharacterCount: material.originalCharacterCount,
    truncated: Boolean(material.truncated),
    ...(material.sourceKind === 'UPLOADED_DOCUMENT' ? {
      extractionVersion: material.extractionVersion,
      extractedTextHash: material.extractedTextHash,
      originalByteCount: material.originalByteCount,
      locators: material.locators,
    } : {}),
  }));
}

export async function prepareResearchMaterialEvidence(materials = [], query = '') {
  const baseEntries = researchMaterialEvidence(materials);
  return Promise.all(materials.map(async (material, index) => {
    const retrievalMaterial = material.sections?.length ? material : { ...material, sections: [{ locator: 'excerpt:1', text: material.excerpt }] };
    const retrievalIndex = await buildResearchRetrievalIndex([retrievalMaterial]);
    const chunks = retrieveResearchChunks(retrievalIndex, query, { topK: 3, maxCharacters: 1_800 });
    const selected = chunks.length ? chunks : retrievalIndex.chunks.slice(0, 1).map((chunk) => ({ ...chunk, score: 0, retrievalTruncated: false }));
    const excerpt = selected.map((chunk) => `[${chunk.locator}] ${chunk.text}`).join('\n').slice(0, MAX_RESEARCH_EXCERPT_CHARACTERS);
    return {
      ...baseEntries[index],
      excerpt: excerpt || baseEntries[index].excerpt,
      retrievalVersion: retrievalIndex.version,
      retrievalIndexHash: retrievalIndex.indexHash,
      retrievedChunkIds: selected.map((chunk) => chunk.chunkId),
    };
  }));
}

export function researchGroundingManifest(materials = []) {
  return {
    version: 'research-grounding-v1',
    boundary: RESEARCH_MATERIAL_BOUNDARY,
    materialCount: materials.length,
    materials: materials.map(({ id, title, sourceKind, contentHandling, detectedType, declaredMime, contentHash, extractedTextHash, extractionVersion, originalByteCount, originalCharacterCount, truncated, language, locators }) => ({ id, title, sourceKind, contentHandling, detectedType, declaredMime: declaredMime || null, contentHash, extractedTextHash: extractedTextHash || null, extractionVersion: extractionVersion || null, originalByteCount: originalByteCount || null, originalCharacterCount, truncated, language: language || null, locators: locators || [] })),
  };
}

export function restoreResearchMaterialsFromEvidence(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry
    && SOURCE_KINDS.has(entry.sourceKind)
    && /^material-[a-f0-9]{20}$/.test(entry.clientMaterialId || '')
    && /^[a-f0-9]{64}$/.test(entry.clientContentHash || '')
    && typeof entry.excerpt === 'string'
    && Number.isInteger(entry.originalCharacterCount))
    .slice(0, MAX_RESEARCH_MATERIALS)
    .map((entry) => ({
      id: entry.clientMaterialId,
      title: String(entry.claim || entry.sourceTitle || entry.title || 'Research material').slice(0, 180),
      excerpt: entry.excerpt.slice(0, MAX_RESEARCH_EXCERPT_CHARACTERS),
      language: entry.originalLanguage || entry.language || null,
      sourceKind: entry.sourceKind,
      contentHandling: entry.sourceKind === 'UPLOADED_DOCUMENT' ? 'BOUNDED_EXTRACTED_TEXT' : 'BOUNDED_RAW_TEXT',
      detectedType: entry.detectedType || (entry.sourceKind === 'PASTED_TEXT' ? 'plain-text' : extensionFor(entry.claim || entry.sourceTitle || entry.title)),
      declaredMime: entry.declaredMime || null,
      contentHash: entry.clientContentHash,
      originalCharacterCount: entry.originalCharacterCount,
      truncated: Boolean(entry.truncated),
      ...(entry.sourceKind === 'UPLOADED_DOCUMENT' ? {
        extractedTextHash: entry.extractedTextHash,
        extractionVersion: entry.extractionVersion,
        originalByteCount: entry.originalByteCount,
        locators: Array.isArray(entry.locators) ? entry.locators.slice(0, 20) : [],
        sections: [{ locator: entry.locators?.[0]?.locator || 'restored:excerpt:1', text: entry.excerpt.slice(0, MAX_RESEARCH_EXCERPT_CHARACTERS) }],
      } : {}),
    }));
}
