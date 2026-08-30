import { ArrowRight, Eye } from '@phosphor-icons/react';
import { useI18n } from '../i18n.jsx';

export function FirstRunStart({ onStart, onViewExample }) {
  const { t } = useI18n();

  return (
    <section className="first-run-start" aria-describedby="first-run-start-boundary" aria-labelledby="first-run-start-title">
      <div className="first-run-start-copy">
        <p className="first-run-start-kicker">{t('firstRunKicker')}</p>
        <h1 id="first-run-start-title">{t('firstRunTitle')}</h1>
        <p className="first-run-start-description">{t('firstRunDescription')}</p>
      </div>

      <div className="first-run-start-actions">
        <button className="first-run-start-primary" id="first-run-start-button" onClick={onStart} type="button">
          <span>{t('startStudy')}</span>
          <ArrowRight aria-hidden="true" size={18} weight="bold" />
        </button>
        <button className="first-run-start-secondary" onClick={onViewExample} type="button">
          <Eye aria-hidden="true" size={18} />
          <span>{t('viewExample')}</span>
        </button>
      </div>

      <p className="first-run-start-boundary" id="first-run-start-boundary">{t('firstRunBoundary')}</p>
    </section>
  );
}

export function ExampleReportNotice({ onStart }) {
  const { t } = useI18n();

  return (
    <section className="example-report-notice" aria-label={t('exampleReportLabel')}>
      <div className="example-report-notice-copy">
        <strong>{t('exampleReportLabel')}</strong>
        <span>{t('exampleReportDescription')}</span>
      </div>
      <button className="example-report-start" onClick={onStart} type="button">
        <span>{t('startStudy')}</span>
        <ArrowRight aria-hidden="true" size={16} weight="bold" />
      </button>
    </section>
  );
}
