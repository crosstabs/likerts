import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceSource = () => readFile(new URL('../src/components/ResultsWorkspace.jsx', import.meta.url), 'utf8');
const workspaceStyles = () => readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const browserVerifierSource = () => readFile(new URL('../scripts/verify-browser.mjs', import.meta.url), 'utf8');

test('results workspace exposes a native section picker alongside keyboard tabs', async () => {
  const source = await workspaceSource();
  assert.match(source, /className="result-section-picker"/);
  assert.match(source, /<select id="result-section-picker" onChange=\{\(event\) => setActiveTab\(event\.target\.value\)\} value=\{activeTab\}>/);
  assert.match(source, /role="tablist" aria-label=\{t\('reportSection'\)\}/);
  assert.match(source, /const handleTabKeyDown = \(event, index\) =>/);
  assert.match(source, /<div aria-labelledby="attribute-matrix-title" className="method-table-scroll" role="region" tabIndex="0">/);
  assert.match(source, /<caption className="sr-only">\{methodResult\.matrixLabel \|\| t\('attributeMatrix'\)\}<\/caption>/);
});

test('directional results use method-specific top-two labels and keep follow-up paths actionable', async () => {
  const source = await workspaceSource();
  assert.match(source, /PURCHASE_INTENT: 'probablyOrDefinitelyWould'/);
  assert.match(source, /MESSAGE_TEST: 'compellingOrVeryCompelling'/);
  assert.match(source, /CLAIMS_TEST: 'believableOrVeryBelievable'/);
  assert.match(source, /UX_EXPECTATION_TEST: 'easyOrVeryEasy'/);
  assert.match(source, /const topTwoLabelKey = topTwoLabelKeyFor\(result\.researchDesign\);/);
  assert.match(source, /const topTwoLabelKey = topTwoLabelKeyFor\(researchDesign\);/);
  assert.doesNotMatch(source, /\{t\('likelyOrVeryLikely'\)\}<\/span>/);
  assert.match(source, /className="next-steps result-validation-next-step" aria-labelledby="next-steps-title"/);
  assert.match(source, /onClick=\{onExploreSegments\}/);
  assert.match(source, /onClick=\{onValidateWithPeople\}/);
  assert.match(source, /<MethodResultOverview onExploreSegments=\{exploreModeledSegments\} onValidateWithPeople=\{validateWithPeople\} result=\{result\} runComplete=\{runComplete\} \/>/);
  assert.match(source, /focusWorkspace\('segments-title'\)/);
  assert.match(source, /focusWorkspace\(handoffAvailable \? 'human-research-handoff-title' : 'research-design-method-title'\)/);
  assert.match(source, /segmentPerspectiveEligible === true/);
});

test('every completed specialized result exposes one direct human-validation next step', async () => {
  const source = await workspaceSource();
  assert.match(source, /function HumanValidationNextStep\(\{ onExploreSegments, onValidateWithPeople, runComplete \}\)/);
  assert.match(source, /case 'DIRECTIONAL_DISTRIBUTION': return <DirectionalOverview/);
  assert.match(source, /return <>\{resultView\}\{runComplete \? <HumanValidationNextStep onValidateWithPeople=\{onValidateWithPeople\} runComplete \/> : null\}<\/>;/);
  assert.match(source, /const actionLabel = runComplete \? t\('validateWithPeople'\) : t\('seeHumanValidationPlan'\);/);
  assert.match(source, /const boundary = runComplete \? t\('humanResearchDraftBoundary'\) : t\('humanValidationPlanAfterRun'\);/);
  assert.match(source, /<div><dt>\{t\('observedHumanResponses'\)\}<\/dt><dd>\{t\('none'\)\}<\/dd><\/div>/);
});

test('unknown and malformed result contracts fail closed without a fabricated distribution', async () => {
  const source = await workspaceSource();
  assert.match(source, /const isValidFivePointDistribution =/);
  assert.match(source, /const isValidMethodResult = \(methodResult\) =>/);
  assert.match(source, /if \(methodResult && !isValidMethodResult\(methodResult\)\) return <ResultContractError \/>;/);
  assert.match(source, /default: return <ResultContractError \/>;/);
  assert.match(source, /resultContractErrorTitle/);
  assert.doesNotMatch(source, /\[0, 0, 100, 0, 0\]/);
});

test('synthetic rationale, bidirectional content, and status announcements are explicit', async () => {
  const source = await workspaceSource();
  assert.match(source, /className="synthetic-rationale synthetic-verbatim"/);
  assert.match(source, /className="synthetic-rationale-label">\{t\('modelGeneratedPerspective'\)\}<\/span><p><bdi dir="auto">\{response\.quote\}/);
  assert.doesNotMatch(source, /response\.disclosure \|\| t\('modelGeneratedPerspective'\)/);
  assert.doesNotMatch(source, /“\{response\.quote\}”/);
  assert.ok((source.match(/<bdi dir="auto">/g) || []).length >= 12);
  assert.match(source, /<span aria-live="polite" className="sr-only">\{copied \? t\('copied'\) : ''\}<\/span>/);
  assert.match(source, /t\('opensInNewWindow'\)/);
});

test('source-language metadata is applied to dynamic evidence text', async () => {
  const source = await workspaceSource();
  assert.match(source, /const htmlLanguageTag = \(value\) =>/);
  assert.match(source, /<OutboundLink href=\{entry\.sourceUrl\} lang=\{htmlLanguageTag\(entry\.originalLanguage\)\}>/);
  assert.match(source, /<bdi dir="auto" lang=\{htmlLanguageTag\(entry\.originalLanguage\)\}>\{entry\.excerpt\}<\/bdi>/);
  assert.match(source, /<OutboundLink href=\{source\.sourceUrl\} lang=\{htmlLanguageTag\(source\.originalLanguage\)\}>/);
  assert.match(source, /<bdi dir="auto" lang=\{htmlLanguageTag\(source\.originalLanguage\)\}>\{source\.excerpt\}<\/bdi>/);
  assert.match(source, /<OutboundLink href=\{source\.url\} lang=\{source\.title \? htmlLanguageTag\(source\.originalLanguage\) : undefined\}>/);
});

test('method audit details remain present in intentional groups', async () => {
  const source = await workspaceSource();
  assert.match(source, /className="audit-details" aria-labelledby="audit-details-title"/);
  assert.match(source, /className="audit-details-trace"/);
  assert.match(source, /className="audit-details-boundaries"/);
  assert.match(source, /t\('humanResearchDraftBoundary'\)/);
  assert.match(source, /resolveInputHashLineage\(\{/);
  assert.match(source, /inputHashLineage\.version \? <small><bdi dir="auto">\{inputHashLineage\.version\}<\/bdi><\/small>/);
});

test('localized population counts use the locale plural rules in the rendered product', async () => {
  const source = await workspaceSource();
  assert.match(source, /localizedPluralCategory\(frame\.knownIntersections\.length, locale\)/);
  assert.match(source, /'intersectionRecordOne' : 'intersectionRecords'/);
});

test('human-research handoff renders method-specific question items and localized planning statuses', async () => {
  const source = await workspaceSource();
  assert.match(source, /RANK_ORDER: 'statusRankOrder'/);
  assert.match(source, /MATRIX_SINGLE_SELECT: 'statusMatrixSingleSelect'/);
  assert.match(source, /RESEARCHER_DESIGN_REQUIRED: 'statusResearcherDesignRequired'/);
  assert.match(source, /Array\.isArray\(question\.items\)/);
  assert.match(source, /className="handoff-question-items"/);
  assert.match(source, /const ItemList = question\.type === 'RANK_ORDER' \? 'ol' : 'ul';/);
  assert.match(source, /item\?\.itemId \|\| item\?\.id/);
  assert.match(source, /<HumanResearchQuestionItems language=\{handoff\.questionnaire\?\.language\} priceContext=\{priceContext\} question=\{question\} \/>/);
  assert.match(source, /localizedStatus\(handoff\.samplePlan\?\.status, t\)/);
  assert.match(source, /recommendationKind\) === 'POINT_REFERENCE'/);
  assert.match(source, /nominalFullSampleReference/);
  assert.match(source, /const sampleRecommendationKeys = Object\.freeze\(\{/);
  assert.match(source, /NOMINAL_FULL_SAMPLE_PROPORTION_REFERENCE_ONLY: 'sampleRecommendationNominalReference'/);
  assert.match(source, /PLAN_PURPOSIVE_GUIDE_PILOT_AND_STOPPING_RULE: 'sampleRecommendationGuidePilot'/);
  assert.match(source, /category\.referenceShare \?\? category\.targetShare/);
  assert.match(source, /'Brand familiarity, none\/not-sure handling, and neutral matrix order': 'missingBrandMatrixDesign'/);
  assert.match(source, /'Price exposure, branching, allocation, and presentation-order plan': 'missingPriceExposureDesign'/);
  assert.match(source, /'Observed task protocol if usability validation is intended': 'missingObservedTaskProtocol'/);
});

test('human-research handoff renders every authored stimulus with localized labels and safe language semantics', async () => {
  const source = await workspaceSource();
  assert.match(source, /const stimuli = Array\.isArray\(handoff\.questionnaire\?\.stimuli\)/);
  assert.match(source, /const stimulusLanguage = htmlLanguageTag\(handoff\.questionnaire\?\.language\);/);
  assert.match(source, /className="handoff-stimuli" aria-labelledby="handoff-stimuli-title"/);
  assert.match(source, /stimuli\.map\(\(stimulus\) =>/);
  assert.match(source, /t\('stimuliForReview'\)/);
  assert.match(source, /t\('stimulusIdentifier'\)/);
  assert.match(source, /t\('stimulusType'\)/);
  assert.match(source, /<bdi dir="ltr">\{stimulus\.stimulusId\}<\/bdi>/);
  assert.match(source, /<bdi dir="ltr">\{stimulus\.type\}<\/bdi>/);
  assert.match(source, /<bdi dir="auto" lang=\{stimulusLanguage\}>\{respondentStimulusText\(stimulus\)\}<\/bdi>/);
});

test('blocked handoffs show localized explanations with isolated technical references', async () => {
  const [source, styles] = await Promise.all([workspaceSource(), workspaceStyles()]);
  for (const code of [
    'UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION',
    'REPORT_INSTRUMENT_LOCALE_MISMATCH_REQUIRES_TRANSLATION_REVIEW',
    'GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD',
    'PRIMARY_ITEM_OUTPUT_LOCALE_SCRIPT_MISMATCH',
    'METHOD_CONFIG_REQUIRED_FOR_HANDOFF',
    'METHOD_SPECIFIC_HANDOFF_TEMPLATE_MISSING',
    'RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH',
  ]) assert.match(source, new RegExp(`${code}: 'handoffBlocker`));
  assert.match(source, /localizedHandoffBlockingIssue\(issue, t\)/);
  assert.match(source, /<span>\{t\('technicalReference'\)\}:<\/span> <code><bdi dir="ltr">\{issue\}<\/bdi><\/code>/);
  assert.match(source, /className="handoff-blocker-list"/);
  assert.doesNotMatch(source, /blockingIssues\.map\(\(issue\) => <li key=\{issue\}>\{localizedStatus\(issue, t\)\}/);
  assert.match(styles, /\.handoff-blocker-list li \{ overflow-wrap: anywhere; \}/);
  assert.match(styles, /\.handoff-blocker-list small \{[^}]*font-size: \.75rem;[^}]*line-height: 1\.4;/);
});

test('handoff prices use structured currency data and retain accessible language and ID semantics', async () => {
  const [source, styles] = await Promise.all([workspaceSource(), workspaceStyles()]);
  assert.match(source, /return formatLocalizedCurrency\(price\.amount, price\.currency, locale\);/);
  assert.match(source, /const structuredPrice = Number\.isFinite\(item\?\.amount\) \? \{ \.\.\.priceContext, \.\.\.item \} : item;/);
  assert.match(source, /const priceStimulus = stimuli\.find\(\(stimulus\) => stimulus\?\.type === 'PRICE_LADDER_OFFER' && stimulus\.currency\);/);
  assert.match(source, /<bdi dir="auto" lang=\{itemLanguage\}>\{itemText\}<\/bdi>/);
  assert.match(source, /<code><bdi dir="ltr">\{itemId\}<\/bdi><\/code>/);
  assert.match(source, /const rawPriceLine = `\$\{stimulus\.price\.amount\} \$\{stimulus\.price\.currency\} \$\{stimulus\.price\.unit\}`\.trim\(\);/);
  assert.match(styles, /\.handoff-questionnaire small \{[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.handoff-questionnaire \.handoff-price-unit \{[^}]*font-size: \.75rem;/);
});

test('CJK browser journeys require each authored handoff needle to be visible in the handoff DOM', async () => {
  const source = await browserVerifierSource();
  assert.match(source, /assert\.doesNotMatch\(text, \/\\\[SINGLE_SELECT\\\]\//);
  assert.match(source, /Technical type ID\|类型技术 ID\|種別の技術 ID\|유형 기술 ID/);
  assert.match(source, /const authoredNeedle = handoffNeedleFor\(methodConfigFixture\(fixture, methodId\)\);/);
  assert.match(source, /methodId === 'INTERVIEW_GUIDE'[\s\S]*handoff\.locator\('\.handoff-stimuli'\)/);
  assert.match(source, /authoredHandoffSurface\.locator\('bdi'\)\.filter\(\{ hasText: authoredNeedle \}\)\.first\(\)/);
  assert.match(source, /await assertVisible\(authoredHandoffCopy, `\$\{label\} \$\{methodId\} authored handoff content`\);/);
  assert.match(source, /handoff\.locator\('\.handoff-stimuli bdi'\)\.filter\(\{ hasText: authoredNeedle \}\)\.first\(\)/);
  assert.equal((source.match(/handoff DOM preserves the exact authored content/g) || []).length, 2);
});

test('human-research handoff is method-aware for estimands, recruitment, and qualitative coverage', async () => {
  const source = await workspaceSource();
  for (const mapping of [
    "FULL_RANK_ORDER: 'statFullRankOrder'",
    "FIRST_RANK_COUNT: 'statFirstRankCount'",
    "MEAN_RANK: 'statMeanRank'",
    "ATTRIBUTE_BRAND_SELECTION_MATRIX: 'statAttributeBrandSelectionMatrix'",
    "FULL_DISTRIBUTION_BY_PRICE_POINT: 'statFullDistributionByPricePoint'",
    "TOP_TWO_BOX_BY_PRICE_POINT: 'statTopTwoBoxByPricePoint'",
    "QUESTION_COMPREHENSION_ISSUES: 'statQuestionComprehensionIssues'",
    "REVISION_THEMES: 'statRevisionThemes'",
    "GUIDE_PILOT_FEEDBACK: 'statGuidePilotFeedback'",
    "REVISION_NEEDS: 'statRevisionNeeds'",
    "TOPIC_THEMATIC_SUMMARY: 'statTopicThematicSummary'",
    "TOPIC_COVERAGE: 'statTopicCoverage'",
    "PARTICIPANT_DISPOSITIONS: 'reportingParticipantDispositions'",
    "EXCLUSIONS: 'reportingExclusions'",
    "BREAKOFF: 'reportingBreakoff'",
    "UNWEIGHTED_BASES: 'reportingUnweightedBases'",
    "WEIGHTED_BASES_IF_APPLICABLE: 'reportingWeightedBasesIfApplicable'",
    "TOP_TWO_BOX_WITH_BASES: 'reportingTopTwoBoxWithBases'",
    "OBSERVED_INCIDENCE: 'reportingObservedIncidence'",
    "FULL_RANK_ORDERS: 'reportingFullRankOrders'",
    "FIRST_RANK_COUNTS: 'reportingFirstRankCounts'",
    "MEAN_RANKS: 'reportingMeanRanks'",
    "BRAND_FAMILIARITY_BASES: 'reportingBrandFamiliarityBases'",
    "FULL_DISTRIBUTIONS_BY_PRICE_POINT: 'reportingFullDistributionsByPricePoint'",
    "TOP_TWO_BOX_BY_PRICE_POINT_WITH_BASES: 'reportingTopTwoBoxByPricePointWithBases'",
    "FORCED_CHOICE_LIMITATION: 'reportingForcedChoiceLimitation'",
    "PRESENTATION_ORDER_LIMITATION: 'reportingPresentationOrderLimitation'",
    "PRICE_EXPOSURE_ORDER: 'reportingPriceExposureOrder'",
    "PARTICIPANT_CHARACTERISTICS: 'reportingParticipantCharacteristics'",
    "RESPONSE_MAPPING_ISSUES: 'reportingResponseMappingIssues'",
    "ITERATION_HISTORY: 'reportingIterationHistory'",
    "TOPIC_THEMATIC_SUMMARIES: 'reportingTopicThematicSummaries'",
    "NEGATIVE_OR_DISCONFIRMING_CASES: 'reportingNegativeOrDisconfirmingCases'",
    "STOPPING_RULE: 'reportingStoppingRule'",
    "GUIDE_PILOT_FEEDBACK: 'reportingGuidePilotFeedback'",
    "QUESTION_SEQUENCE_ISSUES: 'reportingQuestionSequenceIssues'",
    "SENSITIVE_TOPIC_HANDLING: 'reportingSensitiveTopicHandling'",
    "REVISION_LOG: 'reportingRevisionLog'",
  ]) assert.ok(source.includes(mapping), `missing status localization mapping: ${mapping}`);
  assert.match(source, /SURVEY_FIELDING: \[/);
  assert.match(source, /COGNITIVE_PRETEST: \[/);
  assert.match(source, /QUALITATIVE_INTERVIEWS: \[/);
  assert.match(source, /recruitmentInstructionSet/);
  assert.match(source, /const recruitmentInstructionKeys = recruitmentInstructionKeysBySet\[recruitmentInstructionSet\] \|\| null;/);
  assert.match(source, /const recruitmentContractValid = Array\.isArray\(recruitmentInstructionKeys\);/);
  assert.match(source, /handoffInstructionContractError/);
  assert.match(source, /Boolean\(exporting\) \|\| !recruitmentContractValid/);
  assert.doesNotMatch(source, /defaultRecruitmentInstructionKeys/);
  assert.match(source, /quotaStatus === 'NOT_APPLICABLE'/);
  assert.match(source, /qualitativePurposiveCoverage/);
  assert.match(source, /coverageDimensions\.flatMap/);
  assert.match(source, /<table>/);
  assert.match(source, /scope="col"/);
});
