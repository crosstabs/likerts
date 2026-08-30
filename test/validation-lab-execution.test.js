import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createInventedValidationFixture } from '../evals/validation-lab-fixtures.js';
import {
  assembleBlindValidationExecution,
  createPublicValidationCaseArtifact,
  generatePublicValidationScorecardArtifact,
  planBlindValidationExecution,
  extractConfiguredHumanOutcomeFromFile,
  sealValidationArtifacts,
} from '../scripts/validation-lab-offline.js';

const execFile = promisify(execFileCallback);
const root = new URL('../', import.meta.url);

test('sealing writes a public preregistration and a separate private reveal without leaking outcome material', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-seal-'));
  const publicRoot = join(directory, 'public');
  const privateRoot = join(directory, '.validation-private');
  const publicPreregistrationPath = join(publicRoot, 'case.json');
  const privateRevealPath = join(privateRoot, 'case.reveal.json');

  try {
    const sealed = await sealValidationArtifacts({
      preregistration: fixture.preregistration,
      humanOutcome: fixture.reveal.humanOutcome,
      nonce: 'invented-strong-nonce-20260829-A7f4Z9k2',
      publicRoot,
      privateRoot,
      publicPreregistrationPath,
      privateRevealPath,
    });
    const publicBytes = await readFile(publicPreregistrationPath, 'utf8');
    const privateBytes = await readFile(privateRevealPath, 'utf8');

    assert.equal(sealed.status, 'SEALED');
    assert.equal(JSON.parse(publicBytes).artifactType, 'PUBLIC_VALIDATION_PREREGISTRATION');
    assert.equal(publicBytes.includes('humanOutcome'), false);
    assert.equal(publicBytes.includes('invented-strong-nonce'), false);
    assert.equal(JSON.parse(privateBytes).artifactType, 'PRIVATE_VALIDATION_REVEAL');
    assert.deepEqual(JSON.parse(privateBytes).humanOutcome, fixture.reveal.humanOutcome);
    assert.equal((await stat(privateRoot)).mode & 0o777, 0o700);
    assert.equal((await stat(privateRevealPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(privateRoot, 'nonce-registry.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sealing rejects weak or reused nonces and any reveal destination under the public root', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-seal-guard-'));
  const publicRoot = join(directory, 'public');
  const privateRoot = join(directory, '.validation-private');
  const strongNonce = 'unique-strong-nonce-20260829-B8g5Y0m3';
  const paths = (name, revealRoot = privateRoot) => ({
    publicRoot,
    privateRoot,
    publicPreregistrationPath: join(publicRoot, `${name}.json`),
    privateRevealPath: join(revealRoot, `${name}.reveal.json`),
  });

  try {
    await assert.rejects(
      sealValidationArtifacts({ preregistration: fixture.preregistration, humanOutcome: fixture.reveal.humanOutcome, nonce: 'x'.repeat(40), ...paths('weak') }),
      /strong nonce/i,
    );
    await assert.rejects(
      sealValidationArtifacts({ preregistration: fixture.preregistration, humanOutcome: fixture.reveal.humanOutcome, nonce: strongNonce, ...paths('public-reveal', publicRoot) }),
      /public root/i,
    );
    await sealValidationArtifacts({ preregistration: fixture.preregistration, humanOutcome: fixture.reveal.humanOutcome, nonce: strongNonce, ...paths('first') });
    await assert.rejects(
      sealValidationArtifacts({ preregistration: fixture.preregistration, humanOutcome: fixture.reveal.humanOutcome, nonce: strongNonce, ...paths('reused') }),
      /already been used/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sealing rejects a private root symlinked into the public root without writing reveal bytes', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-seal-root-link-'));
  const publicRoot = join(directory, 'public');
  const privateRoot = join(directory, '.validation-private');
  const leakedRevealPath = join(publicRoot, 'case.reveal.json');

  try {
    await mkdir(publicRoot);
    await symlink(publicRoot, privateRoot, 'dir');
    await assert.rejects(sealValidationArtifacts({
      preregistration: fixture.preregistration,
      humanOutcome: fixture.reveal.humanOutcome,
      nonce: 'root-link-strong-nonce-20260829-D1i7W2p5',
      publicRoot,
      privateRoot,
      publicPreregistrationPath: join(publicRoot, 'case.json'),
      privateRevealPath: join(privateRoot, 'case.reveal.json'),
    }), /symbolic link|canonical public root/i);
    await assert.rejects(readFile(leakedRevealPath), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sealing rejects symlinked reveal destinations and ancestors without following them', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-seal-destination-link-'));
  const publicRoot = join(directory, 'public');
  const privateRoot = join(directory, '.validation-private');
  const leakedFinalPath = join(publicRoot, 'final-leak.json');
  const leakedAncestorPath = join(publicRoot, 'ancestor-leak.json');

  try {
    await mkdir(publicRoot);
    await mkdir(privateRoot, { mode: 0o700 });
    const finalRevealPath = join(privateRoot, 'final.reveal.json');
    await symlink(leakedFinalPath, finalRevealPath);
    await assert.rejects(sealValidationArtifacts({
      preregistration: fixture.preregistration,
      humanOutcome: fixture.reveal.humanOutcome,
      nonce: 'final-link-strong-nonce-20260829-E2j8V3q6',
      publicRoot,
      privateRoot,
      publicPreregistrationPath: join(publicRoot, 'final.json'),
      privateRevealPath: finalRevealPath,
    }), /symbolic link/i);

    const linkedParent = join(privateRoot, 'linked-parent');
    await symlink(publicRoot, linkedParent, 'dir');
    await assert.rejects(sealValidationArtifacts({
      preregistration: fixture.preregistration,
      humanOutcome: fixture.reveal.humanOutcome,
      nonce: 'ancestor-link-strong-nonce-20260829-F3k9U4r7',
      publicRoot,
      privateRoot,
      publicPreregistrationPath: join(publicRoot, 'ancestor.json'),
      privateRevealPath: join(linkedParent, 'ancestor-leak.json'),
    }), /symbolic link|canonical public root/i);

    await assert.rejects(readFile(leakedFinalPath), { code: 'ENOENT' });
    await assert.rejects(readFile(leakedAncestorPath), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the sealing CLI reads the nonce from a local file and emits only non-secret receipt data', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-seal-cli-'));
  const publicRoot = join(directory, 'public');
  const privateRoot = join(directory, '.validation-private');
  const preregistrationPath = join(directory, 'preregistration.json');
  const outcomePath = join(directory, 'outcome.json');
  const noncePath = join(directory, 'nonce.txt');
  const publicPath = join(publicRoot, 'case.json');
  const revealPath = join(privateRoot, 'case.reveal.json');
  const nonce = 'cli-strong-nonce-20260829-C9h6X1n4';

  try {
    await writeFile(preregistrationPath, JSON.stringify(fixture.preregistration), 'utf8');
    await writeFile(outcomePath, JSON.stringify(fixture.reveal.humanOutcome), 'utf8');
    await writeFile(noncePath, nonce, 'utf8');
    const { stdout } = await execFile(process.execPath, [
      'scripts/validation-lab-offline.js', '--seal',
      '--preregistration', preregistrationPath,
      '--human-outcome', outcomePath,
      '--nonce-file', noncePath,
      '--public-root', publicRoot,
      '--private-root', privateRoot,
      '--public-artifact', publicPath,
      '--private-reveal', revealPath,
    ], { cwd: root.pathname });
    const receipt = JSON.parse(stdout);

    assert.equal(receipt.status, 'SEALED');
    assert.equal(stdout.includes(nonce), false);
    assert.equal(stdout.includes('humanOutcome'), false);
    assert.equal(JSON.parse(await readFile(revealPath, 'utf8')).nonce, nonce);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured CSV extraction applies exact filters, codes, weights, groups, and dates deterministically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-extract-csv-'));
  const sourcePath = join(directory, 'invented-responses.csv');
  const csv = [
    'eligible,weight,age_group,interview_date,q1,q2,q3',
    'yes,1,younger,2026-08-01,5,4,3',
    'yes,2,older,2026-08-03,4,2,3',
    'no,5,younger,2026-08-05,1,1,1',
  ].join('\n');
  const config = {
    extractorVersion: 'validation-outcome-extractor-v1',
    sourceFormat: 'CSV',
    filters: [{ field: 'eligible', equals: 'yes' }],
    weightField: 'weight',
    dateField: 'interview_date',
    questions: [
      { questionId: 'q1', responseField: 'q1', responseCodes: ['1', '2', '3', '4', '5'] },
      { questionId: 'q2', responseField: 'q2', responseCodes: ['1', '2', '3', '4', '5'] },
      { questionId: 'q3', responseField: 'q3', responseCodes: ['1', '2', '3', '4', '5'] },
    ],
    groups: [
      { groupId: 'younger', field: 'age_group', equals: 'younger' },
      { groupId: 'older', field: 'age_group', equals: 'older' },
    ],
  };

  try {
    await writeFile(sourcePath, csv, 'utf8');
    const first = await extractConfiguredHumanOutcomeFromFile({ sourcePath, config });
    const second = await extractConfiguredHumanOutcomeFromFile({ sourcePath, config });

    assert.deepEqual(first, second);
    assert.equal(first.includedRecordCount, 2);
    assert.equal(first.excludedRecordCount, 1);
    assert.equal(first.fieldStart, '2026-08-01');
    assert.equal(first.fieldEnd, '2026-08-03');
    assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(first.configHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(first.humanOutcome.questions[0].distribution, [0, 0, 0, 66.6667, 33.3333]);
    assert.deepEqual(first.humanOutcome.questions[0].subgroups[0].distribution, [0, 0, 0, 0, 100]);
    assert.deepEqual(first.humanOutcome.questions[0].subgroups[1].distribution, [0, 0, 0, 100, 0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured JSON extraction uses the explicit records path and produces the same exact mapping', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-extract-json-'));
  const sourcePath = join(directory, 'invented-responses.json');
  const records = [
    { eligible: 'yes', weight: '1', age_group: 'younger', interview_date: '2026-08-01', q1: '5', q2: '4', q3: '3' },
    { eligible: 'yes', weight: '2', age_group: 'older', interview_date: '2026-08-03', q1: '4', q2: '2', q3: '3' },
  ];
  const config = {
    extractorVersion: 'validation-outcome-extractor-v1',
    sourceFormat: 'JSON',
    recordsPath: 'payload.responses',
    filters: [{ field: 'eligible', equals: 'yes' }],
    weightField: 'weight',
    dateField: 'interview_date',
    questions: [
      { questionId: 'q1', responseField: 'q1', responseCodes: ['1', '2', '3', '4', '5'] },
      { questionId: 'q2', responseField: 'q2', responseCodes: ['1', '2', '3', '4', '5'] },
      { questionId: 'q3', responseField: 'q3', responseCodes: ['1', '2', '3', '4', '5'] },
    ],
    groups: [
      { groupId: 'younger', field: 'age_group', equals: 'younger' },
      { groupId: 'older', field: 'age_group', equals: 'older' },
    ],
  };

  try {
    await writeFile(sourcePath, JSON.stringify({ payload: { responses: records } }), 'utf8');
    const extracted = await extractConfiguredHumanOutcomeFromFile({ sourcePath, config });

    assert.equal(extracted.sourceFormat, 'JSON');
    assert.equal(extracted.mappingMode, 'CONFIGURED_EXACT_ONLY');
    assert.deepEqual(extracted.humanOutcome.questions[0].distribution, [0, 0, 0, 66.6667, 33.3333]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('outcome extraction fails closed on unmapped codes instead of inferring a response mapping', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-extract-reject-'));
  const sourcePath = join(directory, 'invented-responses.json');
  const config = {
    extractorVersion: 'validation-outcome-extractor-v1',
    sourceFormat: 'JSON',
    recordsPath: 'responses',
    filters: [],
    weightField: 'weight',
    dateField: 'date',
    questions: [{ questionId: 'q1', responseField: 'answer', responseCodes: ['1', '2', '3', '4', '5'] }],
    groups: [],
  };

  try {
    await writeFile(sourcePath, JSON.stringify({ responses: [{ weight: '1', date: '2026-08-01', answer: 'Strongly agree' }] }), 'utf8');
    await assert.rejects(extractConfiguredHumanOutcomeFromFile({ sourcePath, config }), /unconfigured response code/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('outcome extraction rejects duplicate configured question and group identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-extract-duplicates-'));
  const sourcePath = join(directory, 'invented-responses.json');
  const baseConfig = {
    extractorVersion: 'validation-outcome-extractor-v1',
    sourceFormat: 'JSON',
    recordsPath: 'responses',
    filters: [],
    weightField: 'weight',
    dateField: 'date',
    questions: [{ questionId: 'q1', responseField: 'answer', responseCodes: ['1', '2'] }],
    groups: [{ groupId: 'all-one', field: 'segment', equals: 'one' }],
  };

  try {
    await writeFile(sourcePath, JSON.stringify({ responses: [{ weight: '1', date: '2026-08-01', answer: '1', segment: 'one' }] }), 'utf8');
    const duplicateQuestions = { ...baseConfig, questions: [...baseConfig.questions, structuredClone(baseConfig.questions[0])] };
    const duplicateGroups = { ...baseConfig, groups: [...baseConfig.groups, structuredClone(baseConfig.groups[0])] };
    await assert.rejects(extractConfiguredHumanOutcomeFromFile({ sourcePath, config: duplicateQuestions }), /unique question IDs/i);
    await assert.rejects(extractConfiguredHumanOutcomeFromFile({ sourcePath, config: duplicateGroups }), /unique group IDs/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('blind planning deterministically expands question by repeat by subgroup by evidence variant with full cost and lineage', () => {
  const fixture = createInventedValidationFixture();
  const request = {
    syntheticImport: fixture.syntheticImport,
    repeatCount: 2,
    subgroupIds: ['younger', 'older'],
    evidenceVariants: [
      { variantId: 'prior', evidenceHash: 'e'.repeat(64), estimatedCostUsd: 0.01 },
      { variantId: 'frozen', evidenceHash: 'f'.repeat(64), estimatedCostUsd: 0.02 },
    ],
    hardCaps: { maxCalls: 24, maxCostUsd: 0.36 },
  };

  const first = planBlindValidationExecution(request);
  const second = planBlindValidationExecution(request);
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(first.status, 'PLANNED');
  assert.equal(first.callCount, 24);
  assert.equal(first.estimatedCostUsd, 0.36);
  assert.equal(first.items.length, 24);
  assert.match(first.planHash, /^[a-f0-9]{64}$/);
  assert.equal(first.items[0].lineage.preregistrationHash, fixture.syntheticRuns[0].lineage.preregistrationHash);
  assert.equal(first.items[0].lineage.syntheticBriefHash, fixture.preregistration.syntheticBriefHash);
  assert.equal(serialized.includes('humanOutcome'), false);
  assert.equal(serialized.includes(fixture.reveal.nonce), false);
  assert.equal(serialized.includes('Invented human reference'), false);
});

test('blind planning refuses the entire matrix when either hard cap would be exceeded', () => {
  const fixture = createInventedValidationFixture();
  const input = {
    syntheticImport: fixture.syntheticImport,
    repeatCount: 2,
    subgroupIds: ['younger', 'older'],
    evidenceVariants: [{ variantId: 'prior', evidenceHash: 'e'.repeat(64), estimatedCostUsd: 0.02 }],
  };
  const callCapped = planBlindValidationExecution({ ...input, hardCaps: { maxCalls: 11, maxCostUsd: 1 } });
  const costCapped = planBlindValidationExecution({ ...input, hardCaps: { maxCalls: 12, maxCostUsd: 0.23 } });

  for (const rejected of [callCapped, costCapped]) {
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.items.length, 0);
    assert.equal(rejected.callCount, 12);
    assert.equal(rejected.estimatedCostUsd, 0.24);
    assert.equal(rejected.planHash, null);
  }
});

test('plan item identity changes when frozen evidence lineage changes', () => {
  const fixture = createInventedValidationFixture();
  const input = {
    syntheticImport: fixture.syntheticImport,
    repeatCount: 1,
    subgroupIds: ['younger'],
    hardCaps: { maxCalls: 3, maxCostUsd: 1 },
  };
  const first = planBlindValidationExecution({ ...input, evidenceVariants: [{ variantId: 'prior', evidenceHash: 'e'.repeat(64), estimatedCostUsd: 0.01 }] });
  const changed = planBlindValidationExecution({ ...input, evidenceVariants: [{ variantId: 'prior', evidenceHash: 'f'.repeat(64), estimatedCostUsd: 0.01 }] });

  assert.notEqual(first.items[0].planItemId, changed.items[0].planItemId);
});

test('blind assembly preserves supplied successes and failures, records missing results, and binds full plan lineage', () => {
  const fixture = createInventedValidationFixture();
  const plan = planBlindValidationExecution({
    syntheticImport: fixture.syntheticImport,
    repeatCount: 1,
    subgroupIds: ['younger', 'older'],
    evidenceVariants: [{ variantId: 'prior', evidenceHash: 'e'.repeat(64), estimatedCostUsd: 0.01 }],
    hardCaps: { maxCalls: 6, maxCostUsd: 0.06 },
  });
  const results = [
    { planItemId: plan.items[0].planItemId, status: 'COMPLETED', executionId: 'local-1', output: { distribution: [10, 20, 30, 25, 15] } },
    { planItemId: plan.items[1].planItemId, status: 'FAILED', executionId: 'local-2', failureCode: 'UPSTREAM_BUSY', reason: 'Invented failure.' },
  ];

  const assembled = assembleBlindValidationExecution({ plan, results });

  assert.equal(assembled.status, 'ASSEMBLED_WITH_FAILURES');
  assert.equal(assembled.items.length, plan.callCount);
  assert.equal(assembled.completedCount, 1);
  assert.equal(assembled.failedCount, 5);
  assert.equal(assembled.missingCount, 4);
  assert.deepEqual(assembled.items[0].execution, results[0]);
  assert.deepEqual(assembled.items[1].execution, results[1]);
  assert.equal(assembled.items[2].execution.failureCode, 'MISSING_RESULT');
  assert.equal(assembled.items[0].lineage.planHash, plan.planHash);
  assert.equal(assembled.items[0].lineage.promptVersions.panel, 'invented-prompt-v1');
  assert.match(assembled.bundleHash, /^[a-f0-9]{64}$/);
});

test('public scorecard bytes are deterministic, show every case state, and suppress underpowered aggregates', () => {
  const comparisons = [
    { caseId: 'case-completed', comparisonStatus: 'COMPLETED', outcome: 'MIXED_EVIDENCE', market: 'Spain', language: 'es-ES', questionTypes: ['CONCEPT_INTENT'], metrics: { meanAbsolutePercentagePointError: 4.25 } },
    { caseId: 'case-failed', comparisonStatus: 'ABORTED', outcome: 'NOT_ASSESSED', market: 'Japan', language: 'ja-JP', questionTypes: ['PURCHASE_INTENT'], reason: 'No eligible run completed.', metrics: null },
    { caseId: 'case-invalid', comparisonStatus: 'INVALIDATED', outcome: 'NOT_ASSESSED', market: 'France', language: 'fr-FR', questionTypes: ['MESSAGE_CLARITY'], reason: 'Lineage mismatch.', metrics: null },
    { caseId: 'case-not-assessed', comparisonStatus: 'COMPLETED', outcome: 'NOT_ASSESSED', market: 'Brazil', language: 'pt-BR', questionTypes: ['CONCEPT_INTENT'], reason: 'Insufficient repeats.', metrics: { meanAbsolutePercentagePointError: 3.5 } },
  ];
  const cases = comparisons.map(createPublicValidationCaseArtifact);

  const first = generatePublicValidationScorecardArtifact(cases, { minimumAggregateCases: 3 });
  const second = generatePublicValidationScorecardArtifact([...cases].reverse(), { minimumAggregateCases: 3 });

  assert.equal(first.bytes, second.bytes);
  assert.deepEqual(first.artifact.caseCounts, { COMPLETED: 1, FAILED: 1, INVALIDATED: 1, NOT_ASSESSED: 1 });
  assert.deepEqual(first.artifact.cases.map((item) => item.caseStatus), ['COMPLETED', 'FAILED', 'INVALIDATED', 'NOT_ASSESSED']);
  assert.equal(first.artifact.aggregates.status, 'SUPPRESSED_UNDERPOWERED');
  assert.equal(first.artifact.aggregates.metrics, null);
  assert.equal(first.artifact.publicationStatus, 'NOT_PUBLISHED');
  assert.match(first.artifact.artifactHash, /^[a-f0-9]{64}$/);
  assert.equal(first.bytes.includes('accuracy'), false);
});

test('public scorecard generation rejects a case changed after its immutable artifact hash was created', () => {
  const publicCase = createPublicValidationCaseArtifact({
    caseId: 'case-tampered',
    comparisonStatus: 'COMPLETED',
    outcome: 'MIXED_EVIDENCE',
    market: 'Spain',
    language: 'es-ES',
    questionTypes: ['CONCEPT_INTENT'],
    metrics: { meanAbsolutePercentagePointError: 4.25 },
  });
  publicCase.comparison.metrics.meanAbsolutePercentagePointError = 0;

  assert.throws(() => generatePublicValidationScorecardArtifact([publicCase]), /immutable hash check/i);
});

const aggregateLineage = (overrides = {}) => ({
  population: 'Urban adults replacing a vehicle within 36 months',
  weighting: 'Raking to official age, region, and housing marginals',
  researchMethod: 'CONCEPT_TEST',
  dataset: { id: 'dataset-v3', version: '2026-08', fieldStart: '2026-08-01', fieldEnd: '2026-08-15' },
  datasetDescriptorHash: 'a'.repeat(64),
  questionWordingHash: 'b'.repeat(64),
  responseScaleHash: 'c'.repeat(64),
  runtimeVersion: 'runtime-v3',
  promptVersions: { panel: 'panel-v3' },
  schemaVersions: { panel: 'schema-v3' },
  modelRoutes: ['model-route-v3'],
  ...overrides,
});

test('public scorecard never pools three completed cases across heterogeneous benchmark scopes', () => {
  const comparisons = [
    { caseId: 'case-cn', comparisonStatus: 'COMPLETED', outcome: 'MIXED_EVIDENCE', market: 'China', language: 'zh-CN', questionTypes: ['CONCEPT_INTENT'], lineage: aggregateLineage(), metrics: { meanAbsolutePercentagePointError: 4 } },
    { caseId: 'case-jp', comparisonStatus: 'COMPLETED', outcome: 'MIXED_EVIDENCE', market: 'Japan', language: 'ja-JP', questionTypes: ['PRICE_SENSITIVITY'], lineage: aggregateLineage({ population: 'Business-hotel guests', researchMethod: 'PRICE_SENSITIVITY' }), metrics: { meanAbsolutePercentagePointError: 10 } },
    { caseId: 'case-kr', comparisonStatus: 'COMPLETED', outcome: 'MIXED_EVIDENCE', market: 'South Korea', language: 'ko-KR', questionTypes: ['MESSAGE_CLARITY'], lineage: aggregateLineage({ population: 'Streaming-service users', researchMethod: 'MESSAGE_TEST' }), metrics: { meanAbsolutePercentagePointError: 16 } },
  ];

  const scorecard = generatePublicValidationScorecardArtifact(comparisons.map(createPublicValidationCaseArtifact), { minimumAggregateCases: 3 }).artifact;

  assert.equal(scorecard.aggregates.status, 'SUPPRESSED_MIXED_SCOPES');
  assert.equal(scorecard.aggregates.metrics, null);
  assert.equal(scorecard.aggregates.distinctScopeCount, 3);
  assert.equal(scorecard.stratifiedAggregates.length, 3);
  assert.equal(scorecard.stratifiedAggregates.every((aggregate) => aggregate.status === 'SUPPRESSED_UNDERPOWERED'), true);
});

test('public scorecard publishes aggregate metrics only inside one complete frozen scope', () => {
  const comparisons = [4, 10, 16].map((error, index) => ({
    caseId: `case-same-scope-${index + 1}`,
    comparisonStatus: 'COMPLETED',
    outcome: 'MIXED_EVIDENCE',
    market: 'China',
    language: 'zh-CN',
    questionTypes: ['CONCEPT_INTENT'],
    lineage: aggregateLineage(),
    metrics: { meanAbsolutePercentagePointError: error },
  }));

  const scorecard = generatePublicValidationScorecardArtifact(comparisons.map(createPublicValidationCaseArtifact), { minimumAggregateCases: 3 }).artifact;

  assert.equal(scorecard.aggregates.status, 'AVAILABLE');
  assert.equal(scorecard.aggregates.metrics.meanAbsolutePercentagePointError, 10);
  assert.equal(scorecard.aggregates.scope.market, 'China');
  assert.equal(scorecard.stratifiedAggregates.length, 1);
  assert.equal(scorecard.stratifiedAggregates[0].status, 'AVAILABLE');
});

test('public scorecard never pools changed wording, scale, or field dates', () => {
  const comparisons = [
    aggregateLineage(),
    aggregateLineage({ questionWordingHash: 'd'.repeat(64) }),
    aggregateLineage({ responseScaleHash: 'e'.repeat(64), dataset: { id: 'dataset-v3', version: '2026-08', fieldStart: '2026-08-16', fieldEnd: '2026-08-31' }, datasetDescriptorHash: 'f'.repeat(64) }),
  ].map((lineage, index) => ({
    caseId: `case-mixed-instrument-${index + 1}`,
    comparisonStatus: 'COMPLETED',
    outcome: 'MIXED_EVIDENCE',
    market: 'China',
    language: 'zh-CN',
    questionTypes: ['CONCEPT_INTENT'],
    lineage,
    metrics: { meanAbsolutePercentagePointError: 4 + index },
  }));

  const scorecard = generatePublicValidationScorecardArtifact(comparisons.map(createPublicValidationCaseArtifact), { minimumAggregateCases: 3 }).artifact;
  assert.equal(scorecard.aggregates.status, 'SUPPRESSED_MIXED_SCOPES');
  assert.equal(scorecard.aggregates.distinctScopeCount, 3);
  assert.equal(scorecard.stratifiedAggregates.length, 3);
});
