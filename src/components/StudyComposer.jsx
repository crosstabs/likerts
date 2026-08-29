import {
  CaretDown,
  FileText,
  GlobeHemisphereWest,
  LinkSimple,
  Play,
  Plus,
  Trash,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { markets } from '../data.js';
import { languageOptions, useI18n } from '../i18n.jsx';

function RespondentCounter({ value, onChange, label }) {
  const adjust = (delta) => onChange(Math.min(500, Math.max(50, value + delta)));
  return (
    <div className="counter" aria-label={label}>
      <button type="button" onClick={() => adjust(-50)} aria-label={`−50 ${label}`}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => adjust(50)} aria-label={`+50 ${label}`}>+</button>
    </div>
  );
}

function EvidenceSources({ sources, onChange, t }) {
  const visibleSources = sources.length ? sources : [''];

  const updateSource = (index, value) => {
    const next = [...visibleSources];
    next[index] = value;
    onChange(next);
  };

  const removeSource = (index) => {
    onChange(visibleSources.filter((_, sourceIndex) => sourceIndex !== index));
  };

  const addSource = () => {
    if (visibleSources.length < 4) onChange([...visibleSources, '']);
  };

  return (
    <div className="evidence-inputs">
      <div className="source-list">
        {visibleSources.map((source, index) => (
          <div className="source-input" key={`source-${index}`}>
            <FileText size={17} />
            <input
              aria-label={`Evidence source ${index + 1}`}
              inputMode="url"
              onChange={(event) => updateSource(index, event.target.value)}
              placeholder="https://official-source.org/report"
              type="url"
              value={source}
            />
            <button type="button" aria-label={`${t('removeSource')} ${index + 1}`} onClick={() => removeSource(index)}>
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
      <button className="add-source" disabled={visibleSources.length >= 4} onClick={addSource} type="button">
        <Plus size={17} /> {t('addSource')}
      </button>
    </div>
  );
}

export function StudyComposer({ study, setStudy, onRun, onClose, running }) {
  const { locale, t } = useI18n();
  const validSources = (study.sources || []).filter((source) => source.trim());
  const assumptionCount = study.assumptions?.trim() ? study.assumptions.split(/[.;\n]+/).filter(Boolean).length : 0;
  const canRun = study.prompt.trim().length >= 12 && study.audience.trim().length >= 3 && !running;
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });

  return (
    <section className="composer" aria-labelledby="brief-editor-title">
      <header className="composer-header">
        <div>
          <h2 id="brief-editor-title">{t('editBrief')}</h2>
          <p>{t('editBriefNote')}</p>
        </div>
        <button aria-label={t('closeBrief')} className="composer-close" onClick={onClose} type="button"><X size={20} /></button>
      </header>
      <div className="composer-fields">
        <div className="field question-field">
          <label htmlFor="research-question">{t('question')}</label>
          <textarea
            id="research-question"
            value={study.prompt}
            onChange={(event) => setStudy({ ...study, prompt: event.target.value })}
            rows="3"
          />
        </div>

        <div className="field audience-field">
          <label htmlFor="audience">{t('audience')}</label>
          <div className="input-wrap">
            <UsersThree size={19} />
            <input
              id="audience"
              placeholder={t('audiencePlaceholder')}
              value={study.audience}
              onChange={(event) => setStudy({ ...study, audience: event.target.value })}
            />
          </div>
        </div>

        <div className="field market-field">
          <label htmlFor="market">{t('market')}</label>
          <div className="select-wrap">
            <GlobeHemisphereWest size={19} />
            <select id="market" value={study.market} onChange={(event) => setStudy({ ...study, market: event.target.value })}>
              {markets.map((market) => (
                <option key={market.value} value={market.value}>{market.region ? regionNames.of(market.region) : t('global')}</option>
              ))}
            </select>
            <CaretDown className="select-chevron" size={17} />
          </div>
        </div>

        <div className="field report-language-field">
          <label htmlFor="report-language">{t('reportLanguage')}</label>
          <div className="select-wrap compact-select">
            <select id="report-language" value={study.outputLocale} onChange={(event) => setStudy({ ...study, outputLocale: event.target.value })}>
              {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
            </select>
            <CaretDown className="select-chevron" size={17} />
          </div>
        </div>

        <div className="field source-language-field">
          <label htmlFor="source-language">{t('sourceLanguage')}</label>
          <div className="select-wrap compact-select">
            <select
              id="source-language"
              value={study.sourceLanguages?.[0] || ''}
              onChange={(event) => setStudy({ ...study, sourceLanguages: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">{t('anyLanguage')}</option>
              {languageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
            </select>
            <CaretDown className="select-chevron" size={17} />
          </div>
        </div>

        <div className="field respondent-field">
          <label>{t('units')} <span>{t('notPeople')}</span></label>
          <RespondentCounter
            label={t('units')}
            value={study.panelSize}
            onChange={(panelSize) => setStudy({ ...study, panelSize })}
          />
        </div>

        <div className="field sources-field">
          <label>{t('sources')} <span>{t('optionalUrls')}</span></label>
          <EvidenceSources
            sources={study.sources || []}
            onChange={(sources) => setStudy({ ...study, sources })}
            t={t}
          />
        </div>
      </div>

      <div className="composer-actions">
        <button
          className={`run-button ${running ? 'is-running' : ''}`}
          disabled={!canRun}
          onClick={onRun}
          type="button"
        >
          <Play size={18} weight="fill" />
          <span>{running ? t('running') : t('run')}</span>
        </button>

        <details className="assumptions-control">
          <summary>{t('assumptions')} · {assumptionCount}</summary>
          <label htmlFor="assumptions">{t('assumptionsLabel')}</label>
          <textarea
            id="assumptions"
            onChange={(event) => setStudy({ ...study, assumptions: event.target.value })}
            rows="3"
            value={study.assumptions}
          />
          <small>{t('assumptionsNote')}</small>
        </details>

        <p className="preflight-summary">
          <LinkSimple size={15} />
          {validSources.length
            ? t('readySources', { sources: validSources.length, assumptions: assumptionCount })
            : t('autoEvidence')}
        </p>
      </div>
    </section>
  );
}
