import { Check, CircleNotch, Copy } from '@phosphor-icons/react';
import { runStages } from '../data.js';
import { useI18n } from '../i18n.jsx';

export function RunProgress({ running, runId, stages = [] }) {
  const { t } = useI18n();
  const copyRunId = async () => {
    if (runId && navigator.clipboard) await navigator.clipboard.writeText(runId);
  };

  return (
    <section aria-busy={running} className="run-progress" aria-label={t('progress')}>
      <div className="run-progress-intro" role="status">
        <CircleNotch aria-hidden="true" className="run-progress-spinner" size={22} />
        <span><strong>{t('runInProgressTitle')}</strong><small>{t('runInProgressSummary')}</small></span>
      </div>
      <ol>
        {runStages.map((stage, index) => {
          const recordedStatus = stages.length
            ? stage.id === 'ground'
              ? 'completed'
              : stages.find((item) => item.stage === ({ frame: 'framing', simulate: 'panel', review: 'adjudication' }[stage.id]))?.status
            : null;
          const isFallback = recordedStatus === 'failed';
          const isComplete = recordedStatus === 'completed';
          const isActive = recordedStatus === 'running' || recordedStatus === 'in_progress';
          return (
            <li className={`${isComplete ? 'is-complete' : ''} ${isActive ? 'is-active' : ''} ${isFallback ? 'is-fallback' : ''}`} key={stage.id}>
              <span className="stage-marker" aria-hidden="true">
                {isComplete ? <Check size={16} weight="bold" /> : isFallback ? '!' : index + 1}
              </span>
              <span className="stage-copy">
                <strong>{index + 1} {t({ frame: 'frame', ground: 'search', simulate: 'simulate', review: 'review' }[stage.id])}</strong>
                <small>{isComplete ? t('complete') : isFallback ? t('fallback') : isActive ? t('inProgress') : t('planned')}</small>
              </span>
              {index < runStages.length - 1 ? <i className="stage-connector" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="run-reference">
        <span>{t('runLabel')} {runId || t('notStarted')}</span>
        <button disabled={!runId} onClick={copyRunId} type="button" aria-label={t('copyRun')}><Copy size={17} /></button>
      </div>
    </section>
  );
}
