import { createIndexedDbProjectStore, createMemoryProjectStore, LOCAL_DATA_DISCLOSURE } from './projectStore.js';

export const QUALITATIVE_PROJECT_PREFIX = 'qualitative_project';
export const PERSISTED_TURN_DISCLOSURE = 'Model-generated perspective—not a participant quotation.';
export const MAX_QUALITATIVE_PROJECT_IMPORT_BYTES = 1_000_000;
export const QUALITATIVE_PROJECT_PRESENTATION_VERSION = 'qualitative-project-presentation-v1';

const CJK_PRESENTATION_COPY = Object.freeze({
  'zh-CN': Object.freeze({
    language: '简体中文',
    globalMarket: '全球',
    disclosures: ['本地定性项目导出包含可导入的规范项目包。', '其中的观点由模型生成，并非参与者引语。'],
  }),
  'ja-JP': Object.freeze({
    language: '日本語',
    globalMarket: 'グローバル',
    disclosures: ['ローカル定性プロジェクトのエクスポートには、再インポート可能な正規プロジェクトパッケージが含まれます。', '保存された見解はモデル生成であり、参加者の引用ではありません。'],
  }),
  'ko-KR': Object.freeze({
    language: '한국어',
    globalMarket: '글로벌',
    disclosures: ['로컬 정성 프로젝트 내보내기에는 다시 가져올 수 있는 정식 프로젝트 패키지가 포함됩니다.', '저장된 관점은 모델이 생성한 것이며 참여자 인용이 아닙니다.'],
  }),
});

const EN_PRESENTATION_COPY = Object.freeze({
  language: 'English',
  globalMarket: 'Global',
  disclosures: ['This local qualitative-project export includes a round-trippable canonical project package.', 'Stored perspectives are model-generated and are not participant quotations.'],
});

const truncate = (value, limit) => String(value || '').trim().slice(0, limit);
const safeIdPart = (value) => String(value || '')
  .trim()
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 48);
const validHash = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const nullableHash = (value) => value === null || value === undefined || validHash(value);
const nullableText = (value) => value === null || value === undefined || typeof value === 'string';

function conversationRecordId(segmentId) {
  return `conversation_${safeIdPart(segmentId)}`;
}

function userTurnId(segmentId, index) {
  return `question_${safeIdPart(segmentId)}_${index + 1}`;
}

function responseEvidenceRecord(item) {
  return {
    id: truncate(item?.id, 160),
    title: truncate(item?.title, 180),
    url: item?.url ? truncate(item.url, 2_000) : null,
    excerpt: truncate(item?.excerpt, 1_500),
    originalLanguage: truncate(item?.originalLanguage, 35) || null,
    evidenceClass: truncate(item?.evidenceClass || 'MODEL_INFERENCE', 80) || 'MODEL_INFERENCE',
  };
}

function responseAssumptionRecord(item) {
  return {
    id: truncate(item?.id, 160),
    text: truncate(item?.text || '', 400),
  };
}

export function qualitativeProjectIdForRun(result) {
  const studyId = safeIdPart(result?.meta?.studyId);
  const runId = safeIdPart(result?.meta?.runId);
  if (!studyId || !runId) return null;
  return `${QUALITATIVE_PROJECT_PREFIX}_${studyId}_${runId}`.slice(0, 160);
}

export function qualitativeProjectNameForRun(study, result) {
  const prompt = truncate(study?.prompt || 'Synthetic segment project', 72);
  const runId = truncate(result?.meta?.runId || 'run', 48);
  return truncate(`${prompt} · ${runId}`, 180);
}

export function createQualitativeProjectDescriptor(study, result) {
  const id = qualitativeProjectIdForRun(result);
  if (!id) return null;
  return {
    id,
    name: qualitativeProjectNameForRun(study, result),
    retention: { mode: 'UNTIL_DELETED', expiresAt: null },
  };
}

export function buildQualitativeRunRecord(projectId, study, result) {
  if (!validHash(result?.meta?.inputHash)) throw new TypeError('A completed run needs a real input hash before it can be saved as a local qualitative project.');
  const sampleLineage = result?.meta?.sampleLineage || result?.run?.sampleLineage || study?.sampleLineage || null;
  return {
    id: `run_${safeIdPart(result?.meta?.runId || 'run')}`.slice(0, 160),
    kind: 'run',
    projectId,
    version: 1,
    data: {
      inputHash: result.meta.inputHash,
      synthetic: true,
      observedHumanResponse: false,
      method: truncate(result?.researchDesign?.methodId || study?.researchMethod || 'GENERAL_LIKERT', 100) || 'GENERAL_LIKERT',
      sampleLineage,
    },
    lineage: {
      projectId,
      studyId: result?.meta?.studyId || null,
      runId: result?.meta?.runId || null,
      sampleLineage,
    },
  };
}

export function buildQualitativeMaterialRecord(projectId, result, material) {
  return {
    id: truncate(material.id, 160),
    kind: 'material',
    projectId,
    version: 1,
    data: {
      title: truncate(material.title, 180),
      excerpt: truncate(material.excerpt, 2_000),
      contentHash: material.contentHash,
      locators: Array.isArray(material.locators)
        ? material.locators.slice(0, 100).map((item) => truncate(typeof item === 'string' ? item : item?.locator, 200)).filter(Boolean)
        : [],
      originalCharacterCount: material.originalCharacterCount,
      detectedType: truncate(material.detectedType, 30),
      originalLanguage: truncate(material.language || material.originalLanguage, 35) || null,
    },
    lineage: {
      projectId,
      studyId: result?.meta?.studyId || null,
      runId: result?.meta?.runId || null,
    },
  };
}

export function frozenContextHashForResult(result) {
  return result?.meta?.hashes?.populationFrame
    || result?.meta?.hashes?.researchDesign
    || result?.meta?.hashes?.evidence
    || result?.meta?.inputHash
    || null;
}

export function conversationRecordFromState(projectId, result, segmentId, conversation) {
  const turns = [];
  const pairedTurns = Array.isArray(conversation?.turns) ? conversation.turns : [];
  pairedTurns.forEach((turn, index) => {
    const userId = userTurnId(segmentId, index);
    const priorAssistantId = index > 0 ? pairedTurns[index - 1]?.response?.turnId || null : null;
    turns.push({
      id: userId,
      role: 'user',
      text: truncate(turn.question, 2_000),
      intent: turn.intent,
      parentTurnId: priorAssistantId,
    });
    turns.push({
      id: truncate(turn.response?.turnId, 160),
      role: 'assistant',
      text: truncate(turn.response?.answer, 4_000),
      evidenceRefs: (turn.response?.evidenceUsed || []).map((item) => truncate(item.id, 160)).filter(Boolean).slice(0, 8),
      assumptionRefs: (turn.response?.assumptionsUsed || []).map((item) => truncate(item.id, 160)).filter(Boolean).slice(0, 8),
      parentTurnId: userId,
      disclosure: PERSISTED_TURN_DISCLOSURE,
      basisSummary: truncate(turn.response?.basisSummary, 600),
      limitations: (turn.response?.limitations || []).map((item) => truncate(item, 240)).filter(Boolean).slice(0, 4),
      evidenceUsed: (turn.response?.evidenceUsed || []).map(responseEvidenceRecord).filter((item) => item.id && item.title && item.excerpt).slice(0, 8),
      assumptionsUsed: (turn.response?.assumptionsUsed || []).map(responseAssumptionRecord).filter((item) => item.id && item.text).slice(0, 8),
      context: {
        evidenceHash: turn.response?.context?.evidenceHash || null,
        populationFrameHash: turn.response?.context?.populationFrameHash || null,
        note: truncate(turn.response?.context?.note || '', 600),
      },
      stimulusRefs: (turn.response?.stimulusRefs || []).map((item) => truncate(item, 160)).filter(Boolean).slice(0, 2),
    });
  });

  return {
    id: conversationRecordId(segmentId),
    kind: 'conversation',
    projectId,
    version: 1,
    data: {
      conversationId: truncate(conversation?.conversationId || conversationRecordId(segmentId), 160),
      segmentId: truncate(segmentId, 160),
      ...(validHash(frozenContextHashForResult(result)) ? { frozenContextHash: frozenContextHashForResult(result) } : {}),
      synthetic: true,
      observedHumanResponse: false,
      disclosure: PERSISTED_TURN_DISCLOSURE,
      turnCount: turns.length,
      turns,
    },
    lineage: {
      projectId,
      studyId: result?.meta?.studyId || null,
      runId: result?.meta?.runId || null,
    },
  };
}

export function conversationStateFromRecord(record) {
  const data = record?.data || {};
  const turns = [];
  for (let index = 0; index < (data.turns || []).length; index += 2) {
    const user = data.turns[index];
    const assistant = data.turns[index + 1];
    if (!user || !assistant || user.role !== 'user' || assistant.role !== 'assistant') continue;
    turns.push({
      question: user.text,
      intent: user.intent,
      response: {
        turnId: assistant.id,
        parentTurnId: assistant.parentTurnId,
        answer: assistant.text,
        basisSummary: assistant.basisSummary || '',
        evidenceUsed: assistant.evidenceUsed || [],
        assumptionsUsed: assistant.assumptionsUsed || [],
        context: assistant.context || { evidenceHash: null, populationFrameHash: null, note: '' },
        limitations: assistant.limitations || [],
        stimulusRefs: assistant.stimulusRefs || [],
        disclosure: assistant.disclosure || PERSISTED_TURN_DISCLOSURE,
      },
    });
  }
  return {
    conversationId: data.conversationId || null,
    turns,
    draft: '',
    intent: 'FOLLOW_UP',
    sending: false,
    error: '',
    comparisonA: '',
    comparisonB: '',
    changedCondition: '',
    fixedConditions: '',
  };
}

export function qualitativeConversationsFromProject(project) {
  return (project?.records || [])
    .filter((record) => record.kind === 'conversation')
    .reduce((accumulator, record) => {
      const segmentId = record.data?.segmentId;
      if (!segmentId) return accumulator;
      accumulator[segmentId] = conversationStateFromRecord(record);
      return accumulator;
    }, {});
}

export function qualitativeProjectStats(project) {
  const records = project?.records || [];
  const conversationRecords = records.filter((record) => record.kind === 'conversation');
  const interviewTurnPairs = conversationRecords.reduce((sum, record) => sum + Math.floor((record.data?.turnCount || 0) / 2), 0);
  return {
    recordCount: records.length,
    conversationCount: conversationRecords.length,
    interviewTurnPairs,
    materialCount: records.filter((record) => record.kind === 'material').length,
    runCount: records.filter((record) => record.kind === 'run').length,
  };
}

export function createBrowserQualitativeProjectStore() {
  try {
    return createIndexedDbProjectStore();
  } catch {
    return null;
  }
}

function presentationLineageFor(projectExport, study, result) {
  const meta = result?.meta || {};
  const run = projectExport?.project?.records?.find((record) => record.kind === 'run');
  const sampleLineage = meta.sampleLineage || result?.run?.sampleLineage || study?.sampleLineage || run?.data?.sampleLineage || null;
  return {
    projectId: projectExport?.project?.id || null,
    studyId: meta.studyId || run?.lineage?.studyId || null,
    runId: meta.runId || run?.lineage?.runId || null,
    inputHash: meta.inputHash || run?.data?.inputHash || null,
    sampleLineage,
  };
}

function canonicalRunLocalizationReceipt(result) {
  const meta = result?.meta || {};
  return meta.localizationReceipt || meta.localization || meta.reproducibility?.localization || result?.localizationReceipt || null;
}

function presentationMarketFor(study, result, locale) {
  const receipt = canonicalRunLocalizationReceipt(result);
  const receiptMarket = isPlainObject(receipt?.market) ? receipt.market : {};
  const receiptCountryCode = Object.hasOwn(receiptMarket, 'countryCode') ? receiptMarket.countryCode : undefined;
  const countryCode = receiptCountryCode !== undefined
    ? receiptCountryCode
    : receiptMarket.country || study?.countryCode || result?.meta?.countryCode || null;
  const canonicalName = receiptMarket.label || receiptMarket.name || receiptMarket.market || study?.market || result?.meta?.market || receiptMarket.id || null;
  const copy = CJK_PRESENTATION_COPY[locale] || EN_PRESENTATION_COPY;
  let name = canonicalName;
  if (receiptMarket.id === 'GLOBAL' || (countryCode === null && canonicalName === 'Global')) name = copy.globalMarket;
  else if (typeof countryCode === 'string' && /^[A-Z]{2}$/.test(countryCode)) {
    try { name = new Intl.DisplayNames([locale || 'en-US'], { type: 'region' }).of(countryCode) || canonicalName; } catch { /* retain canonical label */ }
  }
  return {
    name,
    countryCode,
  };
}

export function buildQualitativeProjectPresentationEnvelope(projectExport, { study, result, locale } = {}) {
  if (!isPlainObject(projectExport) || !isPlainObject(projectExport.project)) throw new TypeError('A canonical local project export is required.');
  const outputLocale = result?.meta?.outputLocale || study?.outputLocale || locale || 'en-US';
  const copy = CJK_PRESENTATION_COPY[locale] || EN_PRESENTATION_COPY;
  const meta = result?.meta || {};
  const hashes = meta.hashes || {};
  const lineage = presentationLineageFor(projectExport, study, result);
  return {
    presentationVersion: QUALITATIVE_PROJECT_PRESENTATION_VERSION,
    exportType: 'LIKERTS_QUALITATIVE_PROJECT_PRESENTATION',
    localizationReceipt: {
      interfaceLocale: locale || 'en-US',
      outputLocale,
      presentationLanguage: copy.language,
      localized: Boolean(CJK_PRESENTATION_COPY[locale]),
      canonicalRunLocalizationReceipt: canonicalRunLocalizationReceipt(result),
      canonicalRunLocalizationReceiptStatus: canonicalRunLocalizationReceipt(result) ? 'RECORDED' : 'ABSENT',
    },
    market: presentationMarketFor(study, result, locale),
    outputLocale,
    evidenceHash: hashes.evidence || meta.evidenceHash || null,
    populationFrameHash: hashes.populationFrame || meta.populationFrameHash || null,
    sampleLineage: lineage.sampleLineage,
    lineage,
    disclosures: copy.disclosures,
    canonicalProjectExport: projectExport,
  };
}

function validatePresentationEnvelope(payload, expectedContext) {
  if (!isPlainObject(payload) || payload.presentationVersion !== QUALITATIVE_PROJECT_PRESENTATION_VERSION
    || payload.exportType !== 'LIKERTS_QUALITATIVE_PROJECT_PRESENTATION'
    || !isPlainObject(payload.localizationReceipt) || !isPlainObject(payload.market)
    || !isPlainObject(payload.lineage) || !Array.isArray(payload.disclosures)
    || !isPlainObject(payload.canonicalProjectExport)) {
    throw new Error('Local project presentation export is invalid.');
  }
  const { localizationReceipt, market, lineage } = payload;
  if (typeof localizationReceipt.interfaceLocale !== 'string' || typeof localizationReceipt.outputLocale !== 'string'
    || typeof localizationReceipt.presentationLanguage !== 'string' || typeof localizationReceipt.localized !== 'boolean'
    || !['RECORDED', 'ABSENT'].includes(localizationReceipt.canonicalRunLocalizationReceiptStatus)
    || (localizationReceipt.canonicalRunLocalizationReceiptStatus === 'ABSENT'
      ? localizationReceipt.canonicalRunLocalizationReceipt !== null
      : !isPlainObject(localizationReceipt.canonicalRunLocalizationReceipt))
    || typeof payload.outputLocale !== 'string' || payload.outputLocale !== localizationReceipt.outputLocale
    || !nullableText(market.name) || !nullableText(market.countryCode)
    || !nullableHash(payload.evidenceHash) || !nullableHash(payload.populationFrameHash)
    || !nullableText(lineage.projectId) || !nullableText(lineage.studyId) || !nullableText(lineage.runId)
    || !nullableHash(lineage.inputHash) || canonical(payload.sampleLineage) !== canonical(lineage.sampleLineage)
    || payload.disclosures.some((disclosure) => typeof disclosure !== 'string' || !disclosure.trim())) {
    throw new Error('Local project presentation export is invalid.');
  }
  const presentationCopy = CJK_PRESENTATION_COPY[localizationReceipt.interfaceLocale] || EN_PRESENTATION_COPY;
  if (localizationReceipt.presentationLanguage !== presentationCopy.language
    || localizationReceipt.localized !== Boolean(CJK_PRESENTATION_COPY[localizationReceipt.interfaceLocale])
    || canonical(payload.disclosures) !== canonical(presentationCopy.disclosures)) {
    throw new Error('Local project presentation export is invalid.');
  }
  if (!expectedContext) return payload.canonicalProjectExport;
  const expected = presentationLineageFor(payload.canonicalProjectExport, expectedContext.study, expectedContext.result);
  const expectedOutputLocale = expectedContext.result?.meta?.outputLocale || expectedContext.study?.outputLocale || expectedContext.locale || 'en-US';
  const expectedHashes = expectedContext.result?.meta?.hashes || {};
  const expectedEvidenceHash = expectedHashes.evidence || expectedContext.result?.meta?.evidenceHash || null;
  const expectedPopulationFrameHash = expectedHashes.populationFrame || expectedContext.result?.meta?.populationFrameHash || null;
  const expectedReceipt = canonicalRunLocalizationReceipt(expectedContext.result);
  const expectedMarket = presentationMarketFor(expectedContext.study, expectedContext.result, expectedContext.locale);
  if (localizationReceipt.interfaceLocale !== expectedContext.locale
    || canonical(localizationReceipt.canonicalRunLocalizationReceipt) !== canonical(expectedReceipt)
    || localizationReceipt.canonicalRunLocalizationReceiptStatus !== (expectedReceipt ? 'RECORDED' : 'ABSENT')
    || canonical(market) !== canonical(expectedMarket)
    || payload.outputLocale !== expectedOutputLocale
    || payload.evidenceHash !== expectedEvidenceHash
    || payload.populationFrameHash !== expectedPopulationFrameHash
    || canonical(lineage) !== canonical(expected)) {
    throw new Error('This local project presentation does not match the current run lineage.');
  }
  return payload.canonicalProjectExport;
}

function validateEnvelopeAgainstProject(payload, project) {
  const lineage = payload.lineage;
  const runRecords = project.records.filter((record) => record.kind === 'run');
  if (runRecords.length !== 1) throw new Error('Local project presentation export is invalid.');
  const run = runRecords[0];
  if (lineage.projectId !== project.id || lineage.studyId !== run.lineage.studyId || lineage.runId !== run.lineage.runId
    || lineage.inputHash !== run.data.inputHash
    || canonical(lineage.sampleLineage) !== canonical(run.data.sampleLineage)
    || canonical(lineage.sampleLineage) !== canonical(run.lineage.sampleLineage)) {
    throw new Error('Local project presentation export has inconsistent lineage.');
  }
  const contextHashes = project.records
    .filter((record) => record.kind === 'conversation')
    .flatMap((record) => record.data?.turns || [])
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.context || {});
  for (const context of contextHashes) {
    if (context.evidenceHash && context.evidenceHash !== payload.evidenceHash) throw new Error('Local project presentation export has inconsistent evidence lineage.');
    if (context.populationFrameHash && context.populationFrameHash !== payload.populationFrameHash) throw new Error('Local project presentation export has inconsistent population-frame lineage.');
  }
}

export async function validateQualitativeProjectImport(payload, expectedProjectId, expectedContext) {
  const envelope = payload?.presentationVersion === QUALITATIVE_PROJECT_PRESENTATION_VERSION ? payload : null;
  const canonicalProjectExport = envelope ? validatePresentationEnvelope(payload, expectedContext) : payload;
  const store = createMemoryProjectStore();
  const imported = await store.importProject(canonicalProjectExport);
  if (expectedProjectId && imported.id !== expectedProjectId) {
    throw new Error('This local project export does not match the current run.');
  }
  if (envelope) validateEnvelopeAgainstProject(envelope, imported);
  return canonicalProjectExport;
}

export function createProjectMutationQueue() {
  let tail = Promise.resolve();
  return {
    async run(task) {
      const next = tail.then(task, task);
      tail = next.catch(() => {});
      return next;
    },
  };
}

export function downloadProjectJson(filename, payload) {
  const contents = encodeURIComponent(JSON.stringify(payload, null, 2));
  const anchor = document.createElement('a');
  anchor.href = `data:application/json;charset=utf-8,${contents}`;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export const QUALITATIVE_STORAGE_DISCLOSURE = LOCAL_DATA_DISCLOSURE;
