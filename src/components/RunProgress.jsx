import { CheckIcon, CopyIcon } from '../icons.jsx';
import { runStages } from '../data.js';
import { useI18n } from '../i18n.jsx';

export function RunProgress({ activeStage, complete, runId, stages = [] }) {
  const { t } = useI18n();
  const copyRunId = async () => {
    if (runId && navigator.clipboard) await navigator.clipboard.writeText(runId);
  };

  return (
    <section className="run-progress" aria-label={t('progress')}>
      <ol>
        {runStages.map((stage, index) => {
          const recordedStatus = complete && stages.length
            ? stage.id === 'ground'
              ? 'completed'
              : stages.find((item) => item.stage === ({ frame: 'framing', simulate: 'panel', review: 'adjudication' }[stage.id]))?.status
            : null;
          const isFallback = recordedStatus === 'failed';
          const isComplete = recordedStatus === 'completed' || (complete && !stages.length) || (!complete && index < activeStage);
          const isActive = !complete && index === activeStage;
          return (
            <li className={`${isComplete ? 'is-complete' : ''} ${isActive ? 'is-active' : ''} ${isFallback ? 'is-fallback' : ''}`} key={stage.id}>
              <span className="stage-marker" aria-hidden="true">
                {isComplete ? <CheckIcon size={16} strokeWidth={2.3} /> : isFallback ? '!' : index + 1}
              </span>
              <span className="stage-copy">
                <strong>{index + 1} {t({ frame: 'frame', ground: 'search', simulate: 'simulate', review: 'review' }[stage.id])}</strong>
                <small>{isComplete ? t('complete') : isFallback ? t('fallback') : isActive ? t('inProgress') : t('queued')}</small>
              </span>
              {index < runStages.length - 1 ? <i className="stage-connector" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="run-reference">
        <span>{t('runLabel')} {runId || t('notStarted')}</span>
        <button disabled={!runId} onClick={copyRunId} type="button" aria-label={t('copyRun')}><CopyIcon size={17} /></button>
      </div>
    </section>
  );
}
