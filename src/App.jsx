import { useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from './components/Chrome.jsx';
import { ResultsWorkspace } from './components/ResultsWorkspace.jsx';
import { RunProgress } from './components/RunProgress.jsx';
import { StudyComposer } from './components/StudyComposer.jsx';
import { GlobeIcon, InfoIcon } from './icons.jsx';
import { initialResult, initialStudy, markets } from './data.js';
import { I18nProvider, languageOptions, useI18n } from './i18n.jsx';
import {
  createPendingRun,
  getLatestRun,
  persistCompletedRun,
  removePendingRun,
} from './lib/studyStore.js';

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
      trace: 'Framing → panel simulation → independent review → normalization',
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
  const sourceCount = credibility.sourceCount ?? run.evidence?.ledger?.length ?? 0;
  const groundedCount = run.evidence?.ledger?.filter((source) => source.excerpt).length ?? 0;
  const reviewStage = run.stages?.find((stage) => stage.stage === 'adjudication');

  return {
    ...payload.study,
    evidence: payload.evidence?.entries || evidenceFromRun(run, study),
    evidenceMeta: {
      mode: run.evidence?.mode || payload.meta?.evidenceMode || 'model-only',
      note: run.evidence?.mode === 'PRIOR_ONLY'
        ? 'No external source evidence was acquired. This run relies on model priors and explicit assumptions.'
        : 'Retrieved text is untrusted grounding material, not independent validation.',
    },
    credibility: {
      ...credibility,
      evidenceCoverage: sourceCount ? Math.min(1, groundedCount / 4) : 0,
      populationFit: groundedCount >= 2 ? 'Partial' : 'Unspecified',
      modelAgreement: null,
      assumptionCount: study.assumptions ? study.assumptions.split(/[.;\n]+/).filter(Boolean).length : 0,
    },
    methodology: {
      promptVersion: 'likerts.pipeline.v2',
      schemaVersion: '2.0',
      normalization: 'Percentages are normalized to sum to 100; simulation-unit counts do not alter credibility.',
      knownLimits: credibility.limitations || payload.study.cautions,
    },
    adjudication: {
      decision: reviewStage?.status === 'completed' ? 'Independent review completed' : 'Panel result used after review fallback',
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
  const restoredRun = useMemo(() => getLatestRun(), []);
  const restoredStudy = useMemo(() => ({ ...initialStudy, ...(restoredRun?.study || {}) }), [restoredRun]);
  const [study, setStudy] = useState(restoredStudy);
  const [activeStudy, setActiveStudy] = useState(restoredStudy);
  const [result, setResult] = useState(restoredRun?.result || initialResult);
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(0);
  const [runComplete, setRunComplete] = useState(Boolean(restoredRun));
  const [error, setError] = useState('');
  const pendingRunRef = useRef(null);

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
    const sanitizedStudy = {
      ...initialStudy,
      ...inputStudy,
      sources: inputStudy.sources.map((source) => source.trim()).filter(Boolean),
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
    } catch (requestError) {
      removePendingRun(pendingRun.id);
      setError(requestError.message || 'The synthetic research pipeline could not complete.');
      setRunComplete(false);
    } finally {
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

  return (
    <div className="app-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <Brand />
          <div className="header-meta">
            <label className="language-picker">
              <GlobeIcon size={16} />
              <span className="sr-only">Interface language</span>
              <select aria-label="Interface language" onChange={(event) => setUiLocale(event.target.value)} value={uiLocale}>
                {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
              </select>
            </label>
            <p>{t('free')}</p>
          </div>
        </div>
      </header>
      <main className="workspace">
        <header className="workspace-header">
          <h1 id="composer-title">{t('hero')}</h1>
          <p>{t('subhero')}</p>
        </header>

        <StudyComposer study={study} setStudy={setStudy} onRun={() => runStudy(study)} running={running} />

        {error ? <div className="generation-error" role="alert"><InfoIcon size={18} /> {error}</div> : null}

        <RunProgress
          activeStage={activeStage}
          complete={runComplete}
          running={running}
          runId={result.meta?.runId || pendingRunRef.current?.id}
          stages={result.meta?.stageStatuses}
        />

        <ResultsWorkspace
          key={result.meta?.runId || 'seed'}
          result={result}
          onExport={exportStudy}
          onReplay={() => runStudy(activeStudy)}
        />
      </main>
      <footer className="public-footer">
        <span>Likerts · Synthetic, directional research</span>
        <nav aria-label="Product documentation">
          <a href="/how-it-works/">How it works</a>
          <a href="/synthetic-market-research/">Synthetic research</a>
          <a href="/methodology/">Methodology</a>
          <a href="/limitations/">Limitations</a>
          <a href="/examples/">Examples</a>
          <a href="/llms.txt">Agent docs</a>
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
