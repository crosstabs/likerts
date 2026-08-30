import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClaimEvidenceLedger,
  buildGroundingPacket,
  buildResearchRetrievalIndex,
  retrieveResearchChunks,
} from '../src/lib/researchRetrieval.js';

const materials = [
  {
    id: 'material-aaaaaaaaaaaaaaaaaaaa', title: 'Field notes.docx', language: 'en-US', sourceKind: 'UPLOADED_DOCUMENT', contentHash: 'a'.repeat(64),
    sections: [
      { locator: 'docx:paragraph:1', text: 'Urban apartment residents frequently raised installation approval as a concern.' },
      { locator: 'docx:paragraph:2', text: 'Price was mentioned, but the evidence does not measure willingness to pay.' },
    ],
  },
  {
    id: 'material-bbbbbbbbbbbbbbbbbbbb', title: 'Duplicate.txt', language: 'en-US', sourceKind: 'UPLOADED_TEXT', contentHash: 'b'.repeat(64),
    sections: [{ locator: 'text:line:1', text: 'Urban apartment residents frequently raised installation approval as a concern.' }],
  },
];

test('retrieval indexing is deterministic, locator-preserving, and exact-deduplicated', async () => {
  const left = await buildResearchRetrievalIndex(materials, { chunkCharacters: 90 });
  const right = await buildResearchRetrievalIndex(structuredClone(materials), { chunkCharacters: 90 });
  assert.deepEqual(left, right);
  assert.equal(left.chunks.filter((chunk) => /installation approval/.test(chunk.text)).length, 1);
  assert.equal(left.chunks[0].materialId, materials[0].id);
  assert.match(left.chunks[0].chunkHash, /^[a-f0-9]{64}$/);
  assert.ok(left.chunks.every((chunk) => chunk.locator && Number.isInteger(chunk.characterStart) && Number.isInteger(chunk.characterEnd)));
});

test('retrieval uses stable scoring and hard top-k/context budgets', async () => {
  const index = await buildResearchRetrievalIndex(materials, { chunkCharacters: 90 });
  const first = retrieveResearchChunks(index, 'installation approval apartment', { topK: 1, maxCharacters: 100 });
  const second = retrieveResearchChunks(index, 'installation approval apartment', { topK: 1, maxCharacters: 100 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.match(first[0].text, /installation approval/);
  assert.ok(first[0].text.length <= 100);
});

test('grounding packet treats content as untrusted data and claim ledger cannot turn a URL or hash into validation', async () => {
  const index = await buildResearchRetrievalIndex(materials);
  const chunks = retrieveResearchChunks(index, 'installation approval');
  const packet = buildGroundingPacket(chunks);
  assert.equal(packet.instructionsFromSourcesAllowed, false);
  assert.match(packet.boundary, /untrusted data/i);
  assert.ok(packet.chunks.every((chunk) => !('url' in chunk)));

  const ledger = buildClaimEvidenceLedger({
    claims: [
      { claimId: 'c1', text: 'Approval is a reported concern.', evidenceChunkIds: [chunks[0].chunkId] },
      { claimId: 'c2', text: 'Most people will purchase.', evidenceChunkIds: [] },
    ],
    chunks,
  });
  assert.equal(ledger.claims[0].evidenceClass, 'UPLOADED_GROUNDING');
  assert.equal(ledger.claims[0].validationStatus, 'UNVALIDATED');
  assert.equal(ledger.claims[1].evidenceClass, 'MODEL_INFERENCE');
  assert.equal(ledger.claims[1].validationStatus, 'UNVALIDATED');
  assert.throws(() => buildClaimEvidenceLedger({ claims: [{ claimId: 'bad', text: 'Claim', evidenceChunkIds: ['missing'] }], chunks }), /unknown evidence chunk/i);
});
