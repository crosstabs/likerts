import { useState } from 'react';
import {
  BookmarkIcon,
  ExportIcon,
  InfoIcon,
  LinkIcon,
  ReplayIcon,
} from '../icons.jsx';
import { responseScale } from '../data.js';
import { getLanguageName, useI18n } from '../i18n.jsx';

const formatEvidenceClass = (value = 'Model inference') => value
  .toLowerCase()
  .replaceAll('_', ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(numeric)}%`;
};

const shortModel = (value = 'Not recorded') => value.split('/').at(-1)?.replaceAll('-', ' ') || value;

function DistributionBar({ values, compact = false }) {
  return (
    <div className={`distribution ${compact ? 'is-compact' : ''}`} role="img" aria-label={values.map((value, i) => `${responseScale[i].label}: ${value}%`).join(', ')}>
      {values.map((value, index) => (
        <div
          className={`distribution-segment ${responseScale[index].tone}`}
          key={responseScale[index].label}
          style={{ width: `${value}%` }}
          title={`${responseScale[index].label}: ${value}%`}
        >
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

  return (
    <div className="overview-view">
      <div className="overview-heading">
        <div>
          <p className="result-label">{result.title}</p>
          <p className="headline-number"><strong>{likely}%</strong> <span>{t('likely')}</span></p>
        </div>
        <p className="hypothesis-note">{t('hypothesis')}</p>
      </div>

      <div className="chart-area">
        <div className="scale-labels" aria-hidden="true">
          {responseScale.map((response, index) => (
            <div key={response.label}>
              <span>{response.shortLabel}</span>
              <i className={response.tone}>{index + 1}</i>
            </div>
          ))}
        </div>
        <DistributionBar values={result.distribution} />
        <div className="bracket-row" aria-hidden="true">
          <span className="negative-bracket">{unlikely}% {t('unlikely')}</span>
          <span className="neutral-bracket">{unsure}% {t('unsure')}</span>
          <span className="positive-bracket">{likely}% {t('likely')}</span>
        </div>
      </div>

      <div className="findings-list">
        <div>
          <strong>{t('suggest')}</strong>
          <p>{result.takeaway}</p>
        </div>
        <div>
          <strong>{t('changeRead')}</strong>
          <p>{humanFollowUp || 'Validation with real participants drawn from the audience frame.'}</p>
        </div>
      </div>
    </div>
  );
}

function Segments({ segments }) {
  return (
    <div className="segments-view">
      <div className="view-intro">
        <div>
          <p className="result-label">Segments</p>
          <h2>Model-constructed patterns</h2>
        </div>
        <p>Exploratory scenarios, not sampled population strata. Synthetic n controls display counts, not statistical validity.</p>
      </div>
      <div className="segment-table">
        <div className="segment-header"><span>Segment</span><span>Directional distribution</span><span>Likely</span></div>
        {segments.map((segment) => {
          const likely = segment.values[3] + segment.values[4];
          return (
            <div className="segment-row" key={segment.label}>
              <div><strong>{segment.label}</strong><small>n synthetic = {segment.sample}</small></div>
              <DistributionBar compact values={segment.values} />
              <strong className="segment-score">{likely}%</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Verbatims({ responses }) {
  return (
    <div className="responses-view">
      <div className="view-intro">
        <div>
          <p className="result-label">Synthetic verbatims</p>
          <h2>Possible reasoning, not customer voice</h2>
        </div>
        <p>Generated examples of how someone might reason. Never quote these as an interview note or customer testimony.</p>
      </div>
      <div className="response-list">
        {responses.map((response) => (
          <article key={`${response.profile}-${response.score}`}>
            <span className={`response-score ${responseScale[response.score - 1].tone}`}>{response.score}</span>
            <div>
              <span className="synthetic-label">Not an interview note</span>
              <p>“{response.quote}”</p>
              <small>{response.profile} · Evidence class: model inference</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Evidence({ entries, evidenceMeta }) {
  return (
    <div className="evidence-view">
      <div className="view-intro">
        <div>
          <p className="result-label">Evidence ledger</p>
          <h2>Trace every claim to its basis</h2>
        </div>
        <p>{evidenceMeta?.note || 'Sources, user assumptions, and model inference remain visibly distinct.'}</p>
      </div>
      <div className="evidence-table">
        <div className="evidence-header"><span>Claim or source</span><span>Evidence class</span><span>Trace</span><span>Risk</span></div>
        {entries.map((entry, index) => (
          <div className="evidence-row" key={entry.id || `${entry.claim}-${index}`}>
            <div>
              {entry.sourceUrl ? <a href={entry.sourceUrl} rel="noreferrer" target="_blank">{entry.claim || entry.sourceTitle || entry.sourceUrl}<LinkIcon size={14} /></a> : <strong>{entry.claim}</strong>}
              {entry.excerpt ? <small>{entry.excerpt}</small> : null}
              {entry.originalLanguage ? <small className="source-language">Source language · {entry.originalLanguage}</small> : null}
            </div>
            <span className={`evidence-class ${formatEvidenceClass(entry.evidenceClass).replaceAll(' ', '-').toLowerCase()}`}>{formatEvidenceClass(entry.evidenceClass)}</span>
            <span>{entry.trace || 'Not recorded'}</span>
            <span>{entry.risk || 'Review required'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Method({ result }) {
  const methodology = result.methodology || {};
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const hashes = result.meta?.hashes || {};
  return (
    <div className="method-view">
      <div className="view-intro">
        <div>
          <p className="result-label">Methodology & lineage</p>
          <h2>An auditable replay manifest</h2>
        </div>
        <p>Replay uses the same brief and evidence packet, but model output may still vary.</p>
      </div>
      <div className="method-grid">
        <dl>
          <div><dt>Run ID</dt><dd>{result.meta?.runId || 'Not recorded'}</dd></div>
          <div><dt>Generated at</dt><dd>{result.meta?.generatedAt || 'Not recorded'}</dd></div>
          <div><dt>Prompt version</dt><dd>{methodology.promptVersion || 'likerts.pipeline.v2'}</dd></div>
          <div><dt>Schema version</dt><dd>{methodology.schemaVersion || '2.0'}</dd></div>
          <div><dt>Normalization</dt><dd>{methodology.normalization || 'Five response percentages normalized to total 100.'}</dd></div>
          <div><dt>Evidence hash</dt><dd className="hash-value">{hashes.evidence || result.meta?.evidenceHash || 'No evidence hash'}</dd></div>
          <div><dt>Input hash</dt><dd className="hash-value">{hashes.input || result.meta?.inputHash || 'No input hash'}</dd></div>
        </dl>
        <div className="lineage-list">
          <strong>Model lineage</strong>
          {lineage.map((item, index) => (
            <div key={`${item.role || item.stage}-${index}`}>
              <span>{item.role || item.stage || `Stage ${index + 1}`}</span>
              <b>{shortModel(item.resolvedModel || item.model || item.requestedModel)}</b>
              <small>{item.status || item.provider || 'completed'}</small>
            </div>
          ))}
          {!lineage.length ? <p>No model lineage was recorded for this illustrative result.</p> : null}
        </div>
      </div>
      <div className="known-limits">
        <strong>Known limits</strong>
        <ul>{(methodology.knownLimits || result.cautions || []).map((limit) => <li key={limit}>{limit}</li>)}</ul>
      </div>
    </div>
  );
}

function ResearchLedger({ result, onInspectEvidence }) {
  const { t } = useI18n();
  const credibility = result.credibility || {};
  const entries = result.evidence || [];
  const sourceCount = credibility.sourceCount ?? entries.filter((entry) => entry.sourceUrl).length;
  const assumptionCount = credibility.assumptionCount ?? entries.filter((entry) => formatEvidenceClass(entry.evidenceClass) === 'User assumption').length;
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const evidenceCoverage = credibility.evidenceCoverage ?? credibility.coverage;
  const fit = credibility.populationFit || (credibility.level === 'internally-reviewed' ? 'Reviewed' : 'Unspecified');
  const reviewStatus = credibility.reviewCompleted === undefined ? 'Not run' : credibility.reviewCompleted ? 'Complete' : 'Fallback';
  const evidenceMode = credibility.evidenceMode || result.meta?.evidenceMode || 'model-only';

  return (
    <aside className="research-ledger" aria-label={t('ledger')}>
      <h2>{t('ledger')}</h2>
      <dl className="ledger-metrics">
        <div><dt>{t('coverage')}</dt><dd>{evidenceCoverage === undefined ? (sourceCount ? 'Partial' : '0%') : formatPercent(evidenceCoverage)}</dd></div>
        <div><dt>{t('populationFit')}</dt><dd>{fit}</dd></div>
        <div><dt>{t('independentReview')}</dt><dd>{reviewStatus}</dd></div>
      </dl>

      <div className="ledger-context">
        <span><small>{t('marketLabel')}</small><strong>{result.meta?.market || 'Global'}</strong></span>
        <span><small>{t('outputLabel')}</small><strong>{getLanguageName(result.meta?.outputLocale || 'en-US')}</strong></span>
      </div>

      <div className="ledger-lineage">
        <strong>Independent model review</strong>
        <div>
          {lineage.slice(0, 3).map((item, index) => (
            <span key={`${item.stage || item.role}-${index}`}>
              <i>{index + 1}</i>
              <b>{shortModel(item.resolvedModel || item.model || item.requestedModel)}</b>
              <small>{item.role || item.stage} · {item.status || 'unknown'}</small>
            </span>
          ))}
          {!lineage.length ? <p>Run the study to record each model stage.</p> : null}
        </div>
      </div>

      <div className="ledger-facts">
        <p><LinkIcon size={16} /> {sourceCount} source{sourceCount === 1 ? '' : 's'} · {assumptionCount} assumption{assumptionCount === 1 ? '' : 's'}</p>
        <p className="evidence-mode">Mode: {String(evidenceMode).replaceAll('_', ' ').replaceAll('-', ' ')}</p>
        <button onClick={onInspectEvidence} type="button">{t('inspectEvidence')} <LinkIcon size={15} /></button>
        <p className="local-save"><BookmarkIcon size={16} /> {
          result.meta?.persistence === 'durable'
            ? 'Durable replay saved'
            : result.meta?.persistence === 'local'
              ? 'Local replay saved'
              : 'Session preview only'
        }</p>
      </div>
    </aside>
  );
}

export function ResultsWorkspace({ result, onExport, onReplay }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const tabs = ['overview', 'segments', 'verbatims', 'evidence', 'method'];
  const entries = result.evidence?.length ? result.evidence : [];

  return (
    <section className="results-panel" aria-label="Synthetic study results">
      <header className="results-toolbar">
        <div className="tabs" role="tablist" aria-label="Result views">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? 'is-active' : ''}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {t(tab)}
            </button>
          ))}
        </div>
        <div className="result-actions">
          <button onClick={onExport} type="button"><ExportIcon size={18} /> {t('export')}</button>
          <button onClick={onReplay} type="button"><ReplayIcon size={18} /> {t('replay')}</button>
        </div>
      </header>

      <div className="results-layout">
        <div className="result-body">
          {activeTab === 'overview' && <Overview result={result} />}
          {activeTab === 'segments' && <Segments segments={result.segments} />}
          {activeTab === 'verbatims' && <Verbatims responses={result.responses} />}
          {activeTab === 'evidence' && <Evidence entries={entries} evidenceMeta={result.evidenceMeta} />}
          {activeTab === 'method' && <Method result={result} />}
        </div>
        <ResearchLedger result={result} onInspectEvidence={() => setActiveTab('evidence')} />
      </div>

      <footer className="directional-note">
        <InfoIcon size={20} />
        <span>{t('directional')}</span>
        <small>{result.meta?.source} · {result.confidence} {t('methodological')}</small>
      </footer>
    </section>
  );
}
