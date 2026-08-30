import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQualitativeRunRecord,
  buildQualitativeProjectPresentationEnvelope,
  conversationRecordFromState,
  conversationStateFromRecord,
  createProjectMutationQueue,
  createQualitativeProjectDescriptor,
  qualitativeConversationsFromProject,
  qualitativeProjectStats,
  validateQualitativeProjectImport,
} from '../src/lib/qualitativeProjects.js';
import { createMemoryProjectStore, hashProjectExportPayload } from '../src/lib/projectStore.js';
import { sampleStudies } from '../content/sample-studies.mjs';
import { canonicalSampleLineageForSample } from '../server/sample-lineage.js';

const study = Object.freeze({ prompt: 'Will operators adopt this workflow?', researchMethod: 'CONCEPT_TEST' });
const result = Object.freeze({
  researchDesign: { methodId: 'CONCEPT_TEST', segmentPerspectiveEligible: true },
  meta: {
    studyId: 'study_1',
    runId: 'run_1',
    inputHash: 'a'.repeat(64),
    hashes: { populationFrame: 'b'.repeat(64) },
  },
});

test('qualitative conversation records round-trip full answer metadata and safe defaults', () => {
  const record = conversationRecordFromState('qualitative_project_study_1_run_1', result, 'segment_1', {
    conversationId: 'conversation_1',
    turns: [{
      question: 'What objection is most likely?',
      intent: 'OBJECTION',
      response: {
        turnId: 'turn_1',
        answer: 'The strongest modeled objection is implementation overhead.',
        basisSummary: 'This answer leans on the uploaded onboarding notes and the explicit setup-risk assumption.',
        evidenceUsed: [{ id: 'evidence_1', title: 'Onboarding notes', url: 'https://example.com/notes', excerpt: 'Implementation takes coordination.', originalLanguage: 'en', evidenceClass: 'PROVIDED_SOURCE' }],
        assumptionsUsed: [{ id: 'assumption_1', text: 'Teams are already stretched thin.' }],
        context: { evidenceHash: null, populationFrameHash: 'b'.repeat(64), note: 'Evidence remained unverified grounding.' },
        limitations: ['Model-generated perspective only.'],
        stimulusRefs: ['comparison-a'],
      },
    }],
  });

  assert.equal(record.data.turns[1].context.evidenceHash, null);
  const restored = conversationStateFromRecord(record);
  assert.equal(restored.turns[0].response.basisSummary, 'This answer leans on the uploaded onboarding notes and the explicit setup-risk assumption.');
  assert.equal(restored.turns[0].response.evidenceUsed[0].url, 'https://example.com/notes');
  assert.equal(restored.turns[0].response.evidenceUsed[0].originalLanguage, 'en');
  assert.equal(restored.fixedConditions, '');
  assert.equal(restored.comparisonA, '');
});

test('qualitative conversation records omit incomplete evidence instead of inventing English source prose', () => {
  const record = conversationRecordFromState('qualitative_project_study_1_run_1', result, 'segment_1', {
    conversationId: 'conversation_1',
    turns: [{
      question: 'What evidence influenced this?',
      intent: 'FOLLOW_UP',
      response: {
        turnId: 'turn_1',
        answer: 'No complete evidence record was available for this modeled response.',
        evidenceUsed: [{ id: 'evidence_without_copy' }],
        assumptionsUsed: [],
        context: { evidenceHash: null, populationFrameHash: 'b'.repeat(64), note: '' },
      },
    }],
  });

  assert.deepEqual(record.data.turns[1].evidenceUsed, []);
  assert.doesNotMatch(JSON.stringify(record), /Evidence record|No excerpt was recorded/);
});

test('qualitative project descriptors require a real run hash for persistent run records', () => {
  const descriptor = createQualitativeProjectDescriptor(study, result);
  assert.equal(descriptor.id, 'qualitative_project_study_1_run_1');
  assert.throws(() => buildQualitativeRunRecord(descriptor.id, study, { ...result, meta: { ...result.meta, inputHash: null } }), /real input hash/i);
});

test('qualitative run records and exports preserve canonical public-sample lineage', async () => {
  const sampleLineage = canonicalSampleLineageForSample(sampleStudies[0]);
  const resultWithSampleLineage = {
    ...result,
    meta: { ...result.meta, sampleLineage },
  };
  const descriptor = createQualitativeProjectDescriptor(study, resultWithSampleLineage);
  const runRecord = buildQualitativeRunRecord(descriptor.id, study, resultWithSampleLineage);
  const store = createMemoryProjectStore();

  assert.deepEqual(runRecord.data.sampleLineage, sampleLineage);
  assert.deepEqual(runRecord.lineage.sampleLineage, sampleLineage);
  await store.createProject({ ...descriptor, retention: { mode: 'UNTIL_DELETED' } });
  await store.appendRecord(descriptor.id, runRecord);
  const exported = await store.exportProject(descriptor.id);
  assert.deepEqual(exported.project.records[0].data.sampleLineage, sampleLineage);
  assert.deepEqual(exported.project.records[0].lineage.sampleLineage, sampleLineage);
});

test('localized qualitative presentation envelopes preserve canonical exports and reject inconsistent lineage', async () => {
  const descriptor = createQualitativeProjectDescriptor(study, result);
  const store = createMemoryProjectStore();
  await store.createProject({ ...descriptor, retention: { mode: 'UNTIL_DELETED' } });
  await store.appendRecord(descriptor.id, buildQualitativeRunRecord(descriptor.id, study, result));
  const canonicalProjectExport = await store.exportProject(descriptor.id);
  const context = {
    study: { ...study, market: 'Japan', outputLocale: 'ja-JP' },
    result: { ...result, meta: { ...result.meta, outputLocale: 'ja-JP', hashes: { evidence: 'c'.repeat(64), populationFrame: 'b'.repeat(64) } } },
    locale: 'ja-JP',
  };
  const envelope = buildQualitativeProjectPresentationEnvelope(canonicalProjectExport, context);

  assert.equal(envelope.canonicalProjectExport, canonicalProjectExport, 'the strict canonical export remains nested intact');
  assert.equal(envelope.localizationReceipt.localized, true);
  assert.match(envelope.disclosures.join(' '), /ローカル定性プロジェクト/);
  assert.deepEqual(await validateQualitativeProjectImport(envelope, descriptor.id, context), canonicalProjectExport);

  const inconsistent = structuredClone(envelope);
  inconsistent.evidenceHash = 'd'.repeat(64);
  await assert.rejects(() => validateQualitativeProjectImport(inconsistent, descriptor.id, context), /current run lineage/i);

  const relabelled = structuredClone(envelope);
  relabelled.localizationReceipt.interfaceLocale = 'ko-KR';
  await assert.rejects(() => validateQualitativeProjectImport(relabelled, descriptor.id, context), /presentation export is invalid/i);

  const wrongMarket = structuredClone(envelope);
  wrongMarket.market.countryCode = 'KR';
  await assert.rejects(() => validateQualitativeProjectImport(wrongMarket, descriptor.id, context), /current run lineage/i);
});

test('qualitative presentation derives a human market label and preserves an explicit null Global country', async () => {
  const descriptor = createQualitativeProjectDescriptor(study, result);
  const store = createMemoryProjectStore();
  await store.createProject({ ...descriptor, retention: { mode: 'UNTIL_DELETED' } });
  await store.appendRecord(descriptor.id, buildQualitativeRunRecord(descriptor.id, study, result));
  const canonicalProjectExport = await store.exportProject(descriptor.id);
  const localizationReceipt = {
    schemaVersion: 'study-localization-v1',
    registryVersion: 'localization-capabilities-v2',
    inputMode: 'canonical',
    market: { id: 'GLOBAL', kind: 'registered', label: 'Global', countryCode: null, searchLocation: '', retrievalGeography: null },
    report: { locale: 'ja-JP' },
    source: { locales: ['ja-JP'] },
    retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
    instrument: { locale: 'ja-JP' },
  };
  const context = {
    study: { ...study, market: 'Global', outputLocale: 'ja-JP' },
    result: { ...result, meta: { ...result.meta, outputLocale: 'ja-JP', localizationReceipt } },
    locale: 'ja-JP',
  };

  const envelope = buildQualitativeProjectPresentationEnvelope(canonicalProjectExport, context);
  assert.deepEqual(envelope.market, { name: 'グローバル', countryCode: null });
  assert.equal(envelope.localizationReceipt.canonicalRunLocalizationReceipt, localizationReceipt);
  assert.deepEqual(await validateQualitativeProjectImport(envelope, descriptor.id, context), canonicalProjectExport);

  const japanReceipt = {
    ...localizationReceipt,
    market: { id: 'JP', kind: 'registered', label: 'Japan', countryCode: 'JP', searchLocation: 'Japan', retrievalGeography: { countryCode: 'JP', location: 'Japan' } },
  };
  const japanContext = {
    ...context,
    study: { ...context.study, market: 'Japan' },
    result: { ...context.result, meta: { ...context.result.meta, localizationReceipt: japanReceipt } },
  };
  const japanEnvelope = buildQualitativeProjectPresentationEnvelope(canonicalProjectExport, japanContext);
  assert.deepEqual(japanEnvelope.market, { name: '日本', countryCode: 'JP' });
  assert.deepEqual(await validateQualitativeProjectImport(japanEnvelope, descriptor.id, japanContext), canonicalProjectExport);
});

test('project import validation rejects mismatched runs and unsafe evidence urls after hash verification', async () => {
  const store = createMemoryProjectStore();
  await store.createProject({ id: 'qualitative_project_study_1_run_1', name: 'Stored project', retention: { mode: 'UNTIL_DELETED' } });
  await store.appendRecord('qualitative_project_study_1_run_1', {
    id: 'conversation_segment_1',
    kind: 'conversation',
    projectId: 'qualitative_project_study_1_run_1',
    version: 1,
    data: {
      conversationId: 'conversation_1',
      segmentId: 'segment_1',
      synthetic: true,
      observedHumanResponse: false,
      disclosure: 'Model-generated perspective—not a participant quotation.',
      turnCount: 2,
      turns: [
        { id: 'question_segment_1_1', role: 'user', text: 'What is the objection?', intent: 'OBJECTION', parentTurnId: null },
        {
          id: 'turn_1',
          role: 'assistant',
          text: 'The main modeled objection is implementation burden.',
          evidenceRefs: ['evidence_1'],
          assumptionRefs: [],
          parentTurnId: 'question_segment_1_1',
          disclosure: 'Model-generated perspective—not a participant quotation.',
          basisSummary: 'Grounded in one safe source.',
          limitations: ['Model-generated perspective only.'],
          evidenceUsed: [{ id: 'evidence_1', title: 'Safe source', url: 'https://example.com/source', excerpt: 'Excerpt', originalLanguage: 'en', evidenceClass: 'PROVIDED_SOURCE' }],
          assumptionsUsed: [],
          context: { evidenceHash: null, populationFrameHash: null, note: '' },
          stimulusRefs: [],
        },
      ],
    },
    lineage: { projectId: 'qualitative_project_study_1_run_1', studyId: 'study_1', runId: 'run_1' },
  });

  const exported = await store.exportProject('qualitative_project_study_1_run_1');
  await assert.rejects(() => validateQualitativeProjectImport(exported, 'qualitative_project_other_run'), /does not match the current run/i);

  const tampered = structuredClone(exported);
  tampered.project.records[0].data.turns[1].evidenceUsed[0].url = 'javascript:alert(1)';
  tampered.packageHash = await hashProjectExportPayload({
    exportVersion: tampered.exportVersion,
    disclosure: tampered.disclosure,
    project: tampered.project,
  });
  await assert.rejects(() => validateQualitativeProjectImport(tampered, 'qualitative_project_study_1_run_1'), /project export is invalid/i);
});

test('qualitative project views restore conversations and stats from stored records', () => {
  const project = {
    records: [
      {
        kind: 'conversation',
        data: {
          segmentId: 'segment_1',
          conversationId: 'conversation_1',
          turnCount: 2,
          turns: [
            { id: 'question_segment_1_1', role: 'user', text: 'What changed?', intent: 'COUNTERFACTUAL', parentTurnId: null },
            { id: 'turn_1', role: 'assistant', text: 'Price sensitivity softened.', evidenceRefs: [], assumptionRefs: [], parentTurnId: 'question_segment_1_1', disclosure: 'Model-generated perspective—not a participant quotation.' },
          ],
        },
      },
      { kind: 'material', data: {} },
      { kind: 'run', data: {} },
    ],
  };
  const conversations = qualitativeConversationsFromProject(project);
  assert.equal(conversations.segment_1.turns.length, 1);
  assert.deepEqual(qualitativeProjectStats(project), { recordCount: 3, conversationCount: 1, interviewTurnPairs: 1, materialCount: 1, runCount: 1 });
});

test('qualitative mutation queue serializes rapid consecutive writes', async () => {
  const queue = createProjectMutationQueue();
  const order = [];
  const first = queue.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('first');
    return 1;
  });
  const second = queue.run(async () => {
    order.push('second');
    return 2;
  });
  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(order, ['first', 'second']);
});
