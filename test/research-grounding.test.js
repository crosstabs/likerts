import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  MAX_RESEARCH_MATERIAL_CHARACTERS,
  MAX_RESEARCH_MATERIALS,
  createResearchMaterial,
  mergeResearchMaterials,
  researchMaterialEvidence,
  restoreResearchMaterialsFromEvidence,
  readResearchMaterialFile,
  prepareResearchMaterialEvidence,
} from '../src/lib/researchGrounding.js';

test('research materials are bounded, hashed, and converted to explicit unverified evidence records', async () => {
  const material = await createResearchMaterial({
    name: 'customer-study.csv',
    text: `segment,objection\nsmall business,setup time${' context'.repeat(400)}`,
    language: 'en-US',
    sourceKind: 'UPLOADED_TEXT',
  });

  assert.equal(material.title, 'customer-study.csv');
  assert.equal(material.sourceKind, 'UPLOADED_TEXT');
  assert.equal(material.contentHandling, 'BOUNDED_RAW_TEXT');
  assert.equal(material.detectedType, 'csv');
  assert.equal(material.excerpt.length, 2_000);
  assert.equal(material.truncated, true);
  assert.match(material.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(material.originalCharacterCount > material.excerpt.length);
  assert.deepEqual(researchMaterialEvidence([material]), [{
    clientMaterialId: material.id,
    title: material.title,
    excerpt: material.excerpt,
    language: 'en-US',
    sourceKind: 'UPLOADED_TEXT',
    contentHandling: 'BOUNDED_RAW_TEXT',
    detectedType: 'csv',
    clientContentHash: material.contentHash,
    originalCharacterCount: material.originalCharacterCount,
    truncated: true,
  }]);
});

test('research material limits reject empty, oversized, unsupported, and excessive inputs', async () => {
  await assert.rejects(() => createResearchMaterial({ name: 'empty.txt', text: '   ', sourceKind: 'UPLOADED_TEXT' }), /empty/i);
  await assert.rejects(() => createResearchMaterial({ name: 'malware.exe', text: 'not really text', sourceKind: 'UPLOADED_TEXT' }), /txt, md, csv, or json/i);
  await assert.rejects(() => createResearchMaterial({ name: 'large.txt', text: 'x'.repeat(MAX_RESEARCH_MATERIAL_CHARACTERS + 1), sourceKind: 'UPLOADED_TEXT' }), /too large/i);
  await assert.rejects(() => createResearchMaterial({ name: 'binary.txt', text: 'plain\0binary', sourceKind: 'UPLOADED_TEXT' }), /NUL bytes/i);
  assert.throws(() => researchMaterialEvidence(Array.from({ length: MAX_RESEARCH_MATERIALS + 1 }, (_, index) => ({ title: `file-${index}.txt`, excerpt: 'text', sourceKind: 'UPLOADED_TEXT' }))), /up to four/i);
});

test('pasted text receives a distinct source kind and never invents a public URL', async () => {
  const material = await createResearchMaterial({ name: 'Pasted research excerpt', text: 'Observed interview notes supplied by the user.', sourceKind: 'PASTED_TEXT' });
  const [evidence] = researchMaterialEvidence([material]);
  assert.equal(evidence.sourceKind, 'PASTED_TEXT');
  assert.equal('url' in evidence, false);
});

test('research material merging deduplicates same-batch uploads by content hash before enforcing the four-material cap', async () => {
  const existing = await createResearchMaterial({ name: 'existing.txt', text: 'Existing grounded context.', sourceKind: 'UPLOADED_TEXT' });
  const duplicate = await createResearchMaterial({ name: 'renamed-existing.txt', text: 'Existing grounded context.', sourceKind: 'UPLOADED_TEXT' });
  const additions = await Promise.all(['first', 'second', 'third', 'fourth'].map((name) => createResearchMaterial({
    name: `${name}.txt`,
    text: `${name} independent grounded context.`,
    sourceKind: 'UPLOADED_TEXT',
  })));

  const merged = mergeResearchMaterials([existing], [duplicate, ...additions, duplicate]);

  assert.deepEqual(merged.map((material) => material.contentHash), [existing, ...additions.slice(0, 3)].map((material) => material.contentHash));
  assert.equal(merged.length, MAX_RESEARCH_MATERIALS);
});

test('composer upload flow deduplicates accepted files before warning about the material cap', async () => {
  const composer = await readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8');

  assert.match(composer, /mergeResearchMaterials\(materials, accepted\)/);
  assert.match(composer, /newUniqueCount/);
  assert.doesNotMatch(composer, /materials\.length \+ files\.length > MAX_RESEARCH_MATERIALS/);
});

test('a locally saved bounded excerpt restores replay grounding without reconstructing raw files', async () => {
  const material = await createResearchMaterial({ name: 'notes.txt', text: 'Bounded locally saved context.', language: 'en-US', sourceKind: 'UPLOADED_TEXT' });
  const [restored] = restoreResearchMaterialsFromEvidence([{ clientMaterialId: material.id, clientContentHash: material.contentHash, claim: material.title, excerpt: material.excerpt, originalLanguage: material.language, originalCharacterCount: material.originalCharacterCount, sourceKind: material.sourceKind, contentHandling: material.contentHandling, detectedType: material.detectedType, truncated: material.truncated }]);
  assert.deepEqual(researchMaterialEvidence([restored]), researchMaterialEvidence([material]));
  assert.deepEqual(restoreResearchMaterialsFromEvidence([{ sourceKind: 'UPLOADED_TEXT', excerpt: 'missing lineage' }]), []);
});

test('an Office upload retains bounded extraction lineage and never sends raw file bytes as evidence', async () => {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Grounded finding</w:t></w:r></w:p></w:body></w:document>'),
  });
  const file = {
    name: 'research.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
  const material = await readResearchMaterialFile(file, 'en-US');
  const [evidence] = researchMaterialEvidence([material]);
  assert.equal(material.sourceKind, 'UPLOADED_DOCUMENT');
  assert.equal(material.contentHandling, 'BOUNDED_EXTRACTED_TEXT');
  assert.equal(evidence.extractionVersion, 'research-document-extraction-v1');
  assert.equal(evidence.originalByteCount, bytes.length);
  assert.match(evidence.extractedTextHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.locators[0].locator, 'docx:paragraph:1');
  assert.equal('sections' in evidence, false);
  assert.equal('fileBytes' in evidence, false);
});

test('an oversized document is rejected from metadata before its bytes are read', async () => {
  let read = false;
  await assert.rejects(() => readResearchMaterialFile({
    name: 'oversized.pdf',
    type: 'application/pdf',
    size: 5_000_001,
    async arrayBuffer() { read = true; return new ArrayBuffer(0); },
  }, 'en-US'), /byte limit/i);
  assert.equal(read, false);
});

test('prompt evidence uses deterministic query retrieval with versioned chunk lineage', async () => {
  const material = await createResearchMaterial({ name: 'notes.txt', text: 'Installation approval is a concern. Price is secondary.', language: 'en-US', sourceKind: 'UPLOADED_TEXT' });
  const first = await prepareResearchMaterialEvidence([material], 'installation approval');
  const second = await prepareResearchMaterialEvidence([material], 'installation approval');
  assert.deepEqual(first, second);
  assert.equal(first[0].retrievalVersion, 'research-retrieval-index-v1');
  assert.match(first[0].retrievalIndexHash, /^[a-f0-9]{64}$/);
  assert.match(first[0].retrievedChunkIds[0], /^chunk-[a-f0-9]{24}$/);
  assert.match(first[0].excerpt, /\[excerpt:1\].*Installation approval/);
});
