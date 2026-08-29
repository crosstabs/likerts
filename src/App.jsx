import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, GlobeHemisphereWest, Info, Plus } from '@phosphor-icons/react';
import { Brand } from './components/Chrome.jsx';
import { ResultsWorkspace } from './components/ResultsWorkspace.jsx';
import { RunProgress } from './components/RunProgress.jsx';
import { StudyComposer } from './components/StudyComposer.jsx';
import { initialResult, initialStudy, markets } from './data.js';
import { I18nProvider, languageOptions, useI18n } from './i18n.jsx';
import {
  createPendingRun,
  getLatestRun,
  persistCompletedRun,
  removePendingRun,
} from './lib/studyStore.js';
import { sampleStudyPrefillFromSearch } from './lib/sampleStudyPrefill.js';

function evidenceFromRun(run, study) {
  const supplied = run?.evidence?.ledger || run?.evidence?.sources || [];
  const sourceEntries = supplied.map((source, index) => ({
    id: `source-${index}`,
    claim: source.title || source.url || `Source ${index + 1}`,
    sourceTitle: source.title || '',
    sourceUrl: source.url || '',
    excerpt: source.excerpt || '',
    originalLanguage: source.originalLanguage || null,
    evidenceClass: source.acquisition === 'USER_PROVIDED' ? 'Provided source' : 'Retrieved source',
    trace: `${String(source.acquisition || 'source').replaceAll('_', ' ')} → evidence packet`,
    risk: 'Useful grounding, not independent validation',
  }));

  const assumptionEntries = study.assumptions
    ? study.assumptions.split(/[.;\n]+/).map((assumption) => assumption.trim()).filter(Boolean).slice(0, 4).map((assumption, index) => ({
      id: `assumption-${index}`,
      claim: assumption,
      evidenceClass: 'User assumption',
      trace: 'Study brief → explicit assumption',
      risk: 'Requires validation',
    }))
    : [];

  const modelEntries = [
    {
      id: 'model-distribution',
      claim: 'Final five-point Likert distribution',
      evidenceClass: 'Model inference',
      trace: 'Framing → panel simulation → model review → normalization',
      risk: 'Not representative',
    },
    {
      id: 'model-segments',
      claim: 'Differences between audience segments',
      evidenceClass: 'Model inference',
      trace: 'Audience frame → model-constructed scenarios',
      risk: 'Segments were not sampled',
    },
    {
      id: 'model-verbatims',
      claim: 'Reasons behind the response scores',
      evidenceClass: 'Synthetic verbatim theme',
      trace: 'Generated explanations → illustrative themes',
      risk: 'Not customer testimony',
    },
  ];

  return [...sourceEntries, ...assumptionEntries, ...modelEntries];
}

function normalizePayload(payload, study, savedLocally) {
  const run = payload.run || {};
  const credibility = run.credibility || payload.meta?.credibility || {};
  const sourceCount = run.evidence?.ledger?.filter((source) => source.url).length ?? 0;
  const reviewStage = run.stages?.find((stage) => stage.stage === 'adjudication');

  return {
    ...payload.study,
    evidence: payload.evidence?.entries || evidenceFromRun(run, study),
    evidenceMeta: {
      mode: run.evidence?.mode || payload.meta?.evidenceMode || 'model-only',
      note: run.evidence?.mode === 'PRIOR_ONLY'
        ? 'No external source evidence was acquired. This run relies on model priors and explicit assumptions.'
        : 'Source text is untrusted grounding material, not independent validation.',
    },
    credibility: {
      ...credibility,
      sourceCount,
      populationFit: null,
      modelAgreement: null,
      assumptionCount: study.assumptions ? study.assumptions.split(/[.;\n]+/).filter(Boolean).length : 0,
    },
    methodology: {
      promptVersion: 'likerts.pipeline.v2',
      schemaVersion: '2.0',
      normalization: 'Σ p(1…5) = 100%',
      knownLimits: credibility.limitations || payload.study.cautions,
    },
    adjudication: {
      decision: reviewStage?.status === 'completed' ? 'Model review completed' : 'Panel result used after model-review fallback',
      humanFollowUp: payload.study.takeaway?.match(/(?:validate|test|follow)[^.]*\.?$/i)?.[0] || '',
    },
    meta: {
      ...payload.meta,
      runId: payload.meta?.runId || run.runId,
      studyId: payload.meta?.studyId || run.studyId,
      lineage: payload.meta?.modelLineage || run.modelLineage || [],
      modelLineage: payload.meta?.modelLineage || run.modelLineage || [],
      stageStatuses: run.stages || [],
      evidenceHash: run.evidence?.evidenceHash,
      inputHash: run.inputHash,
      hashes: { evidence: run.evidence?.evidenceHash, input: run.inputHash },
      persistence: payload.persistence?.durableStoreConfigured ? 'durable' : savedLocally ? 'local' : 'session',
      market: study.market,
      outputLocale: study.outputLocale,
    },
  };
}

function AppContent({ uiLocale, setUiLocale }) {
  const { dir, t } = useI18n();
  const samplePrefill = useMemo(() => sampleStudyPrefillFromSearch(window.location.search), []);
  const restoredRun = useMemo(() => samplePrefill ? null : getLatestRun(), [samplePrefill]);
  const restoredStudy = useMemo(
    () => samplePrefill?.study || { ...initialStudy, ...(restoredRun?.study || {}) },
    [restoredRun, samplePrefill],
  );
  const [study, setStudy] = useState(restoredStudy);
  const [activeStudy, setActiveStudy] = useState(restoredStudy);
  const [result, setResult] = useState(restoredRun?.result || initialResult);
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [runComplete, setRunComplete] = useState(Boolean(restoredRun));
  const [briefOpen, setBriefOpen] = useState(samplePrefill?.shouldOpenBrief === true);
  const [error, setError] = useState('');
  const pendingRunRef = useRef(null);
  const runInFlightRef = useRef(false);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    document.documentElement.dir = dir;
    document.title = `Likerts — ${t('hero')}`;
    try { localStorage.setItem('likerts:interface-locale', uiLocale); } catch { /* optional preference */ }
  }, [dir, t, uiLocale]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setActiveStage((stage) => Math.min(3, stage + 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [running]);

  const runStudy = async (inputStudy = study) => {
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;
    const sanitizedStudy = {
      ...initialStudy,
      ...inputStudy,
      sources: (inputStudy.sources || []).map((source) => source.trim()).filter(Boolean),
      sourceLanguages: inputStudy.sourceLanguages || [],
    };
    const selectedMarket = markets.find((market) => market.value === sanitizedStudy.market) || markets[0];
    const pendingRun = createPendingRun(sanitizedStudy);
    pendingRunRef.current = pendingRun;
    setRunning(true);
    setRunComplete(false);
    setActiveStage(0);
    setError('');

    try {
      const response = await fetch('/api/synthetic-study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: sanitizedStudy.prompt,
          audience: sanitizedStudy.audience,
          panelSize: sanitizedStudy.panelSize,
          sourceUrls: sanitizedStudy.sources,
          assumptions: sanitizedStudy.assumptions,
          evidencePolicy: 'AUTO',
          market: sanitizedStudy.market,
          outputLocale: sanitizedStudy.outputLocale,
          sourceLanguages: sanitizedStudy.sourceLanguages,
          researchMode: sanitizedStudy.researchMode || 'quick',
          searchCountry: selectedMarket.searchCountry,
          searchLocation: selectedMarket.searchLocation,
          clientRunId: pendingRun.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The synthetic research pipeline could not complete.');

      const draftResult = normalizePayload(payload, sanitizedStudy, false);
      const savedLocally = persistCompletedRun(pendingRun, sanitizedStudy, draftResult);
      const nextResult = {
        ...draftResult,
        meta: { ...draftResult.meta, persistence: payload.persistence?.durableStoreConfigured ? 'durable' : savedLocally ? 'local' : 'session' },
      };
      if (savedLocally) persistCompletedRun(pendingRun, sanitizedStudy, nextResult);
      setResult(nextResult);
      setActiveStudy(sanitizedStudy);
      setStudy(sanitizedStudy);
      setActiveStage(4);
      setRunComplete(true);
      setBriefOpen(false);
    } catch (requestError) {
      removePendingRun(pendingRun.id);
      setError(requestError.message || 'The synthetic research pipeline could not complete.');
      setRunComplete(false);
    } finally {
      runInFlightRef.current = false;
      setRunning(false);
    }
  };

  const exportStudy = () => {
    const payload = {
      exportType: 'Likerts evidence pack',
      exportedAt: new Date().toISOString(),
      syntheticOnly: true,
      study: activeStudy,
      result,
    };
    const contents = encodeURIComponent(JSON.stringify(payload, null, 2));
    const anchor = document.createElement('a');
    anchor.href = `data:application/json;charset=utf-8,${contents}`;
    anchor.download = `likerts-${result.meta?.runId || 'study'}-evidence-pack.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const startNewStudy = () => {
    setStudy(initialStudy);
    setActiveStudy(initialStudy);
    setResult(initialResult);
    setRunComplete(false);
    setActiveStage(0);
    setError('');
    setBriefOpen(true);
  };

  return (
    <div className="app-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <Brand />
          <div className="header-controls">
            <label className="header-select market-selector">
              <GlobeHemisphereWest size={17} />
              <span className="sr-only">Market</span>
              <select
                aria-label="Market"
                disabled={running}
                onChange={(event) => {
                  setStudy({ ...study, market: event.target.value });
                  setBriefOpen(true);
                }}
                value={study.market}
              >
                {markets.map((market) => <option key={market.value} value={market.value}>{market.value}</option>)}
              </select>
              <CaretDown size={14} />
            </label>
            <label className="header-select language-picker">
              <span className="sr-only">{t('interfaceLanguage')}</span>
              <select aria-label={t('interfaceLanguage')} disabled={running} onChange={(event) => setUiLocale(event.target.value)} value={uiLocale}>
                {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
              </select>
              <CaretDown size={14} />
            </label>
            <button className="new-study-button" disabled={running} onClick={startNewStudy} type="button"><Plus size={17} /> {t('newStudy')}</button>
          </div>
        </div>
      </header>
      <main className="workspace">
        <h1 className="sr-only">{t('hero')}</h1>
        {briefOpen ? (
          <StudyComposer
            onClose={() => setBriefOpen(false)}
            onRun={() => runStudy(study)}
            running={running}
            hasExistingReport={runComplete}
            setStudy={setStudy}
            study={study}
          />
        ) : null}

        {error ? <div className="generation-error" role="alert"><Info size={18} /> {error}</div> : null}

        {running ? (
          <RunProgress
            activeStage={activeStage}
            complete={runComplete}
            running={running}
            runId={result.meta?.runId || pendingRunRef.current?.id}
            stages={result.meta?.stageStatuses}
          />
        ) : null}

        <ResultsWorkspace
          activeStudy={activeStudy}
          key={result.meta?.runId || 'seed'}
          onEditBrief={() => setBriefOpen((open) => !open)}
          result={result}
          runComplete={runComplete}
          running={running}
          onExport={exportStudy}
          onReplay={() => runStudy(activeStudy)}
        />
      </main>
      <footer className="public-footer">
        <span>Likerts · {t('directional')}</span>
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

function initialInterfaceLocale() {
  try {
    const saved = localStorage.getItem('likerts:interface-locale');
    if (languageOptions.some((option) => option.value === saved)) return saved;
  } catch { /* use browser preference */ }
  const browserLocale = navigator.language || 'en-US';
  return languageOptions.find((option) => option.value === browserLocale)?.value
    || languageOptions.find((option) => option.value.startsWith(browserLocale.split('-')[0]))?.value
    || 'en-US';
}

export default function App() {
  const [uiLocale, setUiLocale] = useState(initialInterfaceLocale);
  return (
    <I18nProvider locale={uiLocale}>
      <AppContent setUiLocale={setUiLocale} uiLocale={uiLocale} />
    </I18nProvider>
  );
}
