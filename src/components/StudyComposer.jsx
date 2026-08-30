import { useState } from 'react';
import {
  CaretDown,
  FileText,
  GlobeHemisphereWest,
  LinkSimple,
  Play,
  Plus,
  Trash,
  Translate,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { markets, researchMethods } from '../data.js';
import { useI18n } from '../i18n.jsx';
import {
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
} from '../lib/localizationUiCatalog.js';
import { formatLocalizedList, formatLocalizedNumber } from '../lib/localizedFormatting.js';
import { MAX_RESEARCH_MATERIALS, createResearchMaterial, mergeResearchMaterials, readResearchMaterialFile } from '../lib/researchGrounding.js';
import { studyLanguageAlignment } from '../lib/studyLanguageAlignment.js';
import { studyReadinessIssues } from '../lib/studyReadiness.js';

const localizationReleaseLabel = (status, t) => ({
  'machine-drafted': t('copyStatusMachineDrafted'),
  'native-reviewed': t('copyStatusNativeReviewed'),
  'review-pending': t('nativeReviewPending'),
}[status] || t('statusCode', { status }));

const currencyResearchMethods = new Set(['PURCHASE_INTENT', 'PRICE_SENSITIVITY']);

function MarketLocaleStatusCard({ market, locale, reportLanguage, instrumentLanguage, researchMethod, study, setStudy, t, uiLocale }) {
  const routingOnly = market?.supportMode === 'MARKET_ROUTING_ONLY' && market.plannedLocales?.length;
  const localizedOutputOnly = market?.supportMode === 'MARKET_AND_LOCALIZED_OUTPUT' && market.outputEnabledLocales?.length;
  const showMarketBoundary = Boolean(routingOnly || localizedOutputOnly);
  const currentCurrency = String(study.currency || '').trim().toUpperCase();
  const showCurrencySuggestion = currencyResearchMethods.has(researchMethod)
    && market?.id !== 'GLOBAL'
    && market?.currencyCode
    && currentCurrency
    && currentCurrency !== market.currencyCode;
  if (!showMarketBoundary && !showCurrencySuggestion) return null;
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const marketLabel = market.region ? regionNames.of(market.region) : market.value;
  const interfaceLanguage = languageOptions.find((language) => language.value === uiLocale);
  const localeRows = localizedOutputOnly ? market.outputEnabledLocales : routingOnly ? market.plannedLocales : [];
  const localeLabels = formatLocalizedList(localeRows.map((entry) => entry.nativeLabel), locale);
  const titleKey = localizedOutputOnly ? 'marketLocalizedOutputTitle' : 'marketRoutingOnlyTitle';
  const bodyKey = localizedOutputOnly ? 'marketLocalizedOutputBody' : 'marketRoutingOnlyBody';
  const localeLabelKey = localizedOutputOnly ? 'marketLocalizedOutputLocalesLabel' : 'marketRoutingOnlyLocalesLabel';
  const languageStateKey = localizedOutputOnly ? 'marketLocalizedOutputLanguageState' : 'marketRoutingOnlyLanguageState';

  return (
    <aside
      aria-atomic="true"
      aria-label={showMarketBoundary ? undefined : t('currency')}
      aria-labelledby={showMarketBoundary ? 'market-locale-status-title' : undefined}
      aria-live="polite"
      className="market-locale-status"
      data-market-support-mode={market.supportMode}
      id="market-locale-status"
      role="status"
    >
      <GlobeHemisphereWest aria-hidden="true" className="market-locale-status-icon" size={20} />
      <div>
        {showMarketBoundary ? (
          <>
            <h3 id="market-locale-status-title">{t(titleKey, { market: marketLabel })}</h3>
            <p>{t(bodyKey, { market: marketLabel, countryCode: market.region, outputLocales: localeLabels })}</p>
            <div className="market-locale-list">
              <strong>{t(localeLabelKey)}</strong>
              <ul>
                {localeRows.map((entry) => <li key={entry.value}><span lang={entry.htmlLang}>{entry.nativeLabel}</span></li>)}
              </ul>
            </div>
            <p>{t(languageStateKey, {
              interfaceLanguage: interfaceLanguage?.nativeLabel || uiLocale,
              reportLanguage: reportLanguage?.nativeLabel || study.outputLocale,
              instrumentLanguage: instrumentLanguage?.nativeLabel || study.instrumentLocale || study.outputLocale,
              market: marketLabel,
            })}</p>
          </>
        ) : null}
        {showCurrencySuggestion ? (
          <div className="market-currency-suggestion">
            <span>{t('marketRoutingOnlyCurrencyNote', { currentCurrency, market: marketLabel, marketCurrency: market.currencyCode })}</span>
            <button onClick={() => setStudy({ ...study, currency: market.currencyCode })} type="button">{t('useMarketCurrency', { currency: market.currencyCode })}</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function LanguageAlignmentStatusCard({ instrumentLanguage, interfaceLanguage, onAlign, onReview, reportLanguage, t }) {
  const alignment = studyLanguageAlignment({
    interfaceLocale: interfaceLanguage?.value,
    reportLocale: reportLanguage?.value,
    instrumentLocale: instrumentLanguage?.value,
  });
  if (alignment.aligned) return null;

  return (
    <aside aria-atomic="true" aria-labelledby="language-alignment-status-title" aria-live="polite" className="language-alignment-status" id="language-alignment-status" role="status">
      <Translate aria-hidden="true" className="language-alignment-status-icon" size={20} />
      <div>
        <h3 id="language-alignment-status-title">{t('languageAlignmentTitle')}</h3>
        <p>{t('languageAlignmentBody')}</p>
        <dl className="language-alignment-values">
          <div><dt>{t('interfaceLanguage')}</dt><dd><span lang={interfaceLanguage?.htmlLang}>{interfaceLanguage?.nativeLabel || alignment.interfaceLocale}</span></dd></div>
          <div><dt>{t('reportLanguage')}</dt><dd><span lang={reportLanguage?.htmlLang}>{reportLanguage?.nativeLabel || alignment.reportLocale}</span></dd></div>
          <div><dt>{t('instrumentLanguage')}</dt><dd><span lang={instrumentLanguage?.htmlLang}>{instrumentLanguage?.nativeLabel || alignment.instrumentLocale}</span></dd></div>
        </dl>
        <div className="language-alignment-actions">
          <button onClick={onAlign} type="button"><Translate aria-hidden="true" size={15} /> {t('alignStudyLanguages', { interfaceLanguage: interfaceLanguage?.nativeLabel || alignment.interfaceLocale })}</button>
          <button className="is-secondary" onClick={onReview} type="button">{t('reviewLanguageSettings')}</button>
        </div>
      </div>
    </aside>
  );
}

function LanguageChecklist({ emptyLabel, id, invalid = false, label, onChange, options, t, values = [] }) {
  const selected = new Set(values);
  const unsupported = values.filter((value) => !options.some((option) => option.value === value));
  const visibleSelected = options.filter((option) => selected.has(option.value));
  const summary = visibleSelected.length
    ? visibleSelected.length <= 2
      ? visibleSelected.map((option) => option.nativeLabel).join(' · ')
      : t('selectedLocaleCount', { count: visibleSelected.length })
    : emptyLabel;
  const toggle = (value) => {
    const next = selected.has(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    onChange(next.slice(0, 4));
  };

  return (
    <fieldset aria-describedby={`${id}-hint${unsupported.length ? ` ${id}-error` : ''} composer-readiness`} aria-invalid={invalid} className="field locale-checklist" id={id}>
      <legend>{label}</legend>
      <details>
        <summary><span>{summary}</span><CaretDown aria-hidden="true" size={16} /></summary>
        <div className="locale-checklist-options">
          {unsupported.map((value) => (
            <label className="is-unsupported" key={value}>
              <input checked onChange={() => toggle(value)} type="checkbox" />
              <span>{value}</span>
            </label>
          ))}
          {options.map((option) => {
            const checked = selected.has(option.value);
            return (
              <label data-copy-status={option.copyStatus} data-native-review-status={option.nativeReviewStatus} key={option.value}>
                <input checked={checked} disabled={!checked && values.length >= 4} onChange={() => toggle(option.value)} type="checkbox" />
                <span lang={option.htmlLang}>{option.nativeLabel}</span>
              </label>
            );
          })}
        </div>
      </details>
      <small id={`${id}-hint`}>{t('addOrRemoveLanguages')}</small>
      {unsupported.length ? <small className="locale-selection-error" id={`${id}-error`} role="alert">{t('unsupportedLocaleSelection', { locales: unsupported.join(', ') })}</small> : null}
    </fieldset>
  );
}

function EvidenceSources({ sources, onChange, t }) {
  const visibleSources = Array.isArray(sources) ? sources : [];

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
              aria-label={t('evidenceSourceLabel', { count: index + 1 })}
              dir="auto"
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
        <Plus size={17} /> {t('addPublicSource')}
      </button>
    </div>
  );
}

function ResearchGrounding({ language, locale, materials, onChange, t }) {
  const [error, setError] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [processing, setProcessing] = useState(false);

  const addFiles = async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (materials.length >= MAX_RESEARCH_MATERIALS) {
      setError(t('researchMaterialLimit'));
      return;
    }
    setProcessing(true);
    setError('');
    const accepted = [];
    for (const file of files) {
      try {
        accepted.push(await readResearchMaterialFile(file, language));
      } catch {
        setError(t('researchMaterialReadError', { file: file.name }));
      }
    }
    const merged = mergeResearchMaterials(materials, accepted);
    const existingHashes = new Set(materials.map((material) => material.contentHash));
    const newUniqueCount = new Set(accepted.map((material) => material.contentHash).filter((hash) => hash && !existingHashes.has(hash))).size;
    onChange(merged);
    if (materials.length + newUniqueCount > merged.length) setError(t('researchMaterialLimit'));
    setProcessing(false);
  };

  const addPastedText = async () => {
    if (!pastedText.trim()) return;
    if (materials.length >= MAX_RESEARCH_MATERIALS) {
      setError(t('researchMaterialLimit'));
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const material = await createResearchMaterial({ name: t('pastedResearchExcerpt'), text: pastedText, language, sourceKind: 'PASTED_TEXT' });
      onChange(mergeResearchMaterials(materials, [material]));
      setPastedText('');
    } catch {
      setError(t('researchMaterialPasteError'));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <details className="research-grounding">
      <summary>{t('addResearchMaterial')} · {materials.length}/{MAX_RESEARCH_MATERIALS}</summary>
      <p className="grounding-boundary">{t('researchMaterialBoundary')}</p>
      <p className="grounding-privacy">{t('researchMaterialPrivacy')}</p>
      <p className="grounding-privacy">{t('researchMaterialRawText')}</p>
      <p className="grounding-privacy">{t('researchDocumentExtractionNote')}</p>
      <div className="grounding-controls">
        <label className="research-upload-button">
          <span>{t('chooseResearchFiles')}</span>
          <input accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={processing || materials.length >= MAX_RESEARCH_MATERIALS} multiple onChange={addFiles} type="file" />
        </label>
        <small>{t('researchFileLimits')}</small>
        <label htmlFor="pasted-research-material">{t('pasteResearchExcerpt')}</label>
        <textarea dir="auto" id="pasted-research-material" maxLength="100000" onChange={(event) => setPastedText(event.target.value)} rows="3" value={pastedText} />
        <button className="add-source" disabled={processing || !pastedText.trim() || materials.length >= MAX_RESEARCH_MATERIALS} onClick={addPastedText} type="button"><Plus size={16} /> {t('addExcerpt')}</button>
      </div>
      <p aria-live="polite" className="grounding-status">{processing ? t('readingResearchMaterial') : !materials.length ? t('noResearchMaterial') : ''}</p>
      {error ? <p className="grounding-error" role="alert">{error}</p> : null}
      {materials.length ? <ul className="research-material-list">{materials.map((material) => <li key={material.id}><FileText size={17} /><div><strong>{material.title}</strong><span>{formatLocalizedNumber(material.originalCharacterCount, locale)} {t('characters')} · {material.sourceKind === 'PASTED_TEXT' ? t('pastedMaterial') : material.sourceKind === 'UPLOADED_DOCUMENT' ? t('extractedDocument') : t('uploadedText')}{material.detectedType ? ` · ${material.detectedType.toUpperCase()}` : ''}{material.locators?.length ? ` · ${t('documentLocators', { count: material.locators.length })}` : ''}{material.truncated ? ` · ${t('excerptTruncated')}` : ''}</span><small title={t('clientReportedHash')}>{t('clientReportedHash')} · {material.contentHash}</small></div><button aria-label={`${t('removeResearchMaterial')} ${material.title}`} onClick={() => onChange(materials.filter((item) => item.id !== material.id))} type="button"><Trash size={16} /></button></li>)}</ul> : null}
    </details>
  );
}

function ResearchModeControl({ mode, onChange, t }) {
  const options = [
    { value: 'quick', label: t('quickResearch'), description: t('quickResearchNote') },
    { value: 'deep', label: t('deepResearch'), description: t('deepResearchNote') },
  ];

  return (
    <fieldset className="research-mode-control">
      <legend>{t('researchMode')}</legend>
      <div className="research-mode-options">
        {options.map((option) => (
          <label className={mode === option.value ? 'is-selected' : ''} key={option.value}>
            <input checked={mode === option.value} name="research-mode" onChange={() => onChange(option.value)} type="radio" value={option.value} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

let methodItemSequence = 0;
const nextMethodItemId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(++methodItemSequence).toString(36)}`;

function MethodTextField({ className = '', id, label, onChange, required = false, rows = 0, t, type = 'text', value }) {
  return (
    <div className={`field method-input-field ${className}`}>
      <label htmlFor={id}>{label}{required ? <span>{t('required')}</span> : null}</label>
      {rows ? (
        <textarea dir="auto" id={id} onChange={(event) => onChange(event.target.value)} rows={rows} value={value || ''} />
      ) : (
        <div className="input-wrap"><input dir="auto" id={id} min={type === 'number' ? '0' : undefined} onChange={(event) => onChange(event.target.value)} step={type === 'number' ? 'any' : undefined} type={type} value={value || ''} /></div>
      )}
    </div>
  );
}

function MethodListField({ addLabel, className = '', id, itemLabel, items = [], label, maximum, minimum, onChange, prefix, t, type = 'text', valueKey }) {
  const updateItem = (index, value) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [valueKey]: value } : item));
  const removeItem = (index) => onChange(items.filter((_, itemIndex) => itemIndex !== index));
  const addItem = () => onChange([...items, { id: nextMethodItemId(prefix), [valueKey]: '' }]);
  return (
    <fieldset className={`field method-list-field ${className}`} id={id || `${prefix}-items`} tabIndex="-1">
      <legend>{label} <span>{minimum}–{maximum}</span></legend>
      <div className="method-list-rows">
        {items.map((item, index) => (
          <div className="method-list-row" key={item.id || `${prefix}-${index}`}>
            <span aria-hidden="true">{index + 1}</span>
            <input aria-label={`${itemLabel} ${index + 1}`} dir="auto" id={`${prefix}-${item.id || index + 1}`} min={type === 'number' ? '0' : undefined} onChange={(event) => updateItem(index, event.target.value)} step={type === 'number' ? 'any' : undefined} type={type} value={item[valueKey] || ''} />
            <button aria-label={`${t('removeItem')} ${index + 1}`} disabled={items.length <= minimum} onClick={() => removeItem(index)} type="button"><Trash size={15} /></button>
          </div>
        ))}
      </div>
      <button className="add-source" disabled={items.length >= maximum} onClick={addItem} type="button"><Plus size={15} /> {addLabel}</button>
    </fieldset>
  );
}

function MethodFields({ method, setStudy, study, t }) {
  const setValue = (key) => (value) => setStudy({ ...study, [key]: value });
  switch (method) {
    case 'CONCEPT_TEST':
      return <MethodTextField className="concept-field" id="concept-stimulus" label={t('conceptStimulus')} onChange={setValue('concept')} required rows={3} t={t} value={study.concept} />;
    case 'PURCHASE_INTENT':
      return <>
        <MethodTextField className="purchase-offer-field" id="purchase-offer" label={t('exactOffer')} onChange={setValue('offer')} required rows={3} t={t} value={study.offer} />
        <MethodTextField className="purchase-category-field" id="purchase-category" label={t('category')} onChange={setValue('category')} t={t} value={study.category} />
        <MethodTextField className="purchase-price-field" id="purchase-price" label={t('price')} onChange={setValue('priceAmount')} t={t} type="number" value={study.priceAmount} />
        <MethodTextField className="purchase-currency-field" id="purchase-currency" label={t('currency')} onChange={(value) => setValue('currency')(value.toUpperCase().slice(0, 3))} t={t} value={study.currency} />
        <MethodTextField className="purchase-unit-field" id="purchase-unit" label={t('priceUnit')} onChange={setValue('priceUnit')} t={t} value={study.priceUnit} />
        <MethodTextField className="purchase-channel-field" id="purchase-channel" label={t('purchaseChannel')} onChange={setValue('purchaseChannel')} t={t} value={study.purchaseChannel} />
        <MethodTextField className="purchase-horizon-field" id="purchase-horizon" label={t('purchaseHorizon')} onChange={setValue('purchaseHorizon')} t={t} value={study.purchaseHorizon} />
        <MethodTextField className="purchase-alternative-field" id="purchase-alternative" label={t('referenceAlternative')} onChange={setValue('referenceAlternative')} t={t} value={study.referenceAlternative} />
      </>;
    case 'MESSAGE_TEST':
      return <>
        <MethodTextField className="method-long-field" id="message-stimulus" label={t('messageStimulus')} onChange={setValue('message')} required rows={3} t={t} value={study.message} />
        <MethodTextField className="method-medium-field" id="intended-action" label={t('intendedAction')} onChange={setValue('intendedAction')} required t={t} value={study.intendedAction} />
        <MethodTextField className="method-medium-field" id="message-exposure-context" label={t('exposureContext')} onChange={setValue('exposureContext')} t={t} value={study.exposureContext} />
      </>;
    case 'CLAIMS_TEST':
      return <>
        <MethodTextField className="method-long-field" id="claim-stimulus" label={t('claimStimulus')} onChange={setValue('claim')} required rows={3} t={t} value={study.claim} />
        <div className="field method-medium-field"><label htmlFor="claim-status">{t('claimStatus')} <span>{t('required')}</span></label><div className="select-wrap"><select id="claim-status" onChange={(event) => setValue('claimStatus')(event.target.value)} value={study.claimStatus || 'NOT_SUPPLIED'}><option value="NOT_SUPPLIED">{t('claimStatusNotSupplied')}</option><option value="UNVERIFIED">{t('claimStatusUnverified')}</option><option value="USER_DECLARED_SUBSTANTIATED">{t('claimStatusDeclared')}</option></select><CaretDown className="select-chevron" size={17} /></div></div>
        <MethodTextField className="method-medium-field" id="claim-exposure-context" label={t('exposureContext')} onChange={setValue('exposureContext')} t={t} value={study.exposureContext} />
      </>;
    case 'UX_EXPECTATION_TEST':
      return <>
        <MethodTextField className="method-long-field" id="task-scenario" label={t('taskScenario')} onChange={setValue('taskScenario')} required rows={3} t={t} value={study.taskScenario} />
        <MethodTextField className="method-medium-field" id="user-goal" label={t('userGoal')} onChange={setValue('userGoal')} required t={t} value={study.userGoal} />
        <MethodTextField className="method-long-field" id="experience-description" label={t('experienceDescription')} onChange={setValue('experienceDescription')} required rows={3} t={t} value={study.experienceDescription} />
        <MethodTextField className="method-medium-field" id="ux-context" label={t('experienceContext')} onChange={setValue('uxContext')} t={t} value={study.uxContext} />
        <MethodTextField className="method-medium-field" id="ux-device" label={t('device')} onChange={setValue('device')} t={t} value={study.device} />
      </>;
    case 'FEATURE_PRIORITIZATION':
      return <>
        <MethodListField addLabel={t('addFeature')} className="method-list-wide" id="feature-items" itemLabel={t('feature')} items={study.featureItems || []} label={t('features')} maximum={8} minimum={3} onChange={setValue('featureItems')} prefix="feature" t={t} valueKey="text" />
        <MethodTextField className="method-medium-field" id="decision-context" label={t('decisionContext')} onChange={setValue('decisionContext')} required t={t} value={study.decisionContext} />
        <MethodTextField className="method-medium-field" id="selection-constraint" label={t('selectionConstraint')} onChange={setValue('selectionConstraint')} required t={t} value={study.selectionConstraint} />
      </>;
    case 'BRAND_POSITIONING':
      return <>
        <MethodTextField className="method-medium-field" id="focal-brand" label={t('focalBrand')} onChange={setValue('focalBrand')} required t={t} value={study.focalBrand} />
        <MethodTextField className="method-medium-field" id="brand-category" label={t('category')} onChange={setValue('category')} required t={t} value={study.category} />
        <MethodListField addLabel={t('addComparator')} className="method-list-half" id="comparator-brands" itemLabel={t('comparatorBrand')} items={study.comparatorBrands || []} label={t('comparatorBrands')} maximum={5} minimum={2} onChange={setValue('comparatorBrands')} prefix="brand" t={t} valueKey="label" />
        <MethodListField addLabel={t('addAttribute')} className="method-list-half" id="brand-attributes" itemLabel={t('attribute')} items={study.brandAttributes || []} label={t('attributes')} maximum={6} minimum={3} onChange={setValue('brandAttributes')} prefix="attribute" t={t} valueKey="label" />
      </>;
    case 'PRICE_SENSITIVITY':
      return <>
        <MethodTextField className="method-long-field" id="price-offer" label={t('exactOffer')} onChange={setValue('offer')} required rows={3} t={t} value={study.offer} />
        <MethodTextField className="method-medium-field" id="price-category" label={t('category')} onChange={setValue('category')} required t={t} value={study.category} />
        <MethodTextField className="method-short-field" id="price-currency" label={t('currency')} onChange={(value) => setValue('currency')(value.toUpperCase().slice(0, 3))} required t={t} value={study.currency} />
        <MethodTextField className="method-medium-field" id="price-unit" label={t('priceUnit')} onChange={setValue('priceUnit')} required t={t} value={study.priceUnit} />
        <MethodTextField className="method-medium-field" id="price-channel" label={t('purchaseChannel')} onChange={setValue('purchaseChannel')} required t={t} value={study.purchaseChannel} />
        <MethodTextField className="method-medium-field" id="price-horizon" label={t('purchaseHorizon')} onChange={setValue('purchaseHorizon')} required t={t} value={study.purchaseHorizon} />
        <MethodTextField className="method-medium-field" id="price-alternative" label={t('referenceAlternative')} onChange={setValue('referenceAlternative')} required t={t} value={study.referenceAlternative} />
        <MethodListField addLabel={t('addPricePoint')} className="method-list-wide" id="price-points" itemLabel={t('pricePoint')} items={study.pricePoints || []} label={t('ascendingPricePoints')} maximum={8} minimum={3} onChange={setValue('pricePoints')} prefix="price" t={t} type="number" valueKey="amount" />
      </>;
    case 'SURVEY_PRETEST':
      return <>
        <MethodTextField className="method-medium-field" id="study-objective" label={t('studyObjective')} onChange={setValue('studyObjective')} required rows={3} t={t} value={study.studyObjective} />
        <MethodTextField className="method-medium-field" id="target-population" label={t('targetPopulation')} onChange={setValue('targetPopulation')} required rows={3} t={t} value={study.targetPopulation} />
        <MethodListField addLabel={t('addSurveyQuestion')} className="method-list-wide" id="survey-questions" itemLabel={t('surveyQuestion')} items={study.surveyQuestions || []} label={t('surveyQuestions')} maximum={50} minimum={1} onChange={setValue('surveyQuestions')} prefix="question" t={t} valueKey="text" />
      </>;
    case 'INTERVIEW_GUIDE':
      return <>
        <MethodTextField className="method-medium-field" id="research-objective" label={t('researchObjective')} onChange={setValue('researchObjective')} required rows={3} t={t} value={study.researchObjective} />
        <MethodTextField className="method-medium-field" id="participant-context" label={t('participantContext')} onChange={setValue('participantContext')} required rows={3} t={t} value={study.participantContext} />
        <MethodListField addLabel={t('addTopic')} className="method-list-half" id="interview-topics" itemLabel={t('topic')} items={study.interviewTopics || []} label={t('interviewTopics')} maximum={8} minimum={2} onChange={setValue('interviewTopics')} prefix="topic" t={t} valueKey="label" />
        <MethodListField addLabel={t('addSensitiveArea')} className="method-list-half" id="sensitive-areas" itemLabel={t('sensitiveArea')} items={study.sensitiveAreas || []} label={t('sensitiveAreas')} maximum={8} minimum={0} onChange={setValue('sensitiveAreas')} prefix="sensitive-area" t={t} valueKey="text" />
      </>;
    default:
      return null;
  }
}

function SampleLineageNotice({ lineage, t }) {
  if (!lineage) return null;
  const automatedQaStatus = lineage.automatedQa?.status === 'passed'
    ? t('sampleAutomatedQaPassed')
    : t('sampleAutomatedQaNotRun');
  const nativeReviewStatus = localizationReleaseLabel(lineage.nativeReview?.status, t);
  return (
    <aside
      aria-atomic="true"
      aria-labelledby="sample-lineage-title"
      className="sample-lineage-notice"
      data-automated-qa-status={lineage.automatedQa?.status || 'unrecorded'}
      data-native-review-status={lineage.nativeReview?.status || 'unrecorded'}
      data-sample-lineage={lineage.source || 'unknown'}
      data-sample-slug={lineage.slug || 'unknown'}
      role="note"
      tabIndex="0"
    >
      <FileText aria-hidden="true" className="sample-lineage-notice-icon" size={20} />
      <div>
        <h3 id="sample-lineage-title">{t('sampleLineageTitle')}</h3>
        <p>{t('sampleLineageNotice', { automatedQaStatus, nativeReviewStatus })}</p>
      </div>
    </aside>
  );
}

export function StudyComposer({ study, setStudy, groundingMaterials = [], onGroundingMaterialsChange, onRun, onClose, running, hasExistingReport = false, uiLocale = 'en-US' }) {
  const { locale, t } = useI18n();
  const [attempted, setAttempted] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const selectedMethod = study.researchMethod || 'GENERAL_LIKERT';
  const selectedInterfaceLanguage = languageOptions.find((language) => language.value === uiLocale) || languageOptions[0];
  const selectedReportLanguage = reportLanguageOptions.find((language) => language.value === study.outputLocale) || reportLanguageOptions[0];
  const effectiveInstrumentLocale = study.instrumentLocale || study.outputLocale;
  const selectedInstrumentLanguage = instrumentLanguageOptions.find((language) => language.value === effectiveInstrumentLocale) || selectedReportLanguage;
  const readinessIssues = studyReadinessIssues(study);
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const selectedMarket = markets.find((market) => market.value === study.market);
  const showMarketBoundary = (selectedMarket?.supportMode === 'MARKET_ROUTING_ONLY' && selectedMarket.plannedLocales?.length > 0)
    || (selectedMarket?.supportMode === 'MARKET_AND_LOCALIZED_OUTPUT' && selectedMarket.outputEnabledLocales?.length > 0);
  const currentCurrency = String(study.currency || '').trim().toUpperCase();
  const showMarketCurrencySuggestion = currencyResearchMethods.has(selectedMethod)
    && selectedMarket?.id !== 'GLOBAL'
    && selectedMarket?.currencyCode
    && currentCurrency
    && currentCurrency !== selectedMarket.currencyCode;
  const showMarketNotice = showMarketBoundary || showMarketCurrencySuggestion;
  const marketNoticeId = showMarketNotice ? 'market-locale-status' : undefined;
  const assumptionCount = study.assumptions?.trim() ? study.assumptions.split(/[.;\n]+/).filter(Boolean).length : 0;
  const validSources = (study.sources || []).filter((source) => source.trim());
  const issueFor = (fieldId) => readinessIssues.some((issue) => issue.fieldId === fieldId);
  const focusIssue = (issue) => {
    const field = document.getElementById(issue.fieldId);
    if (!field) return;
    if (typeof field.focus === 'function' && !['FIELDSET', 'DIV'].includes(field.tagName)) field.focus();
    else field.querySelector?.('input, textarea, select, button')?.focus();
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    if (running) return;
    setAttempted(true);
    if (readinessIssues.length) {
      const focusFirstIssue = () => focusIssue(readinessIssues[0]);
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusFirstIssue);
      else focusFirstIssue();
      return;
    }
    onRun();
  };
  const issueText = (issue) => `${t(issue.labelKey)} — ${t(issue.reasonKey, issue.variables)}`;
  const listedIssues = attempted ? readinessIssues : readinessIssues.slice(0, 3);
  const focusLocalizationSettings = () => {
    setContextOpen(true);
    const focusReportLanguage = () => document.getElementById('report-language')?.focus();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusReportLanguage);
    else focusReportLanguage();
  };
  const alignStudyLanguages = () => {
    setStudy({ ...study, outputLocale: uiLocale, instrumentLocale: '' });
    focusLocalizationSettings();
  };

  return (
    <section className="composer" aria-labelledby="brief-editor-title">
      <header className="composer-header">
        <div>
          <h2 id="brief-editor-title">{t('editBrief')}</h2>
          <p>{t('editBriefNote')}</p>
        </div>
        <button aria-label={t('closeBrief')} className="composer-close" onClick={onClose} type="button"><X size={20} /></button>
      </header>
      <MarketLocaleStatusCard
        instrumentLanguage={selectedInstrumentLanguage}
        locale={locale}
        market={selectedMarket}
        reportLanguage={selectedReportLanguage}
        researchMethod={selectedMethod}
        setStudy={setStudy}
        study={study}
        t={t}
        uiLocale={uiLocale}
      />
      <LanguageAlignmentStatusCard
        instrumentLanguage={selectedInstrumentLanguage}
        interfaceLanguage={selectedInterfaceLanguage}
        onAlign={alignStudyLanguages}
        onReview={focusLocalizationSettings}
        reportLanguage={selectedReportLanguage}
        t={t}
      />
      <SampleLineageNotice lineage={study.sampleLineage} t={t} />
      <form className="composer-form" noValidate onSubmit={handleSubmit}>
        <div className="composer-fields">
          <div className="field research-method-field">
            <label htmlFor="research-method">{t('researchMethod')}</label>
            <div className="select-wrap">
              <select aria-describedby="research-method-hint" id="research-method" value={selectedMethod} onChange={(event) => setStudy({ ...study, researchMethod: event.target.value })}>
                {selectedMethod === 'GENERAL_LIKERT' ? <option value="GENERAL_LIKERT">{t('generalLikertLegacy')}</option> : null}
                {researchMethods.map((method) => <option key={method.id} value={method.id}>{t(method.titleKey)}</option>)}
              </select>
              <CaretDown className="select-chevron" size={17} />
            </div>
            <small id="research-method-hint">{selectedMethod === 'GENERAL_LIKERT' ? t('generalLikertLegacyDescription') : t(researchMethods.find((method) => method.id === selectedMethod)?.descriptionKey || 'conceptIntentTestDescription')}</small>
          </div>

          <div className="field question-field">
            <label htmlFor="research-question">{t('question')}</label>
            <textarea aria-describedby="composer-readiness" aria-invalid={attempted && issueFor('research-question')} dir="auto" id="research-question" placeholder={t('questionPlaceholder')} value={study.prompt} onChange={(event) => setStudy({ ...study, prompt: event.target.value })} rows="3" />
          </div>

          <div className="field audience-field">
            <label htmlFor="audience">{t('audience')}</label>
            <div className="input-wrap">
              <UsersThree size={19} />
              <input aria-describedby="composer-readiness" aria-invalid={attempted && issueFor('audience')} dir="auto" id="audience" placeholder={t('audiencePlaceholder')} value={study.audience} onChange={(event) => setStudy({ ...study, audience: event.target.value })} />
            </div>
          </div>

          <MethodFields method={selectedMethod} setStudy={setStudy} study={study} t={t} />

          <details className="composer-context" onToggle={(event) => setContextOpen(event.currentTarget.open)} open={contextOpen}>
            <summary>{t('optionalContext')}</summary>
            <div className="composer-context-fields">
              <fieldset className="localization-settings">
                <legend>{t('localizationSettings')}</legend>
                <p>{t('localizationSettingsNote')} {t('localizationDimensionsIndependent')}</p>
                {(study.outputLocale !== uiLocale || effectiveInstrumentLocale !== uiLocale) ? <button className="localization-sync-button" onClick={alignStudyLanguages} type="button">{t('useInterfaceForStudy')}</button> : null}
                <div className="localization-settings-grid">
                  <div className="field market-field">
                    <label htmlFor="market">{t('market')}</label>
                    <div className="select-wrap">
                      <GlobeHemisphereWest size={19} />
                      <select aria-describedby={`market-hint composer-readiness${marketNoticeId ? ` ${marketNoticeId}` : ''}`} aria-invalid={attempted && issueFor('market')} id="market" value={study.market} onChange={(event) => setStudy({ ...study, market: event.target.value })}>
                        {markets.map((market) => <option key={market.value} value={market.value}>{market.region ? regionNames.of(market.region) : t('global')}</option>)}
                      </select>
                      <CaretDown className="select-chevron" size={17} />
                    </div>
                    <small id="market-hint">{t('marketLocalizationNote')}</small>
                  </div>

                  <div className="field report-language-field">
                    <label htmlFor="report-language">{t('reportLanguage')}</label>
                    <div className="select-wrap compact-select">
                      <select aria-describedby="report-language-hint composer-readiness" aria-invalid={attempted && issueFor('report-language')} id="report-language" value={study.outputLocale} onChange={(event) => setStudy({ ...study, outputLocale: event.target.value })}>
                        {reportLanguageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
                      </select>
                      <CaretDown className="select-chevron" size={17} />
                    </div>
                    <small id="report-language-hint">{t('reportLanguageNote')}</small>
                    {selectedReportLanguage ? <small data-copy-status={selectedReportLanguage.copyStatus} data-native-review-status={selectedReportLanguage.nativeReviewStatus}>{t('localizationReadiness', { copyStatus: localizationReleaseLabel(selectedReportLanguage.copyStatus, t), nativeReviewStatus: localizationReleaseLabel(selectedReportLanguage.nativeReviewStatus, t) })}</small> : null}
                  </div>

                  <div className="field instrument-language-field">
                    <label htmlFor="instrument-language">{t('instrumentLanguage')}</label>
                    <div className="select-wrap compact-select">
                      <select aria-describedby="instrument-language-hint composer-readiness" aria-invalid={attempted && issueFor('instrument-language')} id="instrument-language" value={study.instrumentLocale || ''} onChange={(event) => setStudy({ ...study, instrumentLocale: event.target.value })}>
                        <option value="">{t('sameAsReport')}</option>
                        {instrumentLanguageOptions.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel}</option>)}
                      </select>
                      <CaretDown className="select-chevron" size={17} />
                    </div>
                    <small id="instrument-language-hint">{t('instrumentLanguageNote')}</small>
                    {study.instrumentLocale && study.instrumentLocale !== study.outputLocale ? <small className="localization-mismatch" role="status">{t('reportInstrumentMismatch')}</small> : null}
                    {selectedInstrumentLanguage ? <small data-copy-status={selectedInstrumentLanguage.copyStatus} data-native-review-status={selectedInstrumentLanguage.nativeReviewStatus}>{t('localizationReadiness', { copyStatus: localizationReleaseLabel(selectedInstrumentLanguage.copyStatus, t), nativeReviewStatus: localizationReleaseLabel(selectedInstrumentLanguage.nativeReviewStatus, t) })}</small> : null}
                  </div>

                  <LanguageChecklist emptyLabel={t('sourceLanguagesNone')} id="source-languages" invalid={attempted && issueFor('source-languages')} label={t('sourceLanguage')} onChange={(sourceLanguages) => setStudy({ ...study, sourceLanguages })} options={sourceLanguageOptions} t={t} values={study.sourceLanguages || []} />

                  <div className="field retrieval-policy-field">
                    <label htmlFor="retrieval-policy">{t('retrievalPolicy')}</label>
                    <div className="select-wrap compact-select">
                      <select aria-describedby="retrieval-policy-hint composer-readiness" aria-invalid={attempted && issueFor('retrieval-policy')} id="retrieval-policy" value={study.retrievalPolicy || 'ANY'} onChange={(event) => setStudy({ ...study, retrievalPolicy: event.target.value, ...(event.target.value === 'ANY' ? { retrievalLocales: [] } : {}) })}>
                        <option value="ANY">{t('retrievalAny')}</option>
                        <option value="PREFER">{t('retrievalPrefer')}</option>
                        <option value="REQUIRE">{t('retrievalRequire')}</option>
                      </select>
                      <CaretDown className="select-chevron" size={17} />
                    </div>
                    <small id="retrieval-policy-hint">{t('retrievalLanguageNote')}</small>
                    {study.retrievalPolicy === 'REQUIRE' ? <small className="localization-mismatch" role="status">{t('retrievalRequireWarning')}</small> : null}
                  </div>

                  {study.retrievalPolicy !== 'ANY' ? <LanguageChecklist emptyLabel={t('sourceLanguagesNone')} id="retrieval-locales" invalid={attempted && issueFor('retrieval-locales')} label={t('retrievalLanguage')} onChange={(retrievalLocales) => setStudy({ ...study, retrievalLocales })} options={retrievalLanguageOptions} t={t} values={study.retrievalLocales || []} /> : null}
                </div>
              </fieldset>

              <div className="field research-mode-field">
                <ResearchModeControl mode={study.researchMode || 'quick'} onChange={(researchMode) => setStudy({ ...study, researchMode })} t={t} />
              </div>

              <div className="field sources-field">
                <label>{t('sources')} <span>{t('optionalUrls')}</span></label>
                <EvidenceSources sources={study.sources || []} onChange={(sources) => setStudy({ ...study, sources })} t={t} />
                <ResearchGrounding language={study.sourceLanguages?.[0] || null} locale={locale} materials={groundingMaterials} onChange={onGroundingMaterialsChange} t={t} />
              </div>

              <details className="assumptions-control">
                <summary>{t('assumptions')} · {assumptionCount}</summary>
                <label htmlFor="assumptions">{t('assumptionsLabel')}</label>
                <textarea dir="auto" id="assumptions" onChange={(event) => setStudy({ ...study, assumptions: event.target.value })} rows="3" value={study.assumptions} />
                <small>{t('assumptionsNote')}</small>
              </details>
            </div>
          </details>
        </div>

        <div className="composer-actions">
          <button className={`run-button ${running ? 'is-running' : ''}`} disabled={running} type="submit">
            <Play size={18} weight="fill" />
            <span>{running ? t('running') : hasExistingReport ? t('runUpdatedStudy') : t('runStudy')}</span>
          </button>

          <div aria-live="polite" className={`preflight-summary-panel ${readinessIssues.length ? 'has-issues' : 'is-ready'}`} id="composer-readiness" role="status">
            <p className="preflight-summary-heading"><LinkSimple size={15} /> {readinessIssues.length ? t('readinessMissing', { count: readinessIssues.length }) : t('readinessReady')}</p>
            {readinessIssues.length ? <ul>{listedIssues.map((issue, index) => <li key={`${issue.fieldId}-${issue.reasonKey}-${index}`}><button aria-label={t('focusRequirement', { requirement: issueText(issue) })} className="readiness-issue" onClick={() => focusIssue(issue)} type="button">{issueText(issue)}</button></li>)}</ul> : <p>{validSources.length ? t('readySources', { sources: validSources.length, assumptions: assumptionCount }) : t('autoEvidence')}</p>}
            {!attempted && readinessIssues.length > listedIssues.length ? <small>{t('readinessMore', { count: readinessIssues.length - listedIssues.length })}</small> : null}
            {attempted && readinessIssues.length ? <small>{t('readinessFocusHint')}</small> : null}
          </div>
        </div>
      </form>
    </section>
  );
}
