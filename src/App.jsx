import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, GlobeHemisphereWest, Info, Plus } from '@phosphor-icons/react';
import { Brand } from './components/Chrome.jsx';
import { ExampleReportNotice, FirstRunStart } from './components/FirstRunStart.jsx';
import { ResultsWorkspace } from './components/ResultsWorkspace.jsx';
import { RunProgress } from './components/RunProgress.jsx';
import { StudyComposer } from './components/StudyComposer.jsx';
import { initialResult, initialStudy, markets, methodConfigForStudy } from './data.js';
import { I18nProvider, languageOptions, reportLanguageOptions, useI18n } from './i18n.jsx';
import {
  createPendingRun,
  getLatestRun,
  persistCompletedRun,
  readRuns,
  removePendingRun,
} from './lib/studyStore.js';
import { sampleStudyPrefillFromSearch } from './lib/sampleStudyPrefill.js';
import { illustrativeExampleFor } from './lib/localizedIllustrativeExample.js';
import { normalizeStudyLocalizationState, prepareStudyLocalization } from './lib/studyLocalization.js';
import { localizedStudyDefaults } from './lib/localizedStudyDefaults.js';
import {
  matchSupportedLocale,
  removeConsumedInterfaceLocale,
  resolveInterfaceLocalePreference,
  resolveSupportedLocalePreference,
  setInterfaceLocaleInSearch,
} from './lib/interfaceLocale.js';
import { withInputHashLineage } from './lib/inputHashLineage.js';
import { reportClientError } from './lib/clientErrorTelemetry.js';
import { createPublicRequestError, thrownErrorCode } from './lib/publicRequestError.js';
import { compareRepeatRuns } from './lib/repeatRunStability.js';
import { trackPilotEvent } from './lib/pilotAnalytics.js';
import { prepareResearchMaterialEvidence, researchGroundingManifest, restoreResearchMaterialsFromEvidence } from './lib/researchGrounding.js';
import { coarseStudyFailureCategory } from './lib/webAnalyticsPolicy.js';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';
import { assertLocalizationExecutionAllowed } from '../server/localization-request.js';
import {
  buildQualitativeMaterialRecord,
  buildQualitativeRunRecord,
  buildQualitativeProjectPresentationEnvelope,
  conversationRecordFromState,
  createBrowserQualitativeProjectStore,
  createProjectMutationQueue,
  createQualitativeProjectDescriptor,
  downloadProjectJson,
  MAX_QUALITATIVE_PROJECT_IMPORT_BYTES,
  qualitativeConversationsFromProject,
  qualitativeProjectStats,
  QUALITATIVE_STORAGE_DISCLOSURE,
  validateQualitativeProjectImport,
} from './lib/qualitativeProjects.js';

const EMPTY_QUALITATIVE_STATS = Object.freeze({
  recordCount: 0,
  conversationCount: 0,
  interviewTurnPairs: 0,
  materialCount: 0,
  runCount: 0,
});

function studyAnalyticsProperties(study, groundingMaterials, trigger = 'composer') {
  return {
    mode: study?.researchMode === 'deep' ? 'deep' : 'quick',
    method: study?.researchMethod || 'GENERAL_LIKERT',
    locale: study?.outputLocale || 'en-US',
    trigger: trigger === 'replay' ? 'replay' : 'composer',
    evidence: Array.isArray(groundingMaterials) && groundingMaterials.length > 0 ? 'provided' : 'none',
  };
}

function currentLocalizationReceiptForResult(result) {
  const receipt = result?.meta?.localizationReceipt
    || result?.meta?.localization
    || result?.meta?.reproducibility?.localization
    || result?.run?.localization
    || result?.localizationReceipt
    || null;
  if (!receipt || receipt.registryVersion !== LOCALIZATION_REGISTRY_VERSION) return null;
  try {
    assertLocalizationExecutionAllowed(receipt);
    return receipt;
  } catch {
    return null;
  }
}

const isQualitativeProjectEligible = (result) => Boolean(
  result?.researchDesign?.segmentPerspectiveEligible === true
  && result?.meta?.studyId
  && result?.meta?.runId
  && /^[a-f0-9]{64}$/i.test(String(result?.meta?.inputHash || ''))
  && currentLocalizationReceiptForResult(result)
);

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const missingProject = (error) => /not found|expired/i.test(error?.message || '');

async function ensureQualitativeProject(store, descriptor) {
  try {
    return await store.getProject(descriptor.id);
  } catch (error) {
    if (!missingProject(error)) throw error;
    return store.createProject(descriptor);
  }
}

async function syncProjectRecord(store, project, candidate) {
  const existing = project.records.find((record) => record.id === candidate.id);
  if (!existing) return store.appendRecord(project.id, candidate);
  if (sameJson(existing.data, candidate.data)) return project;
  return store.updateRecord(project.id, existing.id, existing.version, { data: candidate.data });
}

async function syncQualitativeProjectBase(store, descriptor, study, result, groundingMaterials) {
  let project = await ensureQualitativeProject(store, descriptor);
  project = await syncProjectRecord(store, project, buildQualitativeRunRecord(project.id, study, result));
  for (const material of groundingMaterials) {
    if (!material?.id || !material?.contentHash || !Number.isInteger(material?.originalCharacterCount)) continue;
    project = await syncProjectRecord(store, project, buildQualitativeMaterialRecord(project.id, result, material));
  }
  return project;
}

function evidenceFromRun(run, study) {
  const supplied = run?.evidence?.catalog || run?.evidence?.ledger || run?.evidence?.sources || [];
  const sourceEntries = supplied.map((source, index) => {
    const runtimeUntitled = ['Untitled source', 'User-provided evidence'].includes(source.title);
    const hasVisibleTitle = Boolean(source.title && !runtimeUntitled);
    return {
      id: source.id || `source-${index + 1}`,
      claim: hasVisibleTitle ? source.title : source.url || '',
      ...(!hasVisibleTitle && !source.url || runtimeUntitled ? { claimKey: 'evidenceClaimSourceNumber', claimVariables: { count: index + 1 } } : {}),
      sourceTitle: hasVisibleTitle ? source.title : '',
      sourceUrl: source.url || '',
      excerpt: source.excerpt || '',
      originalLanguage: source.originalLanguage || null,
      sourceKind: source.sourceKind || null,
      clientMaterialId: source.clientMaterialId || null,
      contentHandling: source.contentHandling || null,
      detectedType: source.detectedType || null,
      declaredMime: source.declaredMime || null,
      contentHash: source.contentHash || null,
      clientContentHash: source.clientContentHash || null,
      extractedTextHash: source.extractedTextHash || null,
      extractionVersion: source.extractionVersion || null,
      originalByteCount: source.originalByteCount || null,
      originalCharacterCount: source.originalCharacterCount || null,
      locators: Array.isArray(source.locators) ? source.locators : [],
      retrievalVersion: source.retrievalVersion || null,
      retrievalIndexHash: source.retrievalIndexHash || null,
      retrievedChunkIds: Array.isArray(source.retrievedChunkIds) ? source.retrievedChunkIds : [],
      truncated: source.truncated || false,
      evidenceClass: source.evidenceClass === 'PROVIDED_RESEARCH_MATERIAL' || source.sourceKind ? 'PROVIDED_RESEARCH_MATERIAL' : source.evidenceClass === 'PROVIDED_SOURCE' || source.acquisition === 'USER_PROVIDED' ? 'PROVIDED_SOURCE' : 'RETRIEVED_SOURCE',
      traceKey: source.sourceKind ? 'uploadedMaterialTrace' : 'sourceTrace',
      riskKey: source.sourceKind ? 'uploadedMaterialRisk' : 'groundingRisk',
    };
  });

  const assumptionEntries = study.assumptions
    ? study.assumptions.split(/[.;\n]+/).map((assumption) => assumption.trim()).filter(Boolean).slice(0, 4).map((assumption, index) => ({
      id: `assumption-${index}`,
      claim: assumption,
      evidenceClass: 'USER_ASSUMPTION',
      traceKey: 'assumptionTrace',
      riskKey: 'requiresValidation',
    }))
    : [];

  const methodResult = run?.methodResult || null;
  const modelEntries = methodResult?.kind && methodResult.kind !== 'DIRECTIONAL_DISTRIBUTION' ? [
    {
      id: 'model-method-result',
      claim: '',
      claimKey: 'methodSpecificModelOutput',
      evidenceClass: 'MODEL_INFERENCE',
      traceKey: 'distributionTrace',
      riskKey: 'methodDisclosure',
    },
  ] : [
    {
      id: 'model-distribution',
      claim: '',
      claimKey: 'finalLikertDistribution',
      evidenceClass: 'MODEL_INFERENCE',
      traceKey: 'distributionTrace',
      riskKey: 'notRepresentative',
    },
    {
      id: 'model-segments',
      claim: '',
      claimKey: 'audienceSegmentDifferences',
      evidenceClass: 'MODEL_INFERENCE',
      traceKey: 'segmentTrace',
      riskKey: 'segmentNotSampled',
    },
    {
      id: 'model-verbatims',
      claim: '',
      claimKey: 'responseScoreReasons',
      evidenceClass: 'SYNTHETIC_VERBATIM_THEME',
      traceKey: 'verbatimTrace',
      riskKey: 'notInterviewNote',
    },
  ];

  return [...sourceEntries, ...assumptionEntries, ...modelEntries];
}

const blankStudy = (locale = 'en-US') => {
  const defaults = localizedStudyDefaults(locale);
  return {
    ...initialStudy,
    prompt: '',
    audience: '',
    concept: '',
    assumptions: '',
    outputLocale: locale,
    instrumentLocale: '',
    priceUnit: defaults.priceUnit,
  };
};

function normalizePayload(payload, study, savedLocally, groundingManifest = null) {
  const run = payload.run || {};
  const credibility = run.credibility || payload.meta?.credibility || {};
  const populationFrame = run.populationFrame || payload.populationFrame || payload.meta?.populationFrame || payload.study?.populationFrame || null;
  const modelCard = run.modelCard || payload.modelCard || payload.meta?.modelCard || null;
  const researchDesign = run.researchDesign || payload.researchDesign || payload.meta?.researchDesign || null;
  const methodResult = run.methodResult || payload.methodResult || payload.meta?.methodResult || payload.study?.methodResult || null;
  const humanResearchHandoff = run.humanResearchHandoff || payload.humanResearchHandoff || null;
  const sourceCount = run.evidence?.ledger?.filter((source) => source.url).length ?? 0;
  const reviewStage = run.stages?.find((stage) => stage.stage === 'adjudication');
  const sourceCatalog = run.evidence?.catalog || (run.evidence?.ledger || []).map((source, index) => ({
    id: `evidence-${index + 1}`,
    title: source.title || source.url || '',
    url: source.url || null,
    excerpt: source.excerpt || '',
    evidenceClass: source.acquisition === 'USER_PROVIDED' ? 'PROVIDED_SOURCE' : 'RETRIEVED_SOURCE',
  }));
  const assumptionCatalog = run.assumptionCatalog || (study.assumptions ? study.assumptions.split(/[.;\n]+/).map((text) => text.trim()).filter(Boolean).slice(0, 8).map((text, index) => ({ id: `assumption-${index + 1}`, text })) : []);
  const localizationReceipt = run.localization
    || payload.meta?.localizationReceipt
    || payload.meta?.localization
    || payload.meta?.reproducibility?.localization
    || payload.localizationReceipt
    || payload.localization
    || null;

  return withInputHashLineage({
    ...payload.study,
    populationFrame,
    modelCard,
    researchDesign,
    methodResult,
    humanResearchHandoff,
    researchGrounding: groundingManifest,
    segmentPerspectiveContext: {
      localizationReceipt,
      evidence: sourceCatalog.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url || null,
        excerpt: source.excerpt,
        originalLanguage: source.originalLanguage || null,
        evidenceClass: source.evidenceClass,
        sourceKind: source.sourceKind || null,
        clientMaterialId: source.clientMaterialId || null,
        contentHash: source.contentHash || null,
        clientContentHash: source.clientContentHash || null,
        extractedTextHash: source.extractedTextHash || null,
        extractionVersion: source.extractionVersion || null,
        originalByteCount: source.originalByteCount || null,
        originalCharacterCount: source.originalCharacterCount || null,
        locators: Array.isArray(source.locators) ? source.locators : [],
        retrievalVersion: source.retrievalVersion || null,
        retrievalIndexHash: source.retrievalIndexHash || null,
        retrievedChunkIds: Array.isArray(source.retrievedChunkIds) ? source.retrievedChunkIds : [],
        truncated: source.truncated || false,
      })),
      assumptions: assumptionCatalog.map((assumption) => ({ id: assumption.id, text: assumption.text })),
      evidenceHash: run.evidence?.evidenceHash || null,
      populationFrameHash: run.reproducibility?.populationFrameHash || modelCard?.populationFrameHash || null,
      researchDesignHash: run.reproducibility?.researchDesignHash || payload.meta?.researchDesignHash || null,
      modelCardHash: run.reproducibility?.modelCardHash || payload.meta?.modelCardHash || null,
    },
    evidence: payload.evidence?.entries || evidenceFromRun(run, study),
    evidenceMeta: {
      mode: run.evidence?.mode || payload.meta?.evidenceMode || 'model-only',
      noteKey: run.evidence?.mode === 'PRIOR_ONLY' ? 'noSourcesNote' : 'evidenceLedgerNote',
    },
    credibility: {
      ...credibility,
      sourceCount,
      researchMaterialCount: sourceCatalog.filter((source) => source.sourceKind).length,
      populationFit: populationFrame?.populationFit || null,
      modelAgreement: null,
      assumptionCount: study.assumptions ? study.assumptions.split(/[.;\n]+/).filter(Boolean).length : 0,
    },
    methodology: {
      ...(payload.study?.methodology || {}),
      promptVersion: payload.study?.methodology?.promptVersion || null,
      schemaVersion: payload.study?.methodology?.schemaVersion || null,
      normalization: methodResult?.kind === 'DIRECTIONAL_DISTRIBUTION' || !methodResult ? 'Σ p(1…5) = 100%' : null,
      normalizationKey: methodResult?.kind === 'DIRECTIONAL_DISTRIBUTION' || !methodResult ? null : 'normalizationNotApplicable',
      knownLimits: credibility.limitations || payload.study.cautions,
    },
    adjudication: {
      decision: reviewStage?.status === 'completed' ? 'MODEL_REVIEW_COMPLETED' : 'MODEL_REVIEW_FALLBACK',
      humanFollowUp: payload.study.takeaway?.match(/(?:validate|test|follow)[^.]*\.?$/i)?.[0] || '',
    },
    meta: {
      ...payload.meta,
      runId: payload.meta?.runId || run.runId,
      studyId: payload.meta?.studyId || run.studyId,
      lineage: payload.meta?.modelLineage || run.modelLineage || [],
      modelLineage: payload.meta?.modelLineage || run.modelLineage || [],
      stageStatuses: run.stages || [],
      reproducibility: run.reproducibility || payload.meta?.reproducibility || null,
      evidenceHash: run.evidence?.evidenceHash,
      inputHash: run.inputHash,
      populationFrameHash: run.reproducibility?.populationFrameHash || modelCard?.populationFrameHash || null,
      humanResearchHandoffHash: run.reproducibility?.humanResearchHandoffHash || payload.meta?.humanResearchHandoffHash || null,
      sampleLineage: payload.meta?.sampleLineage || run.sampleLineage || study.sampleLineage || null,
      localization: localizationReceipt,
      localizationReceipt,
      hashes: { evidence: run.evidence?.evidenceHash, input: run.inputHash, populationFrame: run.reproducibility?.populationFrameHash || modelCard?.populationFrameHash || null, researchDesign: run.reproducibility?.researchDesignHash || null, modelCard: run.reproducibility?.modelCardHash || null, humanResearchHandoff: run.reproducibility?.humanResearchHandoffHash || null },
      persistence: payload.persistence?.durableStoreConfigured ? 'durable' : savedLocally ? 'local' : 'session',
      market: study.market,
      outputLocale: study.outputLocale,
    },
  });
}

function AppContent({ uiLocale, setUiLocale, studyDefaultLocale }) {
  const { dir, htmlLang, locale, t } = useI18n();
  const illustrativeExample = useMemo(() => illustrativeExampleFor(uiLocale), [uiLocale]);
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const selectedInterfaceLanguage = languageOptions.find((language) => language.value === uiLocale) || languageOptions[0];
  const interfaceCopyStatusKey = selectedInterfaceLanguage.copyStatus === 'native-reviewed'
    ? 'copyStatusNativeReviewed'
    : 'copyStatusMachineDrafted';
  const samplePrefill = useMemo(() => sampleStudyPrefillFromSearch(window.location.search), []);
  const restoredRun = useMemo(() => samplePrefill ? null : getLatestRun(), [samplePrefill]);
  const restoredRepeatRuns = useMemo(() => {
    const inputHash = restoredRun?.result?.meta?.inputHash;
    if (!inputHash) return [];
    return readRuns()
      .filter((run) => run.status === 'complete' && run.result?.meta?.inputHash === inputHash)
      .map((run) => run.result)
      .reverse();
  }, [restoredRun]);
  const restoredStudy = useMemo(
    () => samplePrefill?.study || { ...initialStudy, ...normalizeStudyLocalizationState(restoredRun?.study || {}) },
    [restoredRun, samplePrefill],
  );
  const [study, setStudy] = useState(() => samplePrefill || restoredRun ? restoredStudy : blankStudy(studyDefaultLocale));
  const [activeStudy, setActiveStudy] = useState(restoredStudy);
  const [result, setResult] = useState(() => withInputHashLineage(restoredRun?.result || initialResult));
  const [repeatRuns, setRepeatRuns] = useState(restoredRepeatRuns);
  const [groundingMaterials, setGroundingMaterials] = useState(() => restoreResearchMaterialsFromEvidence(restoredRun?.result?.evidence));
  const [segmentConversations, setSegmentConversations] = useState({});
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [qualitativeProject, setQualitativeProject] = useState({
    status: 'idle',
    available: false,
    projectId: null,
    disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
    stats: EMPTY_QUALITATIVE_STATS,
    error: '',
  });
  const [running, setRunning] = useState(false);
  const [runComplete, setRunComplete] = useState(Boolean(restoredRun));
  const [briefOpen, setBriefOpen] = useState(samplePrefill?.shouldOpenBrief === true);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [pendingRunStatus, setPendingRunStatus] = useState(null);
  const [error, setError] = useState(() => samplePrefill?.rerunBlocked
    ? { key: 'localizationConfigurationError', variables: { code: samplePrefill.rerunBlocked.code } }
    : '');
  const errorMessage = typeof error === 'object' && error?.key
    ? t(error.key, error.variables)
    : error;
  const runInFlightRef = useRef(false);
  const briefTriggerRef = useRef(null);
  const qualitativeStoreRef = useRef(null);
  const qualitativeMutationQueueRef = useRef(createProjectMutationQueue());

  useEffect(() => {
    document.documentElement.lang = htmlLang;
    document.documentElement.dir = dir;
    document.title = `${t('hero')} | Likerts`;
  }, [dir, htmlLang, t]);

  useEffect(() => {
    if (!briefOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      document.getElementById('research-question')?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [briefOpen]);

  useEffect(() => {
    if (!isQualitativeProjectEligible(result) || !runComplete) {
      setSegmentConversations({});
      setSelectedSegmentId(null);
      setQualitativeProject({
        status: 'idle',
        available: false,
        projectId: null,
        disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
        stats: EMPTY_QUALITATIVE_STATS,
        error: '',
      });
      return undefined;
    }

    let cancelled = false;
    const descriptor = createQualitativeProjectDescriptor(activeStudy, result);

    const loadProject = async () => {
      if (!descriptor) return;
      if (!qualitativeStoreRef.current) qualitativeStoreRef.current = createBrowserQualitativeProjectStore();
      const store = qualitativeStoreRef.current;
      if (!store) {
        if (!cancelled) {
          setQualitativeProject({
            status: 'unsupported',
            available: false,
            projectId: descriptor.id,
            disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
            stats: EMPTY_QUALITATIVE_STATS,
            error: '',
          });
        }
        return;
      }
      const project = await qualitativeMutationQueueRef.current.run(() => syncQualitativeProjectBase(store, descriptor, activeStudy, result, groundingMaterials));
      if (cancelled) return;
      setSegmentConversations(qualitativeConversationsFromProject(project));
      setSelectedSegmentId(null);
      setQualitativeProject({
        status: 'ready',
        available: true,
        projectId: project.id,
        disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
        stats: qualitativeProjectStats(project),
        error: '',
      });
    };

    loadProject().catch((projectError) => {
      if (cancelled) return;
      setQualitativeProject((current) => ({
        ...current,
        status: 'error',
        available: false,
        projectId: descriptor?.id || null,
        disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
        stats: EMPTY_QUALITATIVE_STATS,
        error: t('localProjectError', { code: thrownErrorCode(projectError, 'LOCAL_PROJECT_ERROR') }),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeStudy, groundingMaterials, result, runComplete, t]);

  useEffect(() => {
    if (qualitativeProject.status !== 'ready' || !qualitativeProject.projectId || !isQualitativeProjectEligible(result)) return undefined;
    const store = qualitativeStoreRef.current;
    const conversationEntries = Object.entries(segmentConversations)
      .filter(([, conversation]) => Array.isArray(conversation?.turns) && conversation.turns.length > 0);
    if (!store || !conversationEntries.length) return undefined;

    let cancelled = false;

    const persistConversations = async () => {
      const project = await qualitativeMutationQueueRef.current.run(async () => {
        let currentProject = await store.getProject(qualitativeProject.projectId);
        for (const [segmentId, conversation] of conversationEntries) {
          const candidate = conversationRecordFromState(currentProject.id, result, segmentId, conversation);
          currentProject = await syncProjectRecord(store, currentProject, candidate);
        }
        return currentProject;
      });
      if (cancelled) return;
      setQualitativeProject((current) => current.projectId === project.id
        ? { ...current, stats: qualitativeProjectStats(project), error: '' }
        : current);
    };

    persistConversations().catch((projectError) => {
      if (cancelled) return;
      setQualitativeProject((current) => ({
        ...current,
        status: 'error',
        error: t('localProjectError', { code: thrownErrorCode(projectError, 'LOCAL_PROJECT_ERROR') }),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [qualitativeProject.projectId, qualitativeProject.status, result, segmentConversations, t]);

  const runStudy = async (inputStudy = study, trigger = 'composer') => {
    if (runInFlightRef.current) return;
    const analyticsProperties = studyAnalyticsProperties(inputStudy, groundingMaterials, trigger);
    if (inputStudy?.sampleRerunBlock) {
      trackPilotEvent('study_failed', {
        ...analyticsProperties,
        category: coarseStudyFailureCategory(inputStudy.sampleRerunBlock.code),
      });
      setError({ key: 'localizationConfigurationError', variables: { code: inputStudy.sampleRerunBlock.code } });
      return;
    }
    const normalizedInputStudy = normalizeStudyLocalizationState(inputStudy);
    const sanitizedStudy = {
      ...initialStudy,
      ...normalizedInputStudy,
      researchMethod: normalizedInputStudy.researchMethod || 'GENERAL_LIKERT',
      sources: (normalizedInputStudy.sources || []).map((source) => source.trim()).filter(Boolean),
      sourceLanguages: normalizedInputStudy.sourceLanguages || [],
    };
    const selectedMarket = markets.find((market) => market.value === sanitizedStudy.market);
    let preparedLocalization;
    try {
      preparedLocalization = prepareStudyLocalization(sanitizedStudy, selectedMarket, 'AUTO');
    } catch (localizationError) {
      const code = localizationError.code || 'LOCALIZATION_UNRESOLVED';
      trackPilotEvent('study_failed', {
        ...analyticsProperties,
        category: coarseStudyFailureCategory(code),
      });
      setError({ key: 'localizationConfigurationError', variables: { code } });
      return;
    }
    const runStudyRecord = {
      ...sanitizedStudy,
      localization: preparedLocalization.localization,
      localizationReceipt: preparedLocalization.receipt,
    };
    runInFlightRef.current = true;
    const methodConfig = methodConfigForStudy(runStudyRecord);
    const pendingRun = createPendingRun(runStudyRecord);
    const previousRunComplete = runComplete;
    setPendingRunStatus({ runId: pendingRun.id, stages: [] });
    setExampleOpen(false);
    setRunning(true);
    setError('');
    trackPilotEvent('study_started', analyticsProperties);

    try {
      const response = await fetch('/api/synthetic-study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: runStudyRecord.prompt,
          audience: runStudyRecord.audience,
          panelSize: 100,
          sourceUrls: sanitizedStudy.sources,
          evidence: await prepareResearchMaterialEvidence(
            groundingMaterials,
            [runStudyRecord.prompt, runStudyRecord.audience, runStudyRecord.assumptions].filter(Boolean).join(' '),
          ),
          assumptions: runStudyRecord.assumptions,
          evidencePolicy: 'AUTO',
          ...preparedLocalization.aliases,
          localization: preparedLocalization.localization,
          populationFrame: runStudyRecord.populationFrame || {},
          researchMode: runStudyRecord.researchMode || 'quick',
          researchMethod: runStudyRecord.researchMethod,
          ...(methodConfig ? { methodConfig } : {}),
          ...(runStudyRecord.sampleLineage ? { sampleLineage: runStudyRecord.sampleLineage } : {}),
          clientRunId: pendingRun.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw createPublicRequestError(payload, response.status);

      const draftResult = normalizePayload(payload, runStudyRecord, false, researchGroundingManifest(groundingMaterials));
      const savedLocally = persistCompletedRun(pendingRun, runStudyRecord, draftResult);
      const nextResult = {
        ...draftResult,
        meta: { ...draftResult.meta, persistence: payload.persistence?.durableStoreConfigured ? 'durable' : savedLocally ? 'local' : 'session' },
      };
      if (savedLocally) persistCompletedRun(pendingRun, runStudyRecord, nextResult);
      setResult(nextResult);
      setRepeatRuns((previous) => {
        const comparable = previous.filter((prior) => prior.meta?.inputHash === nextResult.meta?.inputHash);
        return [...comparable, nextResult].slice(-6);
      });
      setActiveStudy(runStudyRecord);
      setStudy(runStudyRecord);
      setRunComplete(true);
      setBriefOpen(false);
      trackPilotEvent('study_completed', {
        ...analyticsProperties,
        persistence: nextResult.meta.persistence,
      });
    } catch (requestError) {
      removePendingRun(pendingRun.id);
      const code = thrownErrorCode(requestError);
      reportClientError(requestError, { captureKind: 'caught-request', action: 'study-run' });
      trackPilotEvent('study_failed', {
        ...analyticsProperties,
        category: coarseStudyFailureCategory(code),
      });
      const reference = requestError?.correlationId ? `${code} · ${requestError.correlationId}` : code;
      setError({ key: 'studyRunError', variables: { code: reference } });
      setRunComplete(previousRunComplete);
    } finally {
      runInFlightRef.current = false;
      setPendingRunStatus(null);
      setRunning(false);
    }
  };

  const exportStudy = () => {
    const exportResult = withInputHashLineage(result);
    const payload = {
      exportType: t('evidencePackExportType'),
      exportedAt: new Date().toISOString(),
      syntheticOnly: true,
      study: activeStudy,
      result: exportResult,
      lineage: {
        sampleLineage: exportResult?.meta?.sampleLineage || activeStudy?.sampleLineage || null,
        inputHashLineage: exportResult?.meta?.inputHashLineage || null,
      },
      repeatRunStability: compareRepeatRuns(repeatRuns),
    };
    const contents = encodeURIComponent(JSON.stringify(payload, null, 2));
    const anchor = document.createElement('a');
    anchor.href = `data:application/json;charset=utf-8,${contents}`;
    anchor.download = `likerts-${result.meta?.runId || 'study'}-evidence-pack.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const exportQualitativeProject = async () => {
    try {
      const store = qualitativeStoreRef.current;
      if (!store || !qualitativeProject.projectId) throw Object.assign(new Error('Local project unavailable'), { code: 'LOCAL_PROJECT_UNAVAILABLE' });
      const exported = await store.exportProject(qualitativeProject.projectId);
      downloadProjectJson(`likerts-${result.meta?.runId || 'study'}-qualitative-project.json`, buildQualitativeProjectPresentationEnvelope(exported, {
        study: activeStudy,
        result,
        locale,
      }));
      setQualitativeProject((current) => ({ ...current, error: '' }));
    } catch (projectError) {
      setQualitativeProject((current) => ({ ...current, error: t('localProjectError', { code: thrownErrorCode(projectError, 'LOCAL_PROJECT_ERROR') }) }));
    }
  };

  const importQualitativeProject = async (file) => {
    try {
      const store = qualitativeStoreRef.current || createBrowserQualitativeProjectStore();
      qualitativeStoreRef.current = store;
      if (!store || !qualitativeProject.projectId) throw Object.assign(new Error('Local project unavailable'), { code: 'LOCAL_PROJECT_UNAVAILABLE' });
      if (!file || typeof file.text !== 'function') throw Object.assign(new Error('Unreadable local project'), { code: 'LOCAL_PROJECT_FILE_INVALID' });
      if (Number.isFinite(file.size) && file.size > MAX_QUALITATIVE_PROJECT_IMPORT_BYTES) throw Object.assign(new Error('Local project file too large'), { code: 'LOCAL_PROJECT_FILE_TOO_LARGE' });
      const payload = JSON.parse(await file.text());
      const canonicalProjectExport = await validateQualitativeProjectImport(payload, qualitativeProject.projectId, {
        study: activeStudy,
        result,
        locale,
      });
      // The store validates with its actual persistence policy before a
      // single-transaction replacement. Never delete first: a rejected
      // (for example, SESSION-retention) export must leave the current run.
      const imported = await qualitativeMutationQueueRef.current.run(() => store.replaceProject(canonicalProjectExport));
      setSegmentConversations(qualitativeConversationsFromProject(imported));
      setSelectedSegmentId(null);
      setQualitativeProject({
        status: 'ready',
        available: true,
        projectId: imported.id,
        disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
        stats: qualitativeProjectStats(imported),
        error: '',
      });
    } catch (projectError) {
      setQualitativeProject((current) => ({ ...current, error: t('localProjectError', { code: thrownErrorCode(projectError, 'LOCAL_PROJECT_ERROR') }) }));
    }
  };

  const clearQualitativeProject = async () => {
    try {
      const descriptor = createQualitativeProjectDescriptor(activeStudy, result);
      const store = qualitativeStoreRef.current;
      if (!store || !descriptor) throw Object.assign(new Error('Local project unavailable'), { code: 'LOCAL_PROJECT_UNAVAILABLE' });
      const project = await qualitativeMutationQueueRef.current.run(async () => {
        await store.deleteProject(descriptor.id);
        return syncQualitativeProjectBase(store, descriptor, activeStudy, result, groundingMaterials);
      });
      setSegmentConversations({});
      setSelectedSegmentId(null);
      setQualitativeProject({
        status: 'ready',
        available: true,
        projectId: project.id,
        disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
        stats: qualitativeProjectStats(project),
        error: '',
      });
    } catch (projectError) {
      setQualitativeProject((current) => ({ ...current, error: t('localProjectError', { code: thrownErrorCode(projectError, 'LOCAL_PROJECT_ERROR') }) }));
    }
  };

  const exportHumanResearchHandoff = async (format, handoff) => {
    if (!handoff) throw new TypeError('A completed human-research handoff is required.');
    const exports = await import('./lib/humanResearchExports.js');
    const builders = {
      csv: { build: exports.humanResearchHandoffToCsv, mime: 'text/csv;charset=utf-8', extension: 'csv' },
      xlsx: { build: exports.humanResearchHandoffToXlsx, mime: exports.HUMAN_RESEARCH_XLSX_MIME, extension: 'xlsx' },
      txt: { build: exports.humanResearchBriefText, mime: 'text/plain;charset=utf-8', extension: 'txt' },
      json: { build: exports.humanResearchReceiptJson, mime: 'application/json;charset=utf-8', extension: 'json' },
    };
    const selected = builders[format];
    if (!selected) throw new TypeError('Unsupported human-research export format.');
    const blob = new Blob([selected.build(handoff)], { type: selected.mime });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = exports.safeHandoffFilename(handoff, selected.extension);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    trackPilotEvent('human_validation_exported', {
      method: activeStudy.researchMethod || 'GENERAL_LIKERT',
      locale: activeStudy.outputLocale || 'en-US',
      format,
    });
  };

  const askSegmentPerspective = async ({ segment, question, intent, history, conversationId, expectedTurnIndex, parentTurnId, stimuli = [], counterfactual }) => {
    const context = result.segmentPerspectiveContext || {};
    const localizationReceipt = result.meta?.localizationReceipt
      || result.meta?.localization
      || result.meta?.reproducibility?.localization
      || context.localizationReceipt
      || null;
    const response = await fetch('/api/segment-perspective', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyId: result.meta?.studyId,
        runId: result.meta?.runId,
        ...(conversationId ? { conversationId } : {}),
        expectedTurnIndex,
        parentTurnId: parentTurnId || null,
        segment: { id: segment.id, label: segment.label, distribution: segment.values },
        question,
        intent,
        history,
        stimuli,
        ...(counterfactual ? { counterfactual } : {}),
        grounding: {
          localizationReceipt,
          outputLocale: localizationReceipt?.report?.locale || activeStudy.outputLocale || 'en-US',
          evidenceHash: context.evidenceHash || null,
          populationFrameHash: context.populationFrameHash || null,
          researchDesignHash: context.researchDesignHash || null,
          modelCardHash: context.modelCardHash || null,
          researchMethod: result.researchDesign?.methodId || 'GENERAL_LIKERT',
          researchMethodVersion: result.researchDesign?.methodVersion || 'general-likert-v1',
          segments: (result.segments || []).filter((item) => item.id).map((item) => ({ id: item.id, label: item.label, distribution: item.values })),
          evidence: (context.evidence || []).map((source) => ({
            id: source.id,
            title: source.title,
            url: source.url || null,
                excerpt: source.excerpt,
                originalLanguage: source.originalLanguage || null,
                evidenceClass: source.evidenceClass === 'PROVIDED_RESEARCH_MATERIAL'
              ? 'PROVIDED_RESEARCH_MATERIAL'
              : source.evidenceClass === 'PROVIDED_SOURCE' || source.evidenceClass === 'RETRIEVED_SOURCE'
                ? source.evidenceClass
                : 'MODEL_INFERENCE',
          })),
          assumptions: context.assumptions || [],
          unsupportedCharacteristics: result.populationFrame?.unsupportedCharacteristics || [],
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw createPublicRequestError(payload, response.status);
    return payload;
  };

  const rememberBriefTrigger = (target) => {
    if (target instanceof HTMLElement) briefTriggerRef.current = target;
  };

  const openBrief = (target) => {
    rememberBriefTrigger(target);
    setBriefOpen(true);
  };

  const closeBrief = () => {
    setBriefOpen(false);
    window.requestAnimationFrame(() => {
      const fallback = document.getElementById('first-run-start-button') || document.querySelector('.new-study-button');
      const target = briefTriggerRef.current?.isConnected ? briefTriggerRef.current : fallback;
      target?.focus();
    });
  };

  const hasMeaningfulStudyWork = runComplete
    || !sameJson(study, blankStudy(studyDefaultLocale))
    || groundingMaterials.length > 0
    || repeatRuns.length > 0
    || Object.values(segmentConversations).some((conversation) => conversation?.turns?.length > 0);

  const startNewStudy = (event) => {
    if (hasMeaningfulStudyWork && !window.confirm(t('startNewStudyConfirm'))) return;
    const nextStudy = blankStudy(studyDefaultLocale);
    rememberBriefTrigger(event?.currentTarget);
    setStudy(nextStudy);
    setActiveStudy(nextStudy);
    setResult(withInputHashLineage(initialResult));
    setRepeatRuns([]);
    setGroundingMaterials([]);
    setSegmentConversations({});
    setSelectedSegmentId(null);
    setQualitativeProject({
      status: 'idle',
      available: false,
      projectId: null,
      disclosure: QUALITATIVE_STORAGE_DISCLOSURE,
      stats: EMPTY_QUALITATIVE_STATS,
      error: '',
    });
    setRunComplete(false);
    setExampleOpen(false);
    setError('');
    setBriefOpen(true);
  };

  const beginFirstStudy = (event) => {
    if (exampleOpen) setStudy(blankStudy(studyDefaultLocale));
    rememberBriefTrigger(event?.currentTarget);
    setExampleOpen(false);
    setError('');
    setBriefOpen(true);
  };

  const viewExample = () => {
    setBriefOpen(false);
    setExampleOpen(true);
    setError('');
  };

  const showStartState = !runComplete && !briefOpen && !exampleOpen && !running;
  const showReport = runComplete || exampleOpen;
  const displayedStudy = exampleOpen ? illustrativeExample.study : activeStudy;
  const displayedResult = exampleOpen ? illustrativeExample.result : result;

  return (
    <div className="app-shell">
      <a className="app-skip-link" href="#workspace">{t('skipToWorkspace')}</a>
      <header className="public-header">
        <div className="public-header-inner">
          <Brand />
          <div className="header-controls">
            <label className="header-select market-selector">
              <GlobeHemisphereWest size={17} />
              <span className="sr-only">{t('market')}</span>
              <select
                aria-label={t('market')}
                disabled={running}
                onChange={(event) => {
                  setStudy({ ...study, market: event.target.value });
                  openBrief(event.currentTarget);
                }}
                value={study.market}
              >
                {markets.map((market) => <option key={market.value} value={market.value}>{market.region ? regionNames.of(market.region) : t('global')}</option>)}
              </select>
              <CaretDown size={14} />
            </label>
            <label className="header-select language-picker">
              <span className="sr-only">{t('interfaceLanguage')}</span>
              <select aria-describedby="interface-localization-status" aria-label={t('interfaceLanguage')} disabled={running} onChange={(event) => setUiLocale(event.target.value)} value={uiLocale}>
                {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
              </select>
              <span className="header-localization-status" data-copy-status={selectedInterfaceLanguage.copyStatus} data-native-review-status={selectedInterfaceLanguage.nativeReviewStatus} id="interface-localization-status">{t(interfaceCopyStatusKey)}</span>
              <CaretDown size={14} />
            </label>
            {!showStartState && !exampleOpen ? <button className={briefOpen ? 'new-study-button is-secondary' : 'new-study-button'} disabled={running} onClick={startNewStudy} type="button"><Plus size={17} /> {t('newStudy')}</button> : null}
          </div>
        </div>
      </header>
      <main className="workspace" id="workspace" tabIndex="-1">
        {!showStartState ? <h1 className="sr-only">{t('hero')}</h1> : null}
        {showStartState ? <FirstRunStart onStart={beginFirstStudy} onViewExample={viewExample} /> : null}

        {briefOpen ? (
          <StudyComposer
            groundingMaterials={groundingMaterials}
            onClose={closeBrief}
            onRun={() => runStudy(study, 'composer')}
            onGroundingMaterialsChange={setGroundingMaterials}
            running={running}
            hasExistingReport={runComplete}
            setStudy={setStudy}
            study={study}
            uiLocale={uiLocale}
          />
        ) : null}

        {errorMessage ? <div className="generation-error" role="alert"><Info size={18} /> {errorMessage}</div> : null}

        {running && pendingRunStatus ? (
          <RunProgress
            running={running}
            runId={pendingRunStatus.runId}
            stages={pendingRunStatus.stages}
          />
        ) : null}

        {exampleOpen ? <ExampleReportNotice onStart={beginFirstStudy} /> : null}

        {showReport ? (
          <ResultsWorkspace
            activeStudy={displayedStudy}
            key={`${displayedResult.meta?.runId || 'seed'}:${displayedResult.meta?.outputLocale || 'unknown'}`}
            onClearQualitativeProject={clearQualitativeProject}
            onEditBrief={(event) => briefOpen ? closeBrief() : openBrief(event.currentTarget)}
            result={displayedResult}
            repeatRuns={repeatRuns}
            runComplete={runComplete}
            running={running}
            onExport={exportStudy}
            onExportHumanHandoff={exportHumanResearchHandoff}
            onHumanValidationOpen={({ handoffAvailable }) => trackPilotEvent('human_validation_opened', {
              method: displayedStudy.researchMethod || 'GENERAL_LIKERT',
              locale: displayedStudy.outputLocale || 'en-US',
              handoffAvailable,
            })}
            onExportQualitativeProject={exportQualitativeProject}
            onImportQualitativeProject={importQualitativeProject}
            onAskSegmentPerspective={!exampleOpen && isQualitativeProjectEligible(displayedResult) ? askSegmentPerspective : null}
            onReplay={() => runStudy(activeStudy, 'replay')}
            qualitativeProject={qualitativeProject}
            segmentConversations={segmentConversations}
            selectedSegmentId={selectedSegmentId}
            setSegmentConversations={setSegmentConversations}
            setSelectedSegmentId={setSelectedSegmentId}
          />
        ) : null}
      </main>
      <footer className="public-footer">
        <span>Likerts — Free Synthetic Research</span>
        <nav aria-label={t('productDocs')}>
          <a href="/how-it-works/">{t('howItWorks')}</a>
          <a href="/synthetic-market-research/">{t('syntheticResearch')}</a>
          <a href="/methodology/">{t('methodology')}</a>
          <a href="/limitations/">{t('limitations')}</a>
          <a href="/studies/">{t('studies')}</a>
          <a href="/examples/">{t('examples')}</a>
          <a href="/llms.txt">{t('agentDocs')}</a>
        </nav>
      </footer>
    </div>
  );
}

function requestedInterfaceLocale() {
  return typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('uiLocale');
}

function browserLocalePreferences() {
  return typeof navigator === 'undefined'
    ? []
    : [...(Array.isArray(navigator.languages) ? navigator.languages : []), navigator.language].filter(Boolean);
}

const INTERFACE_LOCALE_STORAGE_KEY = 'likerts:interface-locale';
const EXPLICIT_INTERFACE_LOCALE_PREFERENCE_VERSION = 1;

function savedInterfaceLocale() {
  try {
    const storedPreference = localStorage.getItem(INTERFACE_LOCALE_STORAGE_KEY);
    if (!storedPreference) return null;
    const preference = JSON.parse(storedPreference);
    if (
      preference?.version !== EXPLICIT_INTERFACE_LOCALE_PREFERENCE_VERSION
      || preference?.source !== 'explicit'
      || typeof preference?.locale !== 'string'
    ) return null;
    return preference.locale;
  } catch { /* use browser preference */ }
  return null;
}

function persistExplicitInterfaceLocale(locale) {
  try {
    localStorage.setItem(INTERFACE_LOCALE_STORAGE_KEY, JSON.stringify({
      version: EXPLICIT_INTERFACE_LOCALE_PREFERENCE_VERSION,
      source: 'explicit',
      locale,
    }));
  } catch { /* optional preference */ }
}

function replaceInterfaceLocaleInCurrentUrl(locale) {
  if (typeof window === 'undefined') return;
  const nextSearch = setInterfaceLocaleInSearch({ search: window.location.search, locale });
  if (nextSearch === window.location.search) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${nextSearch}${window.location.hash}`,
  );
}

function initialInterfacePreference() {
  return resolveInterfaceLocalePreference({
    requestedLocale: requestedInterfaceLocale(),
    savedLocale: savedInterfaceLocale(),
    browserLocales: browserLocalePreferences(),
    supportedLocales: languageOptions.map((option) => option.value),
  });
}

function initialStudyLocale() {
  const supportedUiLocales = languageOptions.map((option) => option.value);
  return resolveSupportedLocalePreference({
    requestedLocale: matchSupportedLocale(requestedInterfaceLocale(), supportedUiLocales),
    savedLocale: matchSupportedLocale(savedInterfaceLocale(), supportedUiLocales),
    browserLocales: browserLocalePreferences(),
    supportedLocales: reportLanguageOptions.map((option) => option.value),
  });
}

export default function App() {
  const [initialPreference] = useState(initialInterfacePreference);
  const [uiLocale, setUiLocaleState] = useState(initialPreference.locale);
  const [studyDefaultLocale, setStudyDefaultLocale] = useState(initialStudyLocale);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('uiLocale')) return;
    if (initialPreference.source === 'requested') {
      persistExplicitInterfaceLocale(initialPreference.locale);
      replaceInterfaceLocaleInCurrentUrl(initialPreference.locale);
      return;
    }
    const nextSearch = removeConsumedInterfaceLocale({ search: window.location.search });
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );
  }, [initialPreference]);
  const setUiLocale = (nextLocale) => {
    const supportedLocale = matchSupportedLocale(nextLocale, languageOptions.map((option) => option.value));
    if (!supportedLocale) return;
    setUiLocaleState(supportedLocale);
    persistExplicitInterfaceLocale(supportedLocale);
    replaceInterfaceLocaleInCurrentUrl(supportedLocale);
    if (reportLanguageOptions.some((option) => option.value === supportedLocale)) setStudyDefaultLocale(supportedLocale);
    if (supportedLocale !== uiLocale) trackPilotEvent('interface_locale_changed', { locale: supportedLocale });
  };
  return (
    <I18nProvider locale={uiLocale}>
      <AppContent setUiLocale={setUiLocale} studyDefaultLocale={studyDefaultLocale} uiLocale={uiLocale} />
    </I18nProvider>
  );
}
