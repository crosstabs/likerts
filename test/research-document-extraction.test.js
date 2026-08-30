import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  DOCUMENT_EXTRACTION_LIMITS,
  extractResearchDocument,
} from '../src/lib/researchDocumentExtraction.js';

const zipped = (entries) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(pdf);
}

test('DOCX extraction preserves paragraph locators and ignores relationships and embedded instructions', async () => {
  const bytes = zipped({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>First finding</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; qualified finding</w:t></w:r></w:p></w:body></w:document>',
    'word/_rels/document.xml.rels': '<Relationships><Relationship Target="https://attacker.invalid/instructions" TargetMode="External"/></Relationships>',
  });

  const extracted = await extractResearchDocument({ name: 'study.docx', bytes, declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(extracted.detectedType, 'docx');
  assert.deepEqual(extracted.sections.map(({ locator, text }) => ({ locator, text })), [
    { locator: 'docx:paragraph:1', text: 'First finding' },
    { locator: 'docx:paragraph:2', text: 'Second & qualified finding' },
  ]);
  assert.equal(extracted.security.externalLinksIgnored, 1);
  assert.equal(extracted.security.embeddedObjectsExecuted, false);
  assert.match(extracted.extractedText, /First finding/);
  assert.doesNotMatch(extracted.extractedText, /attacker\.invalid/);
});

test('XLSX extraction preserves sheet/cell coordinates and never evaluates formulas', async () => {
  const bytes = zipped({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Evidence" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Segment</t></si><si><t>Concern</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Urban</t></is></c><c r="B2"><f>WEBSERVICE("https://attacker.invalid")</f><v>42</v></c></row></sheetData></worksheet>',
  });

  const extracted = await extractResearchDocument({ name: 'evidence.xlsx', bytes, declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.equal(extracted.detectedType, 'xlsx');
  assert.deepEqual(extracted.sections.map(({ locator, text }) => ({ locator, text })), [
    { locator: "xlsx:sheet:'Evidence'!A1", text: 'Segment' },
    { locator: "xlsx:sheet:'Evidence'!B1", text: 'Concern' },
    { locator: "xlsx:sheet:'Evidence'!A2", text: 'Urban' },
    { locator: "xlsx:sheet:'Evidence'!B2", text: '42' },
  ]);
  assert.equal(extracted.security.formulasEvaluated, false);
  assert.equal(extracted.security.formulasIgnored, 1);
  assert.doesNotMatch(extracted.extractedText, /WEBSERVICE|attacker\.invalid/);
});

test('PDF extraction passes fail-closed options, preserves page locators, and rejects encrypted files', async () => {
  let receivedOptions;
  const pdfLoader = async (options) => {
    receivedOptions = options;
    return {
      numPages: 2,
      async getPage(pageNumber) {
        return { async getTextContent() { return { items: [{ str: `Page ${pageNumber}` }, { str: 'evidence' }] }; } };
      },
      async destroy() {},
    };
  };
  const extracted = await extractResearchDocument({ name: 'report.pdf', bytes: strToU8('%PDF-1.7\nfixture'), declaredMime: 'application/pdf', pdfLoader });
  assert.equal(receivedOptions.isEvalSupported, false);
  assert.equal(receivedOptions.stopAtErrors, true);
  assert.equal(extracted.sections[0].locator, 'pdf:page:1');
  assert.equal(extracted.sections[1].text, 'Page 2 evidence');

  await assert.rejects(
    () => extractResearchDocument({ name: 'locked.pdf', bytes: strToU8('%PDF-1.7\nfixture'), pdfLoader: async () => { const error = new Error('Password required'); error.name = 'PasswordException'; throw error; } }),
    /encrypted or password-protected/i,
  );
});

test('the production PDF.js adapter extracts a real bounded PDF without evaluating embedded JavaScript', async () => {
  const extracted = await extractResearchDocument({ name: 'real.pdf', bytes: minimalPdf('Population frame evidence'), declaredMime: 'application/pdf' });
  assert.equal(extracted.sections[0].locator, 'pdf:page:1');
  assert.match(extracted.sections[0].text, /Population frame evidence/);
  assert.equal(extracted.security.scriptsExecuted, false);
});

test('document extraction rejects extension/MIME mismatches, macros, malformed archives, and unsafe expansion', async () => {
  await assert.rejects(() => extractResearchDocument({ name: 'fake.pdf', bytes: zipped({ 'word/document.xml': '<w:p/>' }), declaredMime: 'application/pdf' }), /signature/i);
  await assert.rejects(() => extractResearchDocument({ name: 'macro.docx', bytes: zipped({ 'word/document.xml': '<w:p><w:t>text</w:t></w:p>', 'word/vbaProject.bin': 'macro' }) }), /active or embedded content/i);
  await assert.rejects(() => extractResearchDocument({ name: 'bad.docx', bytes: strToU8('not a zip') }), /ZIP signature|malformed/i);
  const oversizedXml = `<w:document><w:p><w:t>${'A'.repeat(DOCUMENT_EXTRACTION_LIMITS.maxZipExpansionBytes + 1)}</w:t></w:p></w:document>`;
  await assert.rejects(() => extractResearchDocument({ name: 'bomb.docx', bytes: zipped({ 'word/document.xml': oversizedXml }) }), /expansion limit|compression ratio/i);
});

test('extracted character counts exclude locator markup and stay within the configured text bound', async () => {
  const bytes = zipped({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>1234567890</w:t></w:r></w:p></w:body></w:document>',
  });
  const extracted = await extractResearchDocument({
    name: 'bounded.docx',
    bytes,
    limits: { maxExtractedCharacters: 10 },
  });
  assert.equal(extracted.extractedCharacterCount, 10);
  assert.ok(extracted.extractedText.length > extracted.extractedCharacterCount);
  assert.equal(extracted.truncated, true);
});

test('Office extraction enforces one total time budget across inspection and parsing', async () => {
  const bytes = zipped({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Bounded text</w:t></w:r></w:p></w:body></w:document>',
  });
  let tick = 0;
  await assert.rejects(() => extractResearchDocument({
    name: 'slow.docx',
    bytes,
    limits: { timeoutMs: 2 },
    now: () => tick++,
  }), /extraction limit/i);
});
