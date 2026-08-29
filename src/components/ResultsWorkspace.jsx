import { useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  BookmarkSimple,
  ChartLineUp,
  Check,
  CheckCircle,
  Copy,
  Export,
  FileText,
  GlobeHemisphereWest,
  Info,
  LinkSimple,
  PencilSimple,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { responseScale } from '../data.js';
import { getLanguageName, useI18n } from '../i18n.jsx';
import { researchSignalsFor } from '../lib/researchMeta.js';

const formatEvidenceClass = (value = 'Model inference') => value
  .toLowerCase()
  .replaceAll('_', ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const shortModel = (value = 'Not recorded') => value.split('/').at(-1)?.replaceAll('-', ' ') || value;
const sourceEntriesFor = (result) => (result.evidence || []).filter((entry) => entry.sourceUrl);
const sourceLabel = (source) => {
  if (source.sourceTitle || source.claim) return source.sourceTitle || source.claim;
  try {
    return new URL(source.sourceUrl).hostname;
  } catch {
    return source.sourceUrl;
  }
};

const reviewCompletedFor = (result) => {
  if (result.credibility?.reviewCompleted !== undefined) return Boolean(result.credibility.reviewCompleted);
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  return lineage.some((item) => {
    const role = String(item.role || item.stage || '').toLowerCase();
    const status = String(item.status || '').toLowerCase();
    return (role.includes('review') || role.includes('adjudication')) && status === 'completed';
  });
};

function DistributionBar({ values, compact = false }) {
  const { t } = useI18n();
  return (
    <div className={`distribution ${compact ? 'is-compact' : ''}`} role="img" aria-label={values.map((value, i) => `${t(responseScale[i].key)}: ${value}%`).join(', ')}>
      {values.map((value, index) => (
        <div className={`distribution-segment ${responseScale[index].tone}`} key={responseScale[index].key} style={{ width: `${value}%` }} title={`${t(responseScale[index].key)}: ${value}%`}>
          {!compact && value >= 7 ? <span>{value}%</span> : null}
        </div>
      ))}
    </div>
  );
}

function Overview({ result }) {
  const { t } = useI18n();
  const likely = result.distribution[3] + result.distribution[4];
  const unlikely = result.distribution[0] + result.distribution[1];
  const unsure = result.distribution[2];
  const humanFollowUp = result.adjudication?.humanFollowUp || result.methodology?.humanFollowUp;
  const positiveResponses = (result.responses || []).filter((response) => response.score >= 4);
  const drivers = (positiveResponses.length ? positiveResponses : result.responses || []).slice(0, 4);
  const changeFactors = [
    humanFollowUp || t('directional'),
    ...(result.methodology?.knownLimits || result.cautions || []),
  ].filter(Boolean).slice(0, 4);

  return (
    <div className="overview-view">
      <section className="topline-section" aria-labelledby="topline-title">
        <div className="topline-heading">
          <div>
            <p className="section-kicker" id="topline-title">{t('topLineFinding')}</p>
            <p className="headline-number"><strong>{likely}%</strong> <span>{t('likely')}</span></p>
          </div>
          <p className="synthetic-disclosure">{t('syntheticDisclosure')} <Info size={15} /></p>
        </div>

        <div className="chart-area">
          <div className="scale-labels" aria-hidden="true">
            {responseScale.map((response, index) => (
              <div key={response.key}><span>{t(response.key)}</span><i className={response.tone}>{index + 1}</i></div>
            ))}
          </div>
          <DistributionBar values={result.distribution} />
          <div className="bracket-row" aria-hidden="true">
            <span className="negative-bracket">{unlikely}% {t('unlikely')}</span>
            <span className="neutral-bracket">{unsure}% {t('unsure')}</span>
            <span className="positive-bracket">{likely}% {t('likely')}</span>
          </div>
        </div>

        <div className="executive-read"><strong>{t('executiveInterpretation')}</strong><p>{result.takeaway}</p></div>
      </section>

      <section className="insight-section">
        <h2><ChartLineUp size={20} /> {t('appearsDrive')}</h2>
        <div className="insight-rows">
          {drivers.map((response, index) => (
            <article key={`${response.profile}-${response.score}`}>
              <span className="insight-state positive-state"><Check size={13} weight="bold" /></span>
              <strong>{response.profile}</strong>
              <p>{response.quote}</p>
              <span className="inference-marker">{t('modelInference')}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="insight-section change-section">
        <h2><WarningCircle size={20} /> {t('couldChange')}</h2>
        <div className="insight-rows">
          {changeFactors.map((factor, index) => (
            <article key={factor}>
              <span className="insight-state warning-state">−</span>
              <strong>{index === 0 ? t('humanValidation') : `${t('knownLimitation')} ${index}`}</strong>
              <p>{factor}</p>
              <span className="inference-marker">{t('modelInference')}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="hypothesis-callout">
        <Info size={20} />
        <p><strong>{t('hypothesis')}</strong><span>{t('hypothesisNext')}</span></p>
      </div>
    </div>
  );
}

function Segments({ segments }) {
  const { t } = useI18n();
  return (
    <div className="secondary-view">
      <div className="view-intro"><div><p className="section-kicker">{t('segments')}</p><h2>{t('segmentsTitle')}</h2></div><p>{t('segmentsNote')}</p></div>
      <div className="segment-table">
        <div className="segment-header"><span>{t('segmentLabel')}</span><span>{t('directionalDistribution')}</span><span>{t('likely')}</span></div>
        {segments.map((segment) => {
          const likely = segment.values[3] + segment.values[4];
          return <div className="segment-row" key={segment.label}><div><strong>{segment.label}</strong><small>{segment.sample} {t('units')}</small></div><DistributionBar compact values={segment.values} /><strong className="segment-score">{likely}%</strong></div>;
        })}
      </div>
    </div>
  );
}

function Verbatims({ responses }) {
  const { t } = useI18n();
  return (
    <div className="secondary-view">
      <div className="view-intro"><div><p className="section-kicker">{t('syntheticVerbatims')}</p><h2>{t('possibleReasoning')}</h2></div><p>{t('verbatimNote')}</p></div>
      <div className="response-list">
        {responses.map((response) => (
          <article key={`${response.profile}-${response.score}`}><span className={`response-score ${responseScale[response.score - 1].tone}`}>{response.score}</span><div><span className="synthetic-label">{t('notInterviewNote')}</span><p>“{response.quote}”</p><small>{response.profile} · {t('modelInference')}</small></div></article>
        ))}
      </div>
    </div>
  );
}

function Evidence({ entries, evidenceMeta }) {
  const { t } = useI18n();
  const localizedTrace = (entry) => {
    const id = String(entry.id || '').toLowerCase();
    const evidenceClass = String(entry.evidenceClass || '').toLowerCase();
    if (entry.sourceUrl || id.startsWith('source-')) return t('sourceTrace');
    if (evidenceClass.includes('assumption') || id.startsWith('assumption-')) return t('assumptionTrace');
    if (evidenceClass.includes('verbatim') || id.includes('theme') || id.includes('verbatim')) return t('verbatimTrace');
    if (id.includes('segment')) return t('segmentTrace');
    return t('distributionTrace');
  };
  const localizedRisk = (entry) => {
    const id = String(entry.id || '').toLowerCase();
    const evidenceClass = String(entry.evidenceClass || '').toLowerCase();
    if (entry.sourceUrl || id.startsWith('source-')) return t('groundingRisk');
    if (evidenceClass.includes('assumption') || id.startsWith('assumption-')) return t('requiresValidation');
    if (evidenceClass.includes('verbatim') || id.includes('theme') || id.includes('verbatim')) return t('notInterviewNote');
    if (id.includes('segment')) return t('segmentNotSampled');
    return t('notRepresentative');
  };
  return (
    <div className="secondary-view evidence-view">
      <div className="view-intro"><div><p className="section-kicker">{t('evidenceLedger')}</p><h2>{t('traceClaimBasis')}</h2></div><p>{evidenceMeta?.mode === 'PRIOR_ONLY' ? t('noSourcesNote') : t('evidenceLedgerNote')}</p></div>
      <div className="evidence-table">
        <div className="evidence-header"><span>{t('claimOrSource')}</span><span>{t('evidenceClassLabel')}</span><span>{t('traceLabel')}</span><span>{t('riskLabel')}</span></div>
        {entries.map((entry, index) => (
          <div className="evidence-row" key={entry.id || `${entry.claim}-${index}`}>
            <div>
              {entry.sourceUrl ? <a href={entry.sourceUrl} rel="noreferrer" target="_blank">{entry.claim || entry.sourceTitle || entry.sourceUrl}<ArrowSquareOut size={14} /></a> : <strong>{entry.claim}</strong>}
              {entry.excerpt ? <small>{entry.excerpt}</small> : null}
              {entry.originalLanguage ? <small className="source-language">{t('sourceLanguageLabel')} · {entry.originalLanguage}</small> : null}
            </div>
            <span className={`evidence-class ${formatEvidenceClass(entry.evidenceClass).replaceAll(' ', '-').toLowerCase()}`}>{({ 'model inference': t('modelInference'), 'user assumption': t('assumptions'), 'provided source': t('sources'), 'retrieved source': t('sources'), 'synthetic verbatim theme': t('syntheticVerbatims') })[String(entry.evidenceClass || '').toLowerCase()] || formatEvidenceClass(entry.evidenceClass)}</span>
            <span>{localizedTrace(entry)}</span><span>{localizedRisk(entry)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Method({ result }) {
  const { t } = useI18n();
  const methodology = result.methodology || {};
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const hashes = result.meta?.hashes || {};
  return (
    <div className="secondary-view">
      <div className="view-intro"><div><p className="section-kicker">{t('methodologyLineage')}</p><h2>{t('auditableReplay')}</h2></div><p>{t('replayNote')}</p></div>
      <div className="method-grid">
        <dl>
          <div><dt>{t('runId')}</dt><dd>{result.meta?.runId || t('statusNotRecorded')}</dd></div><div><dt>{t('generatedAt')}</dt><dd>{result.meta?.generatedAt || t('statusNotRecorded')}</dd></div><div><dt>{t('promptVersion')}</dt><dd>{methodology.promptVersion || 'likerts.pipeline.v2'}</dd></div><div><dt>{t('schemaVersion')}</dt><dd>{methodology.schemaVersion || '2.0'}</dd></div><div><dt>{t('normalizationLabel')}</dt><dd>{methodology.normalization || 'Σ p(1…5) = 100%'}</dd></div><div><dt>{t('evidenceHash')}</dt><dd className="hash-value">{hashes.evidence || result.meta?.evidenceHash || t('noEvidenceHash')}</dd></div><div><dt>{t('inputHash')}</dt><dd className="hash-value">{hashes.input || result.meta?.inputHash || t('noInputHash')}</dd></div>
        </dl>
        <div className="lineage-list"><strong>{t('modelLineage')}</strong>{lineage.map((item, index) => <div key={`${item.role || item.stage}-${index}`}><span>{item.role || item.stage || `Stage ${index + 1}`}</span><b>{shortModel(item.resolvedModel || item.model || item.requestedModel)}</b><small>{item.status || item.provider || t('completed')}</small></div>)}{!lineage.length ? <p>{t('noLineage')}</p> : null}</div>
      </div>
      <div className="known-limits"><strong>{t('knownLimits')}</strong><ul>{(methodology.knownLimits || result.cautions || []).map((limit) => <li key={limit}>{limit}</li>)}</ul></div>
    </div>
  );
}

function CopyRunId({ value }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return <button aria-label={t('copyRunId')} className="copy-run-id" disabled={!value} onClick={copy} title={copied ? t('copied') : t('copyRunId')} type="button">{copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}</button>;
}

function EvidenceIndex({ result, onInspectEvidence }) {
  const { t } = useI18n();
  const sources = sourceEntriesFor(result);
  const credibility = result.credibility || {};
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const reviewComplete = reviewCompletedFor(result);
  const sourceCount = sources.length;
  const runId = result.meta?.runId || '';

  return (
    <aside className="evidence-index" aria-label={t('evidenceAtGlance')}>
      <h2>{t('evidenceAtGlance')}</h2>
      <dl className="trust-metrics">
        <div><dt>{t('sources')}</dt><dd className={sourceCount ? 'metric-good' : 'metric-caution'}>{sourceCount || t('noExternalSources')}</dd></div>
        <div><dt>{t('populationFit')}</dt><dd className="metric-caution">{t('notMeasured')}</dd></div>
        <div><dt>{t('modelReview')}</dt><dd className={reviewComplete ? 'metric-good' : 'metric-caution'}>{reviewComplete ? t('completed') : t('notStarted')}</dd></div>
      </dl>

      <section className="source-index">
        <div className="index-heading"><h3>{t('sources')}</h3><button onClick={onInspectEvidence} type="button">{sourceCount} {t('sourceRecords')} <ArrowSquareOut size={14} /></button></div>
        {sources.length ? <ol>{sources.map((source, index) => <li key={source.id || source.sourceUrl}><span className="source-number">{index + 1}</span><div><a href={source.sourceUrl} rel="noreferrer" target="_blank">{sourceLabel(source)}<ArrowSquareOut size={13} /></a><small>{source.originalLanguage ? `${t('sourceLanguageLabel')} · ${source.originalLanguage}` : t('publicWebSource')}{source.excerpt ? ` · ${source.excerpt}` : ''}</small></div></li>)}</ol> : <p className="empty-index">{t('noSourcesNote')}</p>}
      </section>

      <section className="model-lineage">
        <h3>{t('modelLineage')}</h3>
        <ol>{lineage.slice(0, 3).map((item, index) => <li key={`${item.role || item.stage}-${index}`}><span>{index + 1}</span><div><strong>{item.role || item.stage || `Stage ${index + 1}`}</strong><p>{shortModel(item.resolvedModel || item.model || item.requestedModel)}</p><small>{item.status || item.provider || t('statusNotRecorded')}</small></div></li>)}</ol>
      </section>

      <section className="run-details">
        <h3>{t('runDetails')}</h3>
        <dl><div><dt>{t('runId')}</dt><dd>{runId || t('statusNotRecorded')} <CopyRunId value={runId} /></dd></div><div><dt>{t('reportLanguage')}</dt><dd>{getLanguageName(result.meta?.outputLocale || 'en-US')}</dd></div><div><dt>{t('evidenceMode')}</dt><dd>{String(credibility.evidenceMode || result.meta?.evidenceMode || 'model-only').replaceAll('_', ' ').replaceAll('-', ' ')}</dd></div><div><dt>{t('saved')}</dt><dd><BookmarkSimple size={14} /> {result.meta?.persistence === 'durable' ? t('durable') : result.meta?.persistence === 'local' ? t('local') : t('session')}</dd></div></dl>
      </section>
    </aside>
  );
}

function ResearchSignals({ result }) {
  const { locale, t } = useI18n();
  const signals = researchSignalsFor(result);
  const hasSignals = Object.values(signals).some(Boolean);
  if (!hasSignals) return null;
  const stability = typeof signals.stability === 'object'
    ? signals.stability.applicable
      ? [Number.isFinite(signals.stability.maxPercentagePointSpread) ? `${signals.stability.maxPercentagePointSpread} pp` : null, Number.isFinite(signals.stability.meanJensenShannonDivergence) ? `JSD ${signals.stability.meanJensenShannonDivergence}` : null].filter(Boolean).join(' · ') || t('stabilityMeasured')
      : t('stabilityNotEstimated')
    : signals.stability;
  const ensemble = typeof signals.ensemble === 'object'
    ? `${signals.ensemble.completedCells} / ${signals.ensemble.plannedCells}`
    : signals.ensemble;
  const cost = signals.ownerCost
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: signals.ownerCost.currency, maximumFractionDigits: 4 }).format(signals.ownerCost.amount)
    : null;

  return (
    <section className="research-signals" aria-label={t('researchSignals')}>
      <h3>{t('researchSignals')}</h3>
      <dl>
        {stability ? <div><dt>{t('stability')}</dt><dd>{stability}</dd></div> : null}
        {ensemble ? <div><dt>{t('ensemble')}</dt><dd>{ensemble}</dd></div> : null}
        {signals.provenance ? <div><dt>{t('provenance')}</dt><dd className="hash-value">{signals.provenance}</dd></div> : null}
        {cost ? <div><dt>{signals.ownerCost.estimated ? t('estimatedGatewayCost') : t('exactGatewayCost')}</dt><dd title={t('gatewayCostNote')}>{cost}</dd></div> : null}
        {signals.sourceFreshness ? <div><dt>{t('sourceDate')}</dt><dd>{signals.sourceFreshness}</dd></div> : null}
      </dl>
    </section>
  );
}

export function ResultsWorkspace({ activeStudy, result, runComplete, running, onEditBrief, onExport, onReplay }) {
  const { dir, t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const tabs = ['overview', 'segments', 'verbatims', 'evidence', 'method'];
  const entries = result.evidence?.length ? result.evidence : [];
  const sourceCount = sourceEntriesFor(result).length;
  const reviewComplete = reviewCompletedFor(result);
  const generatedAt = result.meta?.generatedAt && result.meta.generatedAt !== 'Illustrative seed' ? result.meta.generatedAt : null;

  const handleTabKeyDown = (event, index) => {
    const keyMoves = dir === 'rtl' ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key in keyMoves) nextIndex = (index + keyMoves[event.key] + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`result-tab-${nextTab}`)?.focus());
  };

  return (
    <section className="research-report" aria-label={t('reportTab')}>
      <header className="report-toolbar">
        <div className="report-status"><CheckCircle size={18} weight={runComplete ? 'fill' : 'regular'} /><strong>{runComplete ? t('completed') : t('illustrativePreview')}</strong><span>·</span><span>{sourceCount ? `${sourceCount} ${t('sourceRecords')}` : t('noExternalSources')}</span><span>·</span><span>{reviewComplete ? t('modelReviewed') : `${t('modelReview')} · ${t('notStarted')}`}</span></div>
        <p className="run-id">{t('runId')}: {result.meta?.runId || t('notStarted')}{generatedAt ? ` · ${generatedAt}` : ''}</p>
        <div className="report-actions"><button disabled={running} onClick={onEditBrief} type="button"><PencilSimple size={18} /> {t('editBrief')}</button><button onClick={onExport} type="button"><Export size={18} /> {t('export')}</button><button disabled={running} onClick={onReplay} type="button"><ArrowCounterClockwise size={18} /> {t('replay')}</button></div>
      </header>

      <div className="report-frame">
        <div className="report-main">
          <header className="report-heading">
            <h2 id="report-title">{activeStudy.prompt}</h2>
            <div className="study-scope" aria-label={t('market')}><span><GlobeHemisphereWest size={17} /> {activeStudy.market}</span><span><UsersThree size={17} /> {activeStudy.audience}</span><span><UsersThree size={17} /> {activeStudy.panelSize} {t('units')}</span><span><FileText size={17} /> {getLanguageName(activeStudy.outputLocale)} {t('outputLabel')}</span></div>
          </header>

          <ResearchSignals result={result} />

          <div className="tabs" role="tablist" aria-label={t('overview')}>
            {tabs.map((tab, index) => <button aria-controls="result-panel" aria-selected={activeTab === tab} className={activeTab === tab ? 'is-active' : ''} id={`result-tab-${tab}`} key={tab} onClick={() => setActiveTab(tab)} onKeyDown={(event) => handleTabKeyDown(event, index)} role="tab" tabIndex={activeTab === tab ? 0 : -1} type="button">{tab === 'overview' ? t('reportTab') : t(tab)}</button>)}
          </div>

          <div aria-labelledby={`result-tab-${activeTab}`} className="result-body" id="result-panel" role="tabpanel" tabIndex="0">
            {activeTab === 'overview' && <Overview result={result} />}
            {activeTab === 'segments' && <Segments segments={result.segments} />}
            {activeTab === 'verbatims' && <Verbatims responses={result.responses} />}
            {activeTab === 'evidence' && <Evidence entries={entries} evidenceMeta={result.evidenceMeta} />}
            {activeTab === 'method' && <Method result={result} />}
          </div>
        </div>
        <EvidenceIndex onInspectEvidence={() => setActiveTab('evidence')} result={result} />
      </div>

      <footer className="report-footer-note"><LinkSimple size={15} /> {t('syntheticMethodNote')}</footer>
    </section>
  );
}
