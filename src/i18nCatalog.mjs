import {
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
} from './lib/localizationUiCatalog.js';
import { CJK_LOCALE_IDS, LOCALE_CAPABILITIES } from '../shared/localization.mjs';

export {
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
};

const en = {
  free: 'Free to use · no account required', ad: 'Advertisement', adReserved: 'Reserved ad inventory',
  hero: 'Free synthetic data for market research', subhero: 'Generate synthetic outputs for concept tests, audience hypotheses, messages, pricing, and research planning—free, with no account required.',
  question: 'Research question', audience: 'Audience', audiencePlaceholder: 'e.g. Remote knowledge workers · Ages 25–54', market: 'Market', global: 'Global', localizationReadiness: 'Localization readiness: {copyStatus} · native review: {nativeReviewStatus}', copyStatusMachineDrafted: 'machine-drafted', copyStatusNativeReviewed: 'native-language reviewed', nativeReviewPending: 'review-pending',
  reportLanguage: 'Report language', sourceLanguage: 'Source language', anyLanguage: 'Any language', units: 'Simulation units', notPeople: 'not surveyed people',
  sources: 'Evidence sources', optionalUrls: 'optional public URLs', addSource: 'Add source', removeSource: 'Remove source', run: 'Run grounded study', running: 'Running research agents…',
  assumptions: 'Assumptions', assumptionsLabel: 'Assumptions the models may use', assumptionsNote: 'Unsupported assumptions are labeled in the evidence ledger.',
  readySources: 'Ready with {sources} supplied source(s) and {assumptions} assumption(s).',
  autoEvidence: 'Likerts will run two bounded web searches through Vercel AI Gateway and disclose retrieved sources. If retrieval fails, the run is labeled prior-only.',
  progress: 'Research run progress', frame: 'Frame', search: 'Search', simulate: 'Simulate', review: 'Review', complete: 'Complete', fallback: 'Fallback used', inProgress: 'In progress', queued: 'Queued', runLabel: 'Run', notStarted: 'not started', copyRun: 'Copy run ID',
  overview: 'Overview', segments: 'Segments', verbatims: 'Verbatims', evidence: 'Evidence', population: 'Population', method: 'Method', export: 'Export evidence pack', replay: 'Replay',
  likely: 'likely', unlikely: 'unlikely', unsure: 'unsure', hypothesis: 'Treat this as a hypothesis to test, not a market estimate.', suggest: 'What the models suggest', changeRead: 'What would change this read',
  ledger: 'Research ledger', coverage: 'Evidence coverage', populationFit: 'Population fit', independentReview: 'Pipeline critic review', inspectEvidence: 'Inspect evidence', marketLabel: 'Market', outputLabel: 'Report',
  directional: 'Directional synthetic estimate — not observed human evidence.', methodological: 'methodological confidence',
  newStudy: 'New study', editBrief: 'Edit brief', editBriefNote: 'Adjust the question, audience, market, or assumptions.', closeBrief: 'Close brief', completed: 'Completed', illustrativePreview: 'Illustrative preview', currentSources: 'Sources', noExternalSources: 'No external sources', independentlyReviewed: 'Reviewed by pipeline critic', reviewNotRun: 'Pipeline critic not run', runId: 'Run ID', reportTab: 'Report', topLineFinding: 'Top-line finding', syntheticDisclosure: 'Synthetic estimates are model-generated, not observed survey results.', executiveInterpretation: 'Executive interpretation', appearsDrive: 'What appears to drive the result', couldChange: 'What could change it', modelInference: 'Model inference', humanValidation: 'Human validation', knownLimitation: 'Known limitation', hypothesisNext: 'Next hypothesis to test', segmentsTitle: 'Segment read', segmentsNote: 'Directional differences across modeled segments; not population measurements.', segmentLabel: 'Segment', directionalDistribution: 'Directional distribution', modelConstructedSegment: 'Model-constructed segment · no sampled n', syntheticVerbatims: 'Synthetic verbatims', possibleReasoning: 'Possible reasoning', verbatimNote: 'Illustrative model-generated language', notInterviewNote: 'These are not interview transcripts or participant quotes.', evidenceLedger: 'Evidence ledger', traceClaimBasis: 'Trace each claim to its basis', evidenceLedgerNote: 'Review sources, assumptions, model inferences, and validation status.', claimOrSource: 'Claim or source', evidenceClassLabel: 'Evidence class', traceLabel: 'Trace', riskLabel: 'Risk', reviewRequired: 'Review required', methodologyLineage: 'Methodology lineage', auditableReplay: 'Auditable replay', replayNote: 'Re-run this study with the recorded inputs and versions.', generatedAt: 'Generated at', promptVersion: 'Prompt version', schemaVersion: 'Schema version', normalizationLabel: 'Normalization', normalizationNotApplicable: 'Not applicable to this result kind.', normalizationPercentSum: 'Percentages are normalized to sum to 100.', evidenceHash: 'Evidence hash', inputHash: 'Input hash', noEvidenceHash: 'No evidence hash', noInputHash: 'No input hash', knownLimits: 'Known limits', limitationWebSourcesUntrusted: 'Web sources are untrusted retrieved text, not independent validation.', limitationNoExternalEvidence: 'No externally acquired source evidence was used.', limitationSyntheticPanel: 'The simulated panel is not a human sample.', limitationMethodResult: 'This method result is model-generated and is not a human study.', limitationNoObservedHuman: 'No observed human responses are included.', limitationSegmentsModelGenerated: 'Segments and verbatims are model-generated hypotheses.', noLineage: 'Lineage not recorded', evidenceAtGlance: 'Evidence at a glance', sourcesCurrent: 'Source date provided', noSourcesNote: 'No external sources were supplied or retrieved.', sourceLanguageLabel: 'Source language', publicWebSource: 'Public web source', modelLineage: 'Model lineage', statusNotRecorded: 'Status not recorded', runDetails: 'Run details', evidenceMode: 'Evidence mode', saved: 'Saved', durable: 'Durable', local: 'Local', session: 'Session', evidenceFooter: 'Synthetic analysis for directional use; validate with human research before decisions.', evidencePackExportType: 'Likerts evidence pack',
  populationFrame: 'Population frame', populationFrameMissing: 'This legacy result does not include a population frame.', populationFrameNote: 'Shows exactly which population constraints were available before simulation and which characteristics remain unsupported.', intendedPopulation: 'Intended population', geography: 'Geography', notSupplied: 'Not supplied', coverageDate: 'Coverage date', weightingMethod: 'Weighting method', officialDatasets: 'Official source datasets', noOfficialDatasets: 'No official population dataset was supplied or matched.', marginalDistributions: 'Marginal distributions', noMarginals: 'No demographic or firmographic marginals were available.', knownIntersections: 'Known intersections', intersectionRecordOne: 'documented intersection', intersectionRecords: 'documented intersections', noIntersections: 'No population intersections were available.', fitComponents: 'Population fit components', unsupportedCharacteristics: 'Unsupported characteristics', noneRecorded: 'None recorded', modelCard: 'Model card', modelCardMissing: 'Model-card provenance was not recorded for this legacy result.', cardVersion: 'Card version', purpose: 'Purpose', permittedUse: 'Permitted use', populationGrounding: 'Population grounding', attitudinalValidation: 'Attitudinal validation', populationFrameHash: 'Population frame hash', prohibitedUses: 'Prohibited uses', modelGeneratedPerspective: 'Model-generated perspective—not a participant quotation.', evidenceClaimSourceNumber: 'Source {count}', methodSpecificModelOutput: 'Method-specific model output', finalLikertDistribution: 'Final five-point Likert distribution', audienceSegmentDifferences: 'Differences between audience segments', responseScoreReasons: 'Reasons behind the response scores',
  repeatRunStability: 'Multiple-run stability', repeatRunNote: 'Compare repeated executions of the same versioned brief. This measures variation, not truth.', repeatRunComparison: 'Repeat-run comparison', completedRuns: 'Comparable runs', comparisonStatus: 'Comparison status', variationLabel: 'Variation classification', lowVariation: 'Low variation', materialVariation: 'Material variation', notAssessed: 'Not assessed', evidenceSensitivity: 'Evidence sensitivity', evidenceChanged: 'Evidence changed across runs', evidenceStable: 'Evidence hash unchanged', maxCategorySpread: 'Maximum category spread', topTwoBoxSpread: 'Top-two-box spread', pairwiseJsd: 'Mean pairwise JSD', thresholds: 'Published thresholds', runDistributions: 'Recorded run distributions', replayForStability: 'Replay this study to create a repeat-run comparison.', withinRunStability: 'Within-run model-cell stability', modelCells: 'model cells', modelCount: '{count} models',
  researchMethod: 'Research method', conceptIntentTest: 'Concept intent test', conceptIntentTestDescription: 'Monadic concept exposure with a five-point directional intent read.', generalLikertLegacy: 'General directional Likert (legacy)', generalLikertLegacyDescription: 'Legacy-compatible directional exploration; choose Concept intent test for a method-specific design.', conceptStimulus: 'Concept stimulus', required: 'required', researchDesign: 'Research design', researchDesignMissing: 'This legacy result has no method-specific research design.', primaryOutcome: 'Primary outcome', estimand: 'Estimand', chartPlan: 'Chart plan', instrument: 'Instrument', includedQuestions: 'Included questions', requiredInputs: 'Required inputs', criticCriteria: 'Critic criteria', humanValidationPlan: 'Human validation plan', humanValidationRequired: 'Human validation required', recommendedHumanMethod: 'Recommended human method', methodDisclosure: 'Model-generated direction—not a human measurement.', methodQuestionPurpose: 'Question purpose is defined by the {method} template.', methodCriticSummary: 'Checks method fidelity, evidence alignment, unsupported claims, and human-validation boundaries.', methodHumanValidationSummary: 'Validate this model-generated {method} output with matched human research.', methodHumanValidationRationale: 'Model-generated output does not establish observed human evidence.', methodHumanValidationChecks: 'Before decisions, verify comprehension, research-design fit, and observed human outcomes.', templateVersion: 'Template version',
  messageTest: 'Message test', messageTestDescription: 'Test one message and intended action with a five-point directional reaction.',
  claimsTest: 'Claims test', claimsTestDescription: 'Review one exact claim for directional credibility and comprehension risk—not truth certification.',
  uxExpectationTest: 'UX expectation test', uxExpectationTestDescription: 'Explore expected ease for one task scenario; this is not observed usability.',
  featurePrioritization: 'Feature prioritization', featurePrioritizationDescription: 'Create a directional ordinal ranking of three to eight supplied features.',
  brandPositioning: 'Brand positioning', brandPositioningDescription: 'Compare supplied brands across supplied association attributes.',
  priceSensitivity: 'Price sensitivity', priceSensitivityDescription: 'Compare stated-intent distributions across three to eight ascending supplied prices.',
  surveyPretest: 'Survey pretest', surveyPretestDescription: 'Review supplied survey questions for wording, coverage, and cognitive-testing risks.',
  interviewGuide: 'Interview guide', interviewGuideDescription: 'Draft neutral prompts and probes mapped to supplied research topics.',
  humanValidationGeneralLikert: 'Sampled survey preceded by cognitive pretesting',
  humanValidationConceptTest: 'Monadic concept survey with cognitive interviews',
  humanValidationPurchaseIntent: 'Sampled purchase-intent survey with category eligibility and recent-behaviour screening',
  humanValidationMessageTest: 'Monadic message test with comprehension checks',
  humanValidationClaimsTest: 'Human claim-comprehension and credibility test with legal review',
  humanValidationUxExpectation: 'Human moderated task test or prototype usability study',
  humanValidationFeaturePrioritization: 'Human MaxDiff, forced-rank, or conjoint study',
  humanValidationBrandPositioning: 'Blinded human brand-association tracker',
  humanValidationPriceSensitivity: 'Randomized Gabor-Granger or choice study with real participants',
  humanValidationSurveyPretest: 'Cognitive interviews and researcher review',
  humanValidationInterviewGuide: 'Researcher review and human interview piloting',
  messageStimulus: 'Message stimulus', intendedAction: 'Intended action', exposureContext: 'Exposure context', claimStimulus: 'Claim stimulus', claimStatus: 'Claim status', claimStatusNotSupplied: 'Not supplied', claimStatusUnverified: 'Unverified', claimStatusDeclared: 'User-declared substantiated',
  taskScenario: 'Task scenario', userGoal: 'User goal', experienceDescription: 'Experience description', experienceContext: 'Experience context', device: 'Device',
  features: 'Features', feature: 'Feature', addFeature: 'Add feature', decisionContext: 'Decision context', selectionConstraint: 'Selection constraint', stableFeatureIds: 'Three to eight features with stable IDs',
  focalBrand: 'Focal brand', comparatorBrands: 'Comparator brands', comparatorBrand: 'Comparator brand', addComparator: 'Add comparator', attributes: 'Attributes', attribute: 'Attribute', addAttribute: 'Add attribute', comparatorBrandRange: 'Two to five comparator brands', suppliedAttributeRange: 'Three to six supplied attributes',
  ascendingPricePoints: 'Ascending price points', pricePoint: 'Price point', addPricePoint: 'Add price point', ascendingPricePointRange: 'Three to eight ascending price points',
  studyObjective: 'Study objective', targetPopulation: 'Target population', surveyQuestions: 'Survey questions', surveyQuestion: 'Survey question', addSurveyQuestion: 'Add survey question', surveyQuestionsStableReferences: 'Survey questions with stable references',
  researchObjective: 'Research objective', participantContext: 'Participant context', interviewTopics: 'Interview topics', topic: 'Topic', addTopic: 'Add topic', sensitiveAreas: 'Sensitive areas', sensitiveArea: 'Sensitive area', addSensitiveArea: 'Add sensitive area', removeItem: 'Remove item', stableTopicIds: 'Two to eight topics with stable IDs',
  rankedItems: 'Directional priority order', attributeMatrix: 'Brand association matrix', brand: 'Brand', associationLOW: 'Low', associationMEDIUM: 'Medium', associationHIGH: 'High', associationLevelForAttribute: '{level} association with {attribute}', priceLadder: 'Price ladder', positiveIntent: 'positive intent',
  instrumentIssues: 'Instrument review issues', severityLOW: 'Low', severityMEDIUM: 'Medium', severityHIGH: 'High', revisionSuggestion: 'Suggested revision', noInstrumentIssues: 'No issues were returned. This does not validate the instrument.', coverageGaps: 'Coverage gaps', cognitiveProbes: 'Suggested cognitive probes',
  opening: 'Opening', guideQuestions: 'Guide questions', probes: 'Probes', moderatorNotes: 'Moderator notes', consentAccessibility: 'Consent and accessibility', closing: 'Closing',
  notAtAllCompelling: 'Not at all compelling', slightlyCompelling: 'Slightly compelling', neitherCompelling: 'Neither compelling nor unconvincing', compelling: 'Compelling', veryCompelling: 'Very compelling',
  notAtAllBelievable: 'Not at all believable', slightlyBelievable: 'Slightly believable', neitherBelievable: 'Neither believable nor unbelievable', believable: 'Believable', veryBelievable: 'Very believable',
  veryDifficult: 'Very difficult', difficult: 'Difficult', neitherDifficultNorEasy: 'Neither difficult nor easy', easy: 'Easy', veryEasy: 'Very easy',
  probablyOrDefinitelyWould: 'Probably or definitely would', compellingOrVeryCompelling: 'Compelling or very compelling', believableOrVeryBelievable: 'Believable or very believable', easyOrVeryEasy: 'Easy or very easy', resultContractErrorTitle: 'This result cannot be displayed', resultContractErrorBody: 'The result data does not match a supported versioned contract. Re-run the study; do not interpret this state as a research finding.',
  exploreModeledSegment: 'Explore modeled segment', exploreSegment: 'Explore this segment', syntheticSegmentExploration: 'Synthetic segment exploration', followUpSegment: 'Follow up with this modeled segment', modeledSegmentNote: 'Model-constructed segment—not a sampled group. Context is retained for up to six model-generated turns in this local session.', yourQuestion: 'Your question', evidenceAndAssumptions: 'Evidence and assumptions used', assumptionsUsed: 'Assumptions used', noPerspectiveEvidence: 'No source evidence influenced this answer.', noAssumptionsRecorded: 'No explicit assumptions influenced this answer.', clientSuppliedContextNote: 'The stateless endpoint checks internal consistency but does not independently authenticate the client-supplied run context.', generatingPerspective: 'Generating perspective…', perspectiveReady: 'Model-generated perspective ready.', perspectiveModes: 'Exploration modes', testObjection: 'Test an objection', exploreCounterfactual: 'Explore a counterfactual', compareConcepts: 'Compare two concepts', changedCondition: 'What changes', fixedConditions: 'What stays fixed', defaultFixedConditions: 'Audience, market, population frame, and all unmentioned study conditions.', conceptA: 'Concept A', conceptB: 'Concept B', askFollowUp: 'Ask a follow-up question', followUpPlaceholder: 'Ask what might drive, block, or change this modeled perspective…', perspectiveError: 'The modeled segment perspective could not be generated.', retry: 'Retry', sendQuestion: 'Generate perspective', objectionStarter: 'What is the strongest objection to this idea, and what might reduce it?', counterfactualStarter: 'How might this modeled perspective change under the specified counterfactual?', comparisonStarter: 'How might this modeled segment react differently to these two concepts, and why?',
  localProject: 'Local project', localProjectTitle: 'Durable qualitative project', localProjectNote: 'Save segment follow-up context locally in this browser so modeled interviews survive reloads, export cleanly, and remain separate from observed human research.', localProjectDisclosure: 'Local browser data; not encrypted account storage.', localProjectPending: 'Preparing local storage', localProjectReady: '{turns} saved turn pair(s) across {conversations} segment thread(s)', localProjectUnsupported: 'This browser does not expose durable local project storage. Segment follow-ups will remain session-only.', localProjectError: 'The local qualitative project could not be updated. Try again. Reference: {code}', savedConversations: 'Saved segment threads', savedTurnPairs: 'Saved turn pairs', savedMaterials: 'Saved materials', exportLocalProject: 'Export local project', importLocalProject: 'Import local project', clearLocalProject: 'Clear local project',
  addResearchMaterial: 'Add your research materials', researchMaterialPrivacy: 'Extraction happens locally. Only bounded excerpts are sent with the run and may remain in its local record; raw file bytes are never saved.', researchMaterialRawText: 'Up to four text files or documents can be added. Text files must be below 400 KB; documents must be below 5 MB.', researchDocumentExtractionNote: 'PDFs are limited to 50 pages and XLSX files to 20 sheets. Extraction reads text and cell values only—not formulas, macros, links, or embedded objects. All material remains unverified grounding.', researchMaterialLimit: 'Add up to four research materials.', pastedResearchExcerpt: 'Pasted research excerpt', chooseResearchFiles: 'Choose files or documents', researchFileLimits: 'txt, md, csv, json < 400 KB · PDF, DOCX, XLSX < 5 MB · PDF ≤ 50 pages · XLSX ≤ 20 sheets', pasteResearchExcerpt: 'Or paste an excerpt', addExcerpt: 'Add excerpt', readingResearchMaterial: 'Reading research material…', noResearchMaterial: 'No research materials added.', characters: 'characters', pastedMaterial: 'Pasted text', uploadedText: 'Uploaded text', extractedDocument: 'Extracted document', documentLocators: '{count} source location(s)', excerptTruncated: 'Excerpt bounded', removeResearchMaterial: 'Remove research material', providedResearchMaterial: 'Provided research material', researchMaterials: 'Research materials', clientReportedHash: 'Client-reported content hash', uploadedMaterialTrace: 'Provided material → bounded excerpt → evidence packet', uploadedMaterialRisk: 'Unverified context—not human validation',
  validateWithPeople: 'Validate with real people', humanResearchDraft: 'Human-research handoff', questionnaireForReview: 'Questionnaire for review', stimuliForReview: 'Stimuli for review', stimulusIdentifier: 'Stimulus ID', stimulusType: 'Stimulus type', technicalReference: 'Technical reference', handoffBlockerUnsupportedLocale: 'The selected questionnaire language needs a human translation before fielding.', handoffBlockerLocaleMismatch: 'The report and questionnaire languages must match or receive a documented translation review.', handoffBlockerSpecializedMethodRequired: 'Choose a specialized research method before creating a fieldable questionnaire.', handoffBlockerPrimaryScriptMismatch: 'The primary question does not match the selected questionnaire language.', handoffBlockerMethodConfigRequired: 'Complete the selected method setup before creating a fieldable questionnaire.', handoffBlockerTemplateMissing: 'A human-research questionnaire template is not available for this method.', handoffBlockerRespondentCopyMismatch: 'Some respondent-facing text does not match the selected questionnaire language.', handoffBlockerUnknown: 'This questionnaire needs researcher review before it can be fielded.', questionItems: 'Items to review', rankOrderItems: 'Items to rank', matrixRows: 'Matrix rows', screeningCriteria: 'Screening criteria', quotasAndIncidence: 'Quotas and incidence', coverageDimensions: 'Coverage dimensions', coverageVariable: 'Variable', coverageCategory: 'Category', coverageSourceShare: 'Source share', qualitativePurposiveCoverage: 'Qualitative purposive coverage applies; quotas and weighting are not applicable. Recruit across the documented coverage dimensions and use a predeclared information-power or stopping rule.', recruitmentInstructions: 'Recruitment instructions', analysisPlan: 'Analysis plan', planningRecommendation: 'Planning recommendation', noDefensibleQuota: 'No defensible quota targets are available until denominators match the screened population.', incidenceNotEstimated: 'Incidence is not estimated from synthetic results.', noPanelBooked: 'No participant panel is booked or connected.', downloadCsvSpec: 'Download CSV specification', downloadXlsxSpec: 'Download XLSX workbook', downloadResearchBrief: 'Download research brief', downloadHandoffReceipt: 'Download lineage receipt', providerOptions: 'Provider options', outboundProviderNote: 'External links only—not integrations or endorsements. Confirm feasibility, price, timing, availability, and terms directly.', handoffExportError: 'The human-research draft could not be exported.', handoffStatus: 'Draft status', recommendedCompletes: 'Recommended completes', monitorOnlyTargets: 'Monitor-only targets', blockingIssues: 'Blocking issues', missingFields: 'Missing before fielding', observedHumanResponses: 'Observed human responses', none: 'None', openHumanDraft: 'Open human-research draft', closeHumanDraft: 'Close human-research draft', missingMethodSampleDesign: 'Method-specific sample-size or qualitative stopping-rule design',
  nominalFullSampleReference: 'Nominal full-sample reference', samplePlanStatus: 'Sample planning status', sampleRecommendationConfigureMethod: 'Choose and configure a supported research method before sizing.', sampleRecommendationNominalReference: 'Nominal full-sample proportion reference only; recalculate for the actual recruitment and analysis design.', sampleRecommendationExpectationReference: 'Expected-ease survey reference only; size observed usability testing separately.', sampleRecommendationRankDesign: 'Freeze the rank or choice design before calculating a sample target.', sampleRecommendationBrandDesign: 'Freeze the brand matrix and familiarity rules before calculating a sample target.', sampleRecommendationPriceDesign: 'Freeze the price-exposure and branching design before calculating a sample target.', sampleRecommendationCognitiveRounds: 'Plan iterative cognitive-pretest rounds and document the stopping rule.', sampleRecommendationGuidePilot: 'Plan purposive guide piloting and document the stopping rule.', missingBrandMatrixDesign: 'Brand familiarity, none/not-sure handling, and neutral matrix order', missingPriceExposureDesign: 'Price exposure, branching, allocation, and presentation-order plan', missingObservedTaskProtocol: 'Observed task protocol if usability validation is intended',
  recruitmentInstructionCognitivePretestScope: 'Review each question for comprehension, recall burden, sensitivity, and response-process risk with the priority participant variations.', recruitmentInstructionCognitivePretestRounds: 'Run iterative cognitive-interview rounds and revise the instrument between rounds.', recruitmentInstructionCognitivePretestDocument: 'Document observed interpretation problems, revisions, unresolved risks, and the predeclared stopping rule.', recruitmentInstructionQualitativeSampling: 'Recruit purposively across the documented participant variations; do not treat synthetic segments as recruitable identities.', recruitmentInstructionQualitativeGuide: 'Pilot the neutral topic guide, probes, consent language, accessibility, and moderator protocol before full interviewing.', recruitmentInstructionQualitativeStopping: 'Record information-power judgments, disconfirming cases, analytic coverage, and the stopping rule before closing recruitment.',
  recruitmentInstructionCognitiveReview: 'Have a human researcher review the cognitive-interview protocol and every supplied survey item.', recruitmentInstructionCognitiveSeparate: 'Keep cognitive-pretest feedback separate from substantive survey findings.', recruitmentInstructionQualitativeReview: 'Have a human researcher review and pilot the interview guide before substantive fieldwork.', recruitmentInstructionQualitativeSeparate: 'Do not analyze guide-pilot answers as substantive participant findings.',
  handoffInstructionContractError: 'Recruitment instructions are unavailable because this handoff uses an unsupported instruction-set contract. Regenerate it before export or fielding.',
  statFullRankOrder: 'Full rank order', statFirstRankCount: 'First-rank count', statMeanRank: 'Mean rank', statAttributeBrandSelectionMatrix: 'Attribute-by-brand selection matrix', statFullDistributionByPricePoint: 'Full distribution by price point', statTopTwoBoxByPricePoint: 'Top-two-box by price point', statQuestionComprehensionIssues: 'Question-comprehension issues', statRevisionThemes: 'Revision themes', statGuidePilotFeedback: 'Guide-pilot feedback', statTopicThematicSummary: 'Topic thematic summary', statTopicCoverage: 'Topic coverage', statRevisionNeeds: 'Revision needs', reportingParticipantDispositions: 'Participant dispositions', reportingExclusions: 'Exclusions', reportingBreakoff: 'Breakoff', reportingUnweightedBases: 'Unweighted bases', reportingWeightedBasesIfApplicable: 'Weighted bases, if applicable', reportingFullDistributions: 'Full distributions', reportingTopTwoBoxWithBases: 'Top-two-box with bases', reportingObservedIncidence: 'Observed incidence', reportingFullRankOrders: 'Full rank orders', reportingFirstRankCounts: 'First-rank counts', reportingMeanRanks: 'Mean ranks', reportingAttributeBrandSelectionMatrix: 'Attribute-by-brand selection matrix', reportingForcedChoiceLimitation: 'Forced-choice limitation', reportingBrandFamiliarityBases: 'Brand-familiarity bases', reportingFullDistributionsByPricePoint: 'Full distributions by price point', reportingTopTwoBoxByPricePointWithBases: 'Top-two-box by price point with bases', reportingPresentationOrderLimitation: 'Presentation-order limitation', reportingPriceExposureOrder: 'Price-exposure order', reportingParticipantCharacteristics: 'Participant characteristics', reportingQuestionComprehensionIssues: 'Question-comprehension issues', reportingResponseMappingIssues: 'Response-mapping issues', reportingRevisionThemes: 'Revision themes', reportingIterationHistory: 'Iteration history', reportingTopicThematicSummaries: 'Topic thematic summaries', reportingTopicCoverage: 'Topic coverage', reportingNegativeOrDisconfirmingCases: 'Negative or disconfirming cases', reportingStoppingRule: 'Stopping rule', reportingQuestionSequenceIssues: 'Question-sequence issues', reportingSensitiveTopicHandling: 'Sensitive-topic handling', reportingRevisionLog: 'Revision log', reportingGuidePilotFeedback: 'Guide-pilot feedback',
  brandHome: 'Likerts home', researchMaterialBoundary: 'Your research materials are unverified grounding—not human validation.', researchMaterialReadError: 'Could not add {file}. Check that it matches the supported type and size limits.', researchMaterialPasteError: 'Could not add the pasted research excerpt.', publishedThresholdSummary: '≤ {category} pp category · ≤ {topTwoBox} pp top-two-box', percentagePointsShort: '{value} percentage points', stabilityJsd: 'JSD {value}', repeatRunDisclaimer: 'Repeat-run convergence measures model-output variation, not accuracy, representativeness, or agreement with real people.', stageNumber: 'Stage {number}', statusCode: 'Status code: {status}',
  populationFitFormula: 'The score combines geography coverage, marginal coverage, intersection coverage, source quality, source recency, and weighting quality using the published weights.', populationFrameDisclaimer: 'Demographic fit does not prove attitudinal accuracy. Synthetic results remain model-generated hypotheses until validated with real people.', geographyCoverageComponent: 'Geography coverage', marginalCoverageComponent: 'Marginal coverage', intersectionCoverageComponent: 'Intersection coverage', sourceQualityComponent: 'Source quality', sourceRecencyComponent: 'Source recency', weightingQualityComponent: 'Weighting quality', unsupportedStructuredPopulation: 'Demographic and firmographic characteristics were not supplied as structured population data.',
  modelCardPurposeDirectional: 'Directional synthetic research for hypothesis generation and research planning.', modelCardPurposeMethod: 'Model-generated research-method output for hypothesis generation and research planning.', modelCardPermittedDirectional: 'Explore model-generated directional patterns, assumptions, objections, and questions for subsequent human research.', modelCardPermittedMethod: 'Explore model-generated method-specific drafts, rankings, comparisons, assumptions, and questions for subsequent human research.', prohibitedPopulationEstimation: 'Population estimation', prohibitedObservedAttitudes: 'Claims of observed attitudes', prohibitedSyntheticConfidenceIntervals: 'Synthetic confidence intervals', prohibitedConsequentialSubstitution: 'Substitution for consequential human research', modelCardDisclosure: 'Attitudinal accuracy is not validated. Demographic grounding does not make model-generated responses representative of real people.',
  statusNotApplied: 'Not applied', statusNotApplicable: 'Not applicable', statusInvalidInput: 'Invalid input', statusConverged: 'Converged', statusMeasured: 'Measured', statusPartial: 'Partial', statusCuratedOfficial: 'Curated official source', statusUserDeclaredOfficial: 'User-declared official source', statusUnverified: 'Unverified', statusContextOnly: 'Context only', statusNotValidated: 'Not validated', statusBlockedRequiresRevision: 'Blocked—questionnaire revision required', statusFieldDraftRequiresReview: 'Field draft—review required', statusBlocked: 'Blocked', statusReadyForResearcherReview: 'Ready for researcher review', statusSingleSelect: 'Single select', statusRankOrder: 'Rank order', statusMatrixSingleSelect: 'Matrix single select', statusOpenText: 'Open text', statusStimulus: 'Stimulus', statusInstruction: 'Instruction', statusMethodTemplate: 'Method template', statusUserInput: 'User input', statusModelFraming: 'Model framing', statusDraft: 'Draft', statusRequiresResearcherOperationalization: 'Researcher operationalization required', statusResearcherDesignRequired: 'Researcher design required', statusTargetsUnavailable: 'Targets unavailable', statusPlanningEstimate: 'Planning estimate', statusUnestimated: 'Not estimated', statusMonitorOnly: 'Monitor only', statusPopulationReferenceOnly: 'Population reference only', statusFullDistribution: 'Full distribution', statusTopTwoBox: 'Top-two-box', statusInsufficientRuns: 'Insufficient runs', statusNotComparable: 'Not comparable', statusComparable: 'Comparable', statusNone: 'None', statusRakingIpf: 'Raking (IPF)', statusPostStratification: 'Post-stratification',
  consentRequired: 'Participation requires informed consent.', recruitmentInstructionReview: 'Have a human researcher review and cognitively pretest the instrument.', recruitmentInstructionEthics: 'Complete applicable ethics, privacy, consent, accessibility, and data-protection review.', recruitmentInstructionProviders: 'Ask providers for feasibility using the exact screener and population-reference dimensions; do not share synthetic segment labels as recruitable identities.', recruitmentInstructionSoftLaunch: 'Run a small soft launch before full fielding.', recruitmentInstructionFreezeRules: 'Freeze duplicate, speeding, straight-lining, open-text quality, exclusion, and weighting rules before inspecting substantive outcomes.', recruitmentInstructionMonitor: 'Monitor incidence, recruitment progress, breakoff, exclusions, and respondent compensation.', missingHumanTranslation: 'Human translation and locale review', missingQuotaTargets: 'Defensible achieved-sample quota targets', missingIncidence: 'Observed or provider-quoted incidence', missingSurveyDuration: 'Survey duration after cognitive pretest', missingProviderFeasibility: 'Provider feasibility, price, and timing', missingSubgroupPower: 'Preregistered subgroup power requirements', missingApprovals: 'Ethics, privacy, and jurisdictional approval status',
  localizationSettings: 'Localization settings', localizationSettingsNote: 'Set each localization dimension separately. Enabled copy remains machine-drafted and awaits native review.', marketLocalizationNote: 'Sets geography for population framing and retrieval; it does not choose a language.', reportLanguageNote: 'Controls the report and model-output language.', sourceLanguageNote: 'Controls source-language filtering; it does not change the report language.', retrievalLanguage: 'Retrieval language', retrievalLanguageNote: 'Choose how strongly retrieval should use the selected source language.', retrievalPolicy: 'Retrieval policy', retrievalAny: 'Any language', retrievalPrefer: 'Prefer selected language', retrievalRequire: 'Require provider language metadata + script check', retrievalLocaleRequired: 'Select a source language before requiring it.', instrumentLanguage: 'Instrument language', instrumentLanguageNote: 'Controls respondent-facing draft language; human translation review remains required.', interfaceLanguageNote: 'Controls interface copy only.', localizationDimensionsIndependent: 'Interface, report, source and retrieval, and instrument languages are independent.',
  localizationConfigurationError: 'Localization settings need attention ({code}).', studyRunError: 'The study could not complete. Review the settings and try again. Reference: {code}', unsupportedLocaleSelection: 'Unsupported saved locale: {locales}. Choose an enabled locale before running.', reportInstrumentMismatch: 'Report and instrument differ; human translation review is required.', retrievalRequireWarning: 'A run fails unless provider-declared primary-language metadata matches and the excerpt passes the registered-script check. This is not language identification.', sourceLanguageFilter: 'Source-language filter', sourceLanguageFilterNote: 'Limits retrieval by source language according to the selected policy.', sourceLanguagesNone: 'No source-language filter', selectedLocaleCount: '{count} selected', addOrRemoveLanguages: 'Select up to four languages.', sameAsReport: 'Same as report', useSeparateInstrumentLanguage: 'Use a separate language', useInterfaceForStudy: 'Use interface language for report and instrument', evidenceModePriorOnly: 'Prior-only evidence', evidenceModeGateway: 'Gateway-retrieved evidence', evidenceModeModelOnly: 'Model-only evidence', statusFailed: 'Failed', statusRunning: 'Running', statusPending: 'Pending',
};

const reportUiTranslations = {
  'es-ES': {
    newStudy: 'Nuevo estudio', editBrief: 'Editar resumen', editBriefNote: 'Ajusta la pregunta, la audiencia, el mercado o los supuestos.', closeBrief: 'Cerrar resumen', completed: 'Completado', illustrativePreview: 'Vista previa ilustrativa', currentSources: 'Fuentes actuales', noExternalSources: 'Sin fuentes externas', independentlyReviewed: 'Revisado de forma independiente', reviewNotRun: 'No se ejecutó la revisión independiente', runId: 'ID de ejecución', reportTab: 'Informe', topLineFinding: 'Hallazgo principal', syntheticDisclosure: 'Las estimaciones sintéticas son generadas por modelos, no resultados de encuestas observadas.', executiveInterpretation: 'Interpretación ejecutiva', appearsDrive: 'Qué parece impulsar el resultado', couldChange: 'Qué podría cambiarlo', modelInference: 'Inferencia del modelo', humanValidation: 'Validación humana', knownLimitation: 'Limitación conocida', hypothesisNext: 'Siguiente hipótesis que probar', segmentsTitle: 'Lectura por segmentos', segmentsNote: 'Diferencias direccionales entre segmentos modelados; no son mediciones poblacionales.', segmentLabel: 'Segmento', directionalDistribution: 'Distribución direccional', syntheticVerbatims: 'Respuestas sintéticas', possibleReasoning: 'Posible razonamiento', verbatimNote: 'Lenguaje ilustrativo generado por modelos', notInterviewNote: 'No son transcripciones de entrevistas ni citas de participantes.', evidenceLedger: 'Registro de evidencia', traceClaimBasis: 'Rastrea cada afirmación hasta su base', evidenceLedgerNote: 'Revisa las fuentes, los supuestos, las inferencias del modelo y el estado de validación.', claimOrSource: 'Afirmación o fuente', evidenceClassLabel: 'Clase de evidencia', traceLabel: 'Rastreo', riskLabel: 'Riesgo', reviewRequired: 'Revisión necesaria', methodologyLineage: 'Trazabilidad metodológica', auditableReplay: 'Repetición auditable', replayNote: 'Repite este estudio con las entradas y versiones registradas.', generatedAt: 'Generado el', promptVersion: 'Versión del prompt', schemaVersion: 'Versión del esquema', normalizationLabel: 'Normalización', evidenceHash: 'Hash de evidencia', inputHash: 'Hash de entrada', noEvidenceHash: 'Sin hash de evidencia', noInputHash: 'Sin hash de entrada', knownLimits: 'Límites conocidos', noLineage: 'Trazabilidad no registrada', evidenceAtGlance: 'Evidencia de un vistazo', sourcesCurrent: 'Las fuentes están actualizadas', noSourcesNote: 'No se proporcionaron ni recuperaron fuentes externas.', sourceLanguageLabel: 'Idioma de las fuentes', publicWebSource: 'Fuente web pública', modelLineage: 'Trazabilidad del modelo', statusNotRecorded: 'Estado no registrado', runDetails: 'Detalles de la ejecución', evidenceMode: 'Modo de evidencia', saved: 'Guardado', durable: 'Persistente', local: 'Local', session: 'Sesión', evidenceFooter: 'Análisis sintético de uso direccional; valida con investigación humana antes de decidir.',
  },
  'pt-BR': {
    newStudy: 'Novo estudo', editBrief: 'Editar briefing', editBriefNote: 'Ajuste a pergunta, o público, o mercado ou as premissas.', closeBrief: 'Fechar briefing', completed: 'Concluído', illustrativePreview: 'Prévia ilustrativa', currentSources: 'Fontes atuais', noExternalSources: 'Sem fontes externas', independentlyReviewed: 'Revisado de forma independente', reviewNotRun: 'A revisão independente não foi executada', runId: 'ID da execução', reportTab: 'Relatório', topLineFinding: 'Principal descoberta', syntheticDisclosure: 'As estimativas sintéticas são geradas por modelos, não resultados de pesquisas observados.', executiveInterpretation: 'Interpretação executiva', appearsDrive: 'O que parece impulsionar o resultado', couldChange: 'O que poderia mudá-lo', modelInference: 'Inferência do modelo', humanValidation: 'Validação humana', knownLimitation: 'Limitação conhecida', hypothesisNext: 'Próxima hipótese a testar', segmentsTitle: 'Leitura por segmento', segmentsNote: 'Diferenças direcionais entre segmentos modelados; não são medições populacionais.', segmentLabel: 'Segmento', directionalDistribution: 'Distribuição direcional', syntheticVerbatims: 'Respostas sintéticas', possibleReasoning: 'Possível raciocínio', verbatimNote: 'Linguagem ilustrativa gerada por modelos', notInterviewNote: 'Não são transcrições de entrevistas nem citações de participantes.', evidenceLedger: 'Registro de evidências', traceClaimBasis: 'Rastreie cada afirmação até sua base', evidenceLedgerNote: 'Revise fontes, premissas, inferências do modelo e status de validação.', claimOrSource: 'Afirmação ou fonte', evidenceClassLabel: 'Classe de evidência', traceLabel: 'Rastreio', riskLabel: 'Risco', reviewRequired: 'Revisão necessária', methodologyLineage: 'Linhas de método', auditableReplay: 'Reexecução auditável', replayNote: 'Execute novamente este estudo com as entradas e versões registradas.', generatedAt: 'Gerado em', promptVersion: 'Versão do prompt', schemaVersion: 'Versão do esquema', normalizationLabel: 'Normalização', evidenceHash: 'Hash da evidência', inputHash: 'Hash da entrada', noEvidenceHash: 'Sem hash da evidência', noInputHash: 'Sem hash da entrada', knownLimits: 'Limites conhecidos', noLineage: 'Linhas não registradas', evidenceAtGlance: 'Evidências em resumo', sourcesCurrent: 'As fontes estão atuais', noSourcesNote: 'Nenhuma fonte externa foi fornecida ou recuperada.', sourceLanguageLabel: 'Idioma das fontes', publicWebSource: 'Fonte pública da web', modelLineage: 'Linhas do modelo', statusNotRecorded: 'Status não registrado', runDetails: 'Detalhes da execução', evidenceMode: 'Modo de evidência', saved: 'Salvo', durable: 'Persistente', local: 'Local', session: 'Sessão', evidenceFooter: 'Análise sintética para uso direcional; valide com pesquisa humana antes de decidir.',
  },
  'fr-FR': {
    newStudy: 'Nouvelle étude', editBrief: 'Modifier le brief', editBriefNote: 'Ajustez la question, l’audience, le marché ou les hypothèses.', closeBrief: 'Fermer le brief', completed: 'Terminé', illustrativePreview: 'Aperçu illustratif', currentSources: 'Sources actuelles', noExternalSources: 'Aucune source externe', independentlyReviewed: 'Revu indépendamment', reviewNotRun: 'Revue indépendante non effectuée', runId: 'ID de l’exécution', reportTab: 'Rapport', topLineFinding: 'Résultat clé', syntheticDisclosure: 'Les estimations synthétiques sont générées par des modèles, et non issues de réponses observées.', executiveInterpretation: 'Interprétation pour dirigeants', appearsDrive: 'Ce qui semble expliquer le résultat', couldChange: 'Ce qui pourrait le changer', modelInference: 'Inférence du modèle', humanValidation: 'Validation humaine', knownLimitation: 'Limite connue', hypothesisNext: 'Prochaine hypothèse à tester', segmentsTitle: 'Lecture par segment', segmentsNote: 'Différences directionnelles entre segments modélisés ; ce ne sont pas des mesures de population.', segmentLabel: 'Segment', directionalDistribution: 'Distribution directionnelle', syntheticVerbatims: 'Verbatims synthétiques', possibleReasoning: 'Raisonnement possible', verbatimNote: 'Formulation illustrative générée par les modèles', notInterviewNote: 'Il ne s’agit ni de transcriptions d’entretiens ni de citations de participants.', evidenceLedger: 'Registre des preuves', traceClaimBasis: 'Relier chaque affirmation à son fondement', evidenceLedgerNote: 'Examinez les sources, hypothèses, inférences du modèle et l’état de validation.', claimOrSource: 'Affirmation ou source', evidenceClassLabel: 'Classe de preuve', traceLabel: 'Traçabilité', riskLabel: 'Risque', reviewRequired: 'Revue requise', methodologyLineage: 'Traçabilité méthodologique', auditableReplay: 'Rejeu auditable', replayNote: 'Relancez cette étude avec les entrées et versions enregistrées.', generatedAt: 'Généré le', promptVersion: 'Version du prompt', schemaVersion: 'Version du schéma', normalizationLabel: 'Normalisation', evidenceHash: 'Hash des preuves', inputHash: 'Hash des entrées', noEvidenceHash: 'Aucun hash de preuve', noInputHash: 'Aucun hash d’entrée', knownLimits: 'Limites connues', noLineage: 'Traçabilité non enregistrée', evidenceAtGlance: 'Les preuves en un coup d’œil', sourcesCurrent: 'Les sources sont actuelles', noSourcesNote: 'Aucune source externe n’a été fournie ou récupérée.', sourceLanguageLabel: 'Langue des sources', publicWebSource: 'Source web publique', modelLineage: 'Traçabilité du modèle', statusNotRecorded: 'Statut non enregistré', runDetails: 'Détails de l’exécution', evidenceMode: 'Mode de preuve', saved: 'Enregistré', durable: 'Durable', local: 'Local', session: 'Session', evidenceFooter: 'Analyse synthétique à usage directionnel ; validez par une recherche humaine avant toute décision.',
  },
  'de-DE': {
    newStudy: 'Neue Studie', editBrief: 'Brief bearbeiten', editBriefNote: 'Frage, Zielgruppe, Markt oder Annahmen anpassen.', closeBrief: 'Brief schließen', completed: 'Abgeschlossen', illustrativePreview: 'Illustrative Vorschau', currentSources: 'Aktuelle Quellen', noExternalSources: 'Keine externen Quellen', independentlyReviewed: 'Unabhängig geprüft', reviewNotRun: 'Unabhängige Prüfung nicht durchgeführt', runId: 'Lauf-ID', reportTab: 'Bericht', topLineFinding: 'Kernergebnis', syntheticDisclosure: 'Synthetische Schätzungen werden von Modellen erzeugt und sind keine beobachteten Umfrageergebnisse.', executiveInterpretation: 'Zusammenfassung für Führungskräfte', appearsDrive: 'Was das Ergebnis offenbar antreibt', couldChange: 'Was es ändern könnte', modelInference: 'Model Schlussfolgerung', humanValidation: 'Menschliche Validierung', knownLimitation: 'Bekannte Einschränkung', hypothesisNext: 'Nächste zu prüfende Hypothese', segmentsTitle: 'Segmentauswertung', segmentsNote: 'Richtungsweisende Unterschiede zwischen modellierten Segmenten; keine Messungen der Gesamtbevölkerung.', segmentLabel: 'Segment', directionalDistribution: 'Richtungsverteilung', syntheticVerbatims: 'Synthetische Antworten', possibleReasoning: 'Mögliche Begründung', verbatimNote: 'Illustrative, von Modellen erzeugte Formulierung', notInterviewNote: 'Dies sind weder Interviewtranskripte noch Zitate von Teilnehmenden.', evidenceLedger: 'Evidenzprotokoll', traceClaimBasis: 'Jede Aussage auf ihre Grundlage zurückführen', evidenceLedgerNote: 'Quellen, Annahmen, Modellinferenzen und Validierungsstatus prüfen.', claimOrSource: 'Aussage oder Quelle', evidenceClassLabel: 'Evidenzklasse', traceLabel: 'Nachverfolgung', riskLabel: 'Risiko', reviewRequired: 'Prüfung erforderlich', methodologyLineage: 'Methodische Rückverfolgbarkeit', auditableReplay: 'Nachprüfbare Wiederholung', replayNote: 'Diese Studie mit den aufgezeichneten Eingaben und Versionen erneut ausführen.', generatedAt: 'Erstellt am', promptVersion: 'Prompt-Version', schemaVersion: 'Schema-Version', normalizationLabel: 'Normalisierung', evidenceHash: 'Evidenz-Hash', inputHash: 'Eingabe-Hash', noEvidenceHash: 'Kein Evidenz-Hash', noInputHash: 'Kein Eingabe-Hash', knownLimits: 'Bekannte Grenzen', noLineage: 'Rückverfolgbarkeit nicht aufgezeichnet', evidenceAtGlance: 'Evidenz auf einen Blick', sourcesCurrent: 'Quellen sind aktuell', noSourcesNote: 'Es wurden keine externen Quellen bereitgestellt oder abgerufen.', sourceLanguageLabel: 'Quellsprache', publicWebSource: 'Öffentliche Webquelle', modelLineage: 'Modell-Rückverfolgbarkeit', statusNotRecorded: 'Status nicht aufgezeichnet', runDetails: 'Laufdetails', evidenceMode: 'Evidenzmodus', saved: 'Gespeichert', durable: 'Dauerhaft', local: 'Lokal', session: 'Sitzung', evidenceFooter: 'Synthetische Analyse zur richtungsweisenden Nutzung; vor Entscheidungen durch menschliche Forschung validieren.',
  },
  'zh-CN': {
    newStudy: '新建研究', editBrief: '编辑研究简报', editBriefNote: '调整研究问题、受众、市场或假设。', closeBrief: '关闭简报', completed: '已完成', illustrativePreview: '示意预览', currentSources: '当前来源', noExternalSources: '没有外部来源', independentlyReviewed: '已独立审查', reviewNotRun: '尚未进行独立审查', runId: '运行 ID', reportTab: '报告', topLineFinding: '核心发现', syntheticDisclosure: '合成估计由模型生成，并非观察到的调查结果。', executiveInterpretation: '管理层解读', appearsDrive: '哪些因素似乎推动了结果', couldChange: '哪些因素可能改变结果', modelInference: '模型推断', humanValidation: '人工验证', knownLimitation: '已知局限', hypothesisNext: '下一步要验证的假设', segmentsTitle: '细分人群解读', segmentsNote: '模型细分人群之间的方向性差异，并非总体测量结果。', segmentLabel: '细分人群', directionalDistribution: '方向性分布', syntheticVerbatims: '合成原话', possibleReasoning: '可能的推理', verbatimNote: '模型生成的示意性表述', notInterviewNote: '这些不是访谈记录，也不是参与者引语。', evidenceLedger: '证据账本', traceClaimBasis: '追溯每项结论的依据', evidenceLedgerNote: '查看来源、假设、模型推断和验证状态。', claimOrSource: '结论或来源', evidenceClassLabel: '证据类别', traceLabel: '追溯', riskLabel: '风险', reviewRequired: '需要审查', methodologyLineage: '方法沿革', auditableReplay: '可审计重放', replayNote: '使用记录的输入和版本重新运行本研究。', generatedAt: '生成时间', promptVersion: '提示词版本', schemaVersion: '架构版本', normalizationLabel: '标准化', evidenceHash: '证据哈希', inputHash: '输入哈希', noEvidenceHash: '无证据哈希', noInputHash: '无输入哈希', knownLimits: '已知限制', noLineage: '未记录沿革', evidenceAtGlance: '证据一览', sourcesCurrent: '来源为最新来源', noSourcesNote: '未提供或检索到外部来源。', sourceLanguageLabel: '来源语言', publicWebSource: '公开网页来源', modelLineage: '模型沿革', statusNotRecorded: '未记录状态', runDetails: '运行详情', evidenceMode: '证据模式', saved: '已保存', durable: '持久', local: '本地', session: '会话', evidenceFooter: '用于方向性判断的合成分析；决策前请通过人工研究验证。',
  },
  'ja-JP': {
    newStudy: '新しい調査', editBrief: '概要を編集', editBriefNote: '調査質問、対象者、市場、前提を調整します。', closeBrief: '概要を閉じる', completed: '完了', illustrativePreview: 'イメージプレビュー', currentSources: '現在の情報源', noExternalSources: '外部情報源なし', independentlyReviewed: '独立レビュー済み', reviewNotRun: '独立レビュー未実行', runId: '実行ID', reportTab: 'レポート', topLineFinding: '主要な発見', syntheticDisclosure: '合成推定はモデルが生成したもので、観測された調査結果ではありません。', executiveInterpretation: 'エグゼクティブ向け解釈', appearsDrive: '結果を左右しているように見える要因', couldChange: '結果を変える可能性があるもの', modelInference: 'モデル推論', humanValidation: '人による検証', knownLimitation: '既知の制約', hypothesisNext: '次に検証する仮説', segmentsTitle: 'セグメント別の見方', segmentsNote: 'モデル化したセグメント間の方向性の違いであり、母集団の測定値ではありません。', segmentLabel: 'セグメント', directionalDistribution: '方向性分布', syntheticVerbatims: '合成回答例', possibleReasoning: '考えられる理由', verbatimNote: 'モデルが生成した説明用の表現', notInterviewNote: 'インタビュー記録や参加者の発言ではありません。', evidenceLedger: '証拠台帳', traceClaimBasis: '各主張の根拠を追跡', evidenceLedgerNote: '情報源、前提、モデル推論、検証状況を確認します。', claimOrSource: '主張または情報源', evidenceClassLabel: '証拠区分', traceLabel: '追跡', riskLabel: 'リスク', reviewRequired: 'レビューが必要', methodologyLineage: '方法論の系譜', auditableReplay: '監査可能な再実行', replayNote: '記録された入力とバージョンでこの調査を再実行します。', generatedAt: '生成日時', promptVersion: 'プロンプトバージョン', schemaVersion: 'スキーマバージョン', normalizationLabel: '正規化', evidenceHash: '証拠ハッシュ', inputHash: '入力ハッシュ', noEvidenceHash: '証拠ハッシュなし', noInputHash: '入力ハッシュなし', knownLimits: '既知の限界', noLineage: '系譜未記録', evidenceAtGlance: '証拠の概要', sourcesCurrent: '情報源は最新です', noSourcesNote: '外部情報源は提供・取得されていません。', sourceLanguageLabel: '情報源の言語', publicWebSource: '公開ウェブ情報源', modelLineage: 'モデルの系譜', statusNotRecorded: 'ステータス未記録', runDetails: '実行の詳細', evidenceMode: '証拠モード', saved: '保存済み', durable: '永続', local: 'ローカル', session: 'セッション', evidenceFooter: '方向性の判断に用いる合成分析です。意思決定前に人による調査で検証してください。',
  },
  'ko-KR': {
    newStudy: '새 연구', editBrief: '브리프 편집', editBriefNote: '질문, 대상, 시장 또는 가정을 조정하세요.', closeBrief: '브리프 닫기', completed: '완료됨', illustrativePreview: '예시 미리보기', currentSources: '현재 출처', noExternalSources: '외부 출처 없음', independentlyReviewed: '독립 검토 완료', reviewNotRun: '독립 검토를 실행하지 않음', runId: '실행 ID', reportTab: '보고서', topLineFinding: '핵심 발견', syntheticDisclosure: '합성 추정치는 모델이 생성한 것이며 관찰된 설문 결과가 아닙니다.', executiveInterpretation: '경영진 해석', appearsDrive: '결과를 이끄는 것으로 보이는 요인', couldChange: '결과를 바꿀 수 있는 요인', modelInference: '모델 추론', humanValidation: '사람의 검증', knownLimitation: '알려진 한계', hypothesisNext: '다음에 검증할 가설', segmentsTitle: '세그먼트 해석', segmentsNote: '모델링된 세그먼트 간 방향성 차이이며 모집단 측정값이 아닙니다.', segmentLabel: '세그먼트', directionalDistribution: '방향성 분포', syntheticVerbatims: '합성 응답 예시', possibleReasoning: '가능한 추론', verbatimNote: '모델이 생성한 예시 문구', notInterviewNote: '인터뷰 기록이나 참여자의 인용문이 아닙니다.', evidenceLedger: '근거 원장', traceClaimBasis: '각 주장과 근거 연결', evidenceLedgerNote: '출처, 가정, 모델 추론 및 검증 상태를 확인하세요.', claimOrSource: '주장 또는 출처', evidenceClassLabel: '근거 분류', traceLabel: '추적', riskLabel: '위험', reviewRequired: '검토 필요', methodologyLineage: '방법론 계보', auditableReplay: '감사 가능한 재실행', replayNote: '기록된 입력과 버전으로 이 연구를 다시 실행하세요.', generatedAt: '생성 시각', promptVersion: '프롬프트 버전', schemaVersion: '스키마 버전', normalizationLabel: '정규화', evidenceHash: '근거 해시', inputHash: '입력 해시', noEvidenceHash: '근거 해시 없음', noInputHash: '입력 해시 없음', knownLimits: '알려진 제한', noLineage: '계보가 기록되지 않음', evidenceAtGlance: '한눈에 보는 근거', sourcesCurrent: '출처가 최신임', noSourcesNote: '외부 출처가 제공되거나 검색되지 않았습니다.', sourceLanguageLabel: '출처 언어', publicWebSource: '공개 웹 출처', modelLineage: '모델 계보', statusNotRecorded: '상태가 기록되지 않음', runDetails: '실행 세부 정보', evidenceMode: '근거 모드', saved: '저장됨', durable: '영구', local: '로컬', session: '세션', evidenceFooter: '방향성 판단을 위한 합성 분석입니다. 의사결정 전에 사람의 조사로 검증하세요.',
  },
  'ar-SA': {
    newStudy: 'دراسة جديدة', editBrief: 'تعديل الملخص', editBriefNote: 'عدّل السؤال أو الجمهور أو السوق أو الافتراضات.', closeBrief: 'إغلاق الملخص', completed: 'مكتمل', illustrativePreview: 'معاينة توضيحية', currentSources: 'المصادر الحالية', noExternalSources: 'لا توجد مصادر خارجية', independentlyReviewed: 'تمت مراجعته بشكل مستقل', reviewNotRun: 'لم تُجرَ المراجعة المستقلة', runId: 'معرّف التشغيل', reportTab: 'التقرير', topLineFinding: 'النتيجة الرئيسية', syntheticDisclosure: 'التقديرات التركيبية مولّدة بالنماذج وليست نتائج استطلاع ملحوظة.', executiveInterpretation: 'تفسير تنفيذي', appearsDrive: 'ما يبدو أنه يدفع النتيجة', couldChange: 'ما قد يغيّرها', modelInference: 'استنتاج النموذج', humanValidation: 'تحقق بشري', knownLimitation: 'حد معروف', hypothesisNext: 'الفرضية التالية للاختبار', segmentsTitle: 'قراءة الشرائح', segmentsNote: 'فروق اتجاهية بين الشرائح المُنمذجة؛ وليست قياسات للسكان.', segmentLabel: 'الشريحة', directionalDistribution: 'التوزيع الاتجاهي', syntheticVerbatims: 'إجابات تركيبية', possibleReasoning: 'التفسير المحتمل', verbatimNote: 'صياغة توضيحية مولّدة بالنموذج', notInterviewNote: 'هذه ليست نصوص مقابلات أو اقتباسات من مشاركين.', evidenceLedger: 'سجل الأدلة', traceClaimBasis: 'تتبّع أساس كل ادعاء', evidenceLedgerNote: 'راجع المصادر والافتراضات واستنتاجات النموذج وحالة التحقق.', claimOrSource: 'ادعاء أو مصدر', evidenceClassLabel: 'فئة الدليل', traceLabel: 'التتبّع', riskLabel: 'المخاطر', reviewRequired: 'المراجعة مطلوبة', methodologyLineage: 'تسلسل المنهجية', auditableReplay: 'إعادة تشغيل قابلة للتدقيق', replayNote: 'أعد تشغيل هذه الدراسة بالمدخلات والإصدارات المسجلة.', generatedAt: 'تاريخ الإنشاء', promptVersion: 'إصدار الموجّه', schemaVersion: 'إصدار المخطط', normalizationLabel: 'التطبيع', evidenceHash: 'تجزئة الدليل', inputHash: 'تجزئة الإدخال', noEvidenceHash: 'لا توجد تجزئة للدليل', noInputHash: 'لا توجد تجزئة للإدخال', knownLimits: 'الحدود المعروفة', noLineage: 'لم يُسجّل التسلسل', evidenceAtGlance: 'الأدلة في لمحة', sourcesCurrent: 'المصادر حديثة', noSourcesNote: 'لم تُقدَّم أو تُسترجع مصادر خارجية.', sourceLanguageLabel: 'لغة المصادر', publicWebSource: 'مصدر ويب عام', modelLineage: 'تسلسل النموذج', statusNotRecorded: 'الحالة غير مسجلة', runDetails: 'تفاصيل التشغيل', evidenceMode: 'وضع الأدلة', saved: 'محفوظ', durable: 'دائم', local: 'محلي', session: 'جلسة', evidenceFooter: 'تحليل تركيبي للاستخدام الاتجاهي؛ تحقّق ببحث بشري قبل اتخاذ القرارات.',
  },
  'hi-IN': {
    newStudy: 'नया अध्ययन', editBrief: 'ब्रीफ़ संपादित करें', editBriefNote: 'प्रश्न, ऑडियंस, बाज़ार या मान्यताओं को समायोजित करें।', closeBrief: 'ब्रीफ़ बंद करें', completed: 'पूर्ण', illustrativePreview: 'उदाहरणात्मक पूर्वावलोकन', currentSources: 'वर्तमान स्रोत', noExternalSources: 'कोई बाहरी स्रोत नहीं', independentlyReviewed: 'स्वतंत्र रूप से समीक्षा की गई', reviewNotRun: 'स्वतंत्र समीक्षा नहीं चलाई गई', runId: 'रन ID', reportTab: 'रिपोर्ट', topLineFinding: 'मुख्य निष्कर्ष', syntheticDisclosure: 'सिंथेटिक अनुमान मॉडल द्वारा बनाए गए हैं, देखे गए सर्वेक्षण परिणाम नहीं।', executiveInterpretation: 'कार्यकारी व्याख्या', appearsDrive: 'परिणाम को प्रभावित करने वाले संभावित कारक', couldChange: 'इसे क्या बदल सकता है', modelInference: 'मॉडल अनुमान', humanValidation: 'मानवीय सत्यापन', knownLimitation: 'ज्ञात सीमा', hypothesisNext: 'अगली जाँच योग्य परिकल्पना', segmentsTitle: 'सेगमेंट विश्लेषण', segmentsNote: 'मॉडल किए गए सेगमेंट के बीच दिशात्मक अंतर; जनसंख्या माप नहीं।', segmentLabel: 'सेगमेंट', directionalDistribution: 'दिशात्मक वितरण', syntheticVerbatims: 'सिंथेटिक प्रतिक्रियाएँ', possibleReasoning: 'संभावित तर्क', verbatimNote: 'मॉडल द्वारा बनाया गया उदाहरणात्मक पाठ', notInterviewNote: 'ये साक्षात्कार प्रतिलेख या प्रतिभागियों के उद्धरण नहीं हैं।', evidenceLedger: 'साक्ष्य लेजर', traceClaimBasis: 'हर दावे का आधार देखें', evidenceLedgerNote: 'स्रोतों, मान्यताओं, मॉडल अनुमानों और सत्यापन स्थिति की समीक्षा करें।', claimOrSource: 'दावा या स्रोत', evidenceClassLabel: 'साक्ष्य श्रेणी', traceLabel: 'ट्रेस', riskLabel: 'जोखिम', reviewRequired: 'समीक्षा आवश्यक', methodologyLineage: 'पद्धति वंशावली', auditableReplay: 'ऑडिट योग्य पुनःचलाना', replayNote: 'रिकॉर्ड किए गए इनपुट और संस्करणों के साथ यह अध्ययन फिर चलाएँ।', generatedAt: 'निर्माण समय', promptVersion: 'प्रॉम्प्ट संस्करण', schemaVersion: 'स्कीमा संस्करण', normalizationLabel: 'सामान्यीकरण', evidenceHash: 'साक्ष्य हैश', inputHash: 'इनपुट हैश', noEvidenceHash: 'साक्ष्य हैश नहीं', noInputHash: 'इनपुट हैश नहीं', knownLimits: 'ज्ञात सीमाएँ', noLineage: 'वंशावली दर्ज नहीं', evidenceAtGlance: 'एक नज़र में साक्ष्य', sourcesCurrent: 'स्रोत वर्तमान हैं', noSourcesNote: 'कोई बाहरी स्रोत दिया या प्राप्त नहीं किया गया।', sourceLanguageLabel: 'स्रोत भाषा', publicWebSource: 'सार्वजनिक वेब स्रोत', modelLineage: 'मॉडल वंशावली', statusNotRecorded: 'स्थिति दर्ज नहीं', runDetails: 'रन का विवरण', evidenceMode: 'साक्ष्य मोड', saved: 'सहेजा गया', durable: 'स्थायी', local: 'स्थानीय', session: 'सत्र', evidenceFooter: 'दिशात्मक उपयोग के लिए सिंथेटिक विश्लेषण; निर्णय से पहले मानवीय शोध से सत्यापित करें।',
  },
};

const supplementalKeys = [
  'interfaceLanguage', 'notMeasured', 'modelReview', 'modelReviewed', 'copyRunId', 'copied',
  'howItWorks', 'syntheticResearch', 'methodology', 'limitations', 'examples', 'studies', 'agentDocs',
  'productDocs', 'sourceRecords', 'veryUnlikely', 'notSure', 'veryLikely',
];

const supplementalValues = {
  'en-US': ['Interface language', 'Not measured', 'Model review', 'Model reviewed', 'Copy run ID', 'Copied', 'How it works', 'Synthetic research', 'Methodology', 'Limitations', 'Examples', 'Sample studies', 'Agent docs', 'Product documentation', 'source records', 'Very unlikely', 'Not sure', 'Very likely'],
  'es-ES': ['Idioma de la interfaz', 'No medido', 'Revisión del modelo', 'Revisado por el modelo', 'Copiar ID de ejecución', 'Copiado', 'Cómo funciona', 'Investigación sintética', 'Metodología', 'Limitaciones', 'Ejemplos', 'Estudios de ejemplo', 'Docs para agentes', 'Documentación del producto', 'registros de fuentes', 'Muy improbable', 'No sabe', 'Muy probable'],
  'pt-BR': ['Idioma da interface', 'Não medido', 'Revisão do modelo', 'Revisado pelo modelo', 'Copiar ID da execução', 'Copiado', 'Como funciona', 'Pesquisa sintética', 'Metodologia', 'Limitações', 'Exemplos', 'Estudos de exemplo', 'Docs para agentes', 'Documentação do produto', 'registros de fontes', 'Muito improvável', 'Não sabe', 'Muito provável'],
  'fr-FR': ['Langue de l’interface', 'Non mesuré', 'Revue du modèle', 'Revu par le modèle', 'Copier l’ID d’exécution', 'Copié', 'Fonctionnement', 'Recherche synthétique', 'Méthodologie', 'Limites', 'Exemples', 'Études exemples', 'Docs agents', 'Documentation produit', 'fiches de sources', 'Très improbable', 'Ne sait pas', 'Très probable'],
  'de-DE': ['Oberflächensprache', 'Nicht gemessen', 'Modellprüfung', 'Vom Modell geprüft', 'Lauf-ID kopieren', 'Kopiert', 'So funktioniert es', 'Synthetische Forschung', 'Methodik', 'Einschränkungen', 'Beispiele', 'Beispielstudien', 'Agent-Dokumentation', 'Produktdokumentation', 'Quelleneinträge', 'Sehr unwahrscheinlich', 'Unentschieden', 'Sehr wahrscheinlich'],
  'zh-CN': ['界面语言', '未测量', '模型审查', '已由模型审查', '复制运行 ID', '已复制', '工作原理', '合成研究', '方法论', '局限', '示例', '示例研究', '代理文档', '产品文档', '来源记录', '非常不可能', '不确定', '非常可能'],
  'ja-JP': ['表示言語', '未測定', 'モデルレビュー', 'モデルレビュー済み', '実行 ID をコピー', 'コピーしました', '仕組み', '合成調査', '方法論', '制約', '例', 'サンプル調査', 'エージェント向け資料', '製品ドキュメント', '情報源レコード', 'まったく可能性なし', 'わからない', '非常に可能性あり'],
  'ko-KR': ['인터페이스 언어', '측정 안 됨', '모델 검토', '모델 검토 완료', '실행 ID 복사', '복사됨', '작동 방식', '합성 연구', '방법론', '제한 사항', '예시', '예시 연구', '에이전트 문서', '제품 문서', '출처 기록', '전혀 가능성 없음', '잘 모르겠음', '매우 가능성 있음'],
  'ar-SA': ['لغة الواجهة', 'غير مقاس', 'مراجعة النموذج', 'تمت مراجعة النموذج', 'نسخ معرّف التشغيل', 'تم النسخ', 'كيف يعمل', 'البحث التركيبي', 'المنهجية', 'القيود', 'أمثلة', 'دراسات نموذجية', 'وثائق الوكلاء', 'وثائق المنتج', 'سجلات المصادر', 'غير مرجّح إطلاقًا', 'غير متأكد', 'مرجّح جدًا'],
  'hi-IN': ['इंटरफ़ेस भाषा', 'मापा नहीं गया', 'मॉडल समीक्षा', 'मॉडल द्वारा समीक्षित', 'रन ID कॉपी करें', 'कॉपी किया गया', 'यह कैसे काम करता है', 'सिंथेटिक शोध', 'पद्धति', 'सीमाएँ', 'उदाहरण', 'नमूना अध्ययन', 'एजेंट दस्तावेज़', 'उत्पाद दस्तावेज़', 'स्रोत रिकॉर्ड', 'बिल्कुल असंभावित', 'निश्चित नहीं', 'बहुत संभावित'],
};

const supplementalUiTranslations = Object.fromEntries(
  Object.entries(supplementalValues).map(([locale, values]) => [locale, Object.fromEntries(supplementalKeys.map((key, index) => [key, values[index]]))]),
);

const evidenceKeys = [
  'sourceTrace', 'assumptionTrace', 'distributionTrace', 'segmentTrace', 'verbatimTrace',
  'groundingRisk', 'notRepresentative', 'segmentNotSampled', 'requiresValidation',
];

const evidenceValues = {
  'en-US': ['Source record → evidence packet', 'Study brief → explicit assumption', 'Framing → panel simulation → model review → normalization', 'Audience frame → model-constructed segments', 'Generated explanations → illustrative themes', 'Grounding only; not independent validation', 'Not representative', 'Segments were not sampled', 'Requires validation'],
  'es-ES': ['Registro de fuente → paquete de evidencia', 'Brief del estudio → supuesto explícito', 'Encuadre → simulación del panel → revisión del modelo → normalización', 'Encuadre de audiencia → segmentos construidos por el modelo', 'Explicaciones generadas → temas ilustrativos', 'Solo contextualización; no es validación independiente', 'No representativo', 'Los segmentos no fueron muestreados', 'Requiere validación'],
  'pt-BR': ['Registro de fonte → pacote de evidências', 'Brief do estudo → premissa explícita', 'Enquadramento → simulação do painel → revisão do modelo → normalização', 'Enquadramento do público → segmentos construídos pelo modelo', 'Explicações geradas → temas ilustrativos', 'Apenas contextualização; não é validação independente', 'Não representativo', 'Os segmentos não foram amostrados', 'Requer validação'],
  'fr-FR': ['Fiche de source → dossier de preuves', 'Brief d’étude → hypothèse explicite', 'Cadrage → simulation du panel → revue du modèle → normalisation', 'Cadrage de l’audience → segments construits par le modèle', 'Explications générées → thèmes illustratifs', 'Contexte uniquement ; aucune validation indépendante', 'Non représentatif', 'Les segments n’ont pas été échantillonnés', 'Validation requise'],
  'de-DE': ['Quelleneintrag → Evidenzpaket', 'Studienbrief → explizite Annahme', 'Rahmung → Panel-Simulation → Modellprüfung → Normalisierung', 'Zielgruppenrahmen → modellkonstruierte Segmente', 'Generierte Erklärungen → illustrative Themen', 'Nur Kontext; keine unabhängige Validierung', 'Nicht repräsentativ', 'Segmente wurden nicht beprobt', 'Validierung erforderlich'],
  'zh-CN': ['来源记录 → 证据包', '研究简报 → 明确假设', '框定 → 面板模拟 → 模型审查 → 标准化', '受众框架 → 模型构建的细分', '生成的解释 → 示意主题', '仅作背景依据；不构成独立验证', '不具代表性', '细分并非抽样所得', '需要验证'],
  'ja-JP': ['情報源レコード → 証拠パック', '調査概要 → 明示的な前提', '枠組み → パネルシミュレーション → モデルレビュー → 正規化', '対象者の枠組み → モデル構築セグメント', '生成された説明 → 例示テーマ', '根拠付けのみ。独立した検証ではありません', '代表性はありません', 'セグメントは抽出標本ではありません', '検証が必要'],
  'ko-KR': ['출처 기록 → 근거 패키지', '연구 브리프 → 명시적 가정', '구성 → 패널 시뮬레이션 → 모델 검토 → 정규화', '대상 프레임 → 모델 구성 세그먼트', '생성된 설명 → 예시 주제', '맥락 제공용이며 독립 검증이 아님', '대표성 없음', '세그먼트는 표본 추출되지 않음', '검증 필요'],
  'ar-SA': ['سجل المصدر ← حزمة الأدلة', 'ملخص الدراسة ← افتراض صريح', 'التأطير ← محاكاة اللوحة ← مراجعة النموذج ← التطبيع', 'إطار الجمهور ← شرائح أنشأها النموذج', 'تفسيرات مولّدة ← موضوعات توضيحية', 'للتأسيس فقط؛ وليست تحققًا مستقلًا', 'غير تمثيلي', 'لم تُسحب عينة للشرائح', 'يتطلب التحقق'],
  'hi-IN': ['स्रोत रिकॉर्ड → साक्ष्य पैक', 'अध्ययन ब्रीफ़ → स्पष्ट मान्यता', 'फ़्रेमिंग → पैनल सिमुलेशन → मॉडल समीक्षा → सामान्यीकरण', 'ऑडियंस फ़्रेम → मॉडल-निर्मित सेगमेंट', 'बनाए गए स्पष्टीकरण → उदाहरणात्मक थीम', 'केवल आधार; स्वतंत्र सत्यापन नहीं', 'प्रतिनिधिक नहीं', 'सेगमेंट का नमूना नहीं लिया गया', 'सत्यापन आवश्यक'],
};

const evidenceUiTranslations = Object.fromEntries(
  Object.entries(evidenceValues).map(([locale, values]) => [locale, Object.fromEntries(evidenceKeys.map((key, index) => [key, values[index]]))]),
);

const sampleLineageUiTranslations = Object.freeze({
  'en-US': { sampleLineageTitle: 'Public sample origin', sampleAutomatedQaPassed: 'passed for the static brief contract', sampleAutomatedQaNotRun: 'not recorded', sampleLineageNotice: 'This brief started from a public sample and is editable. No run starts automatically. Automated QA ({automatedQaStatus}) covers only the static sample-brief contract, not this run, generated results, or observed/human validation. Native-language review is {nativeReviewStatus}; it applies to sample copy, not the run.' },
  'es-ES': { sampleLineageTitle: 'Origen de la muestra pública', sampleAutomatedQaPassed: 'superado para el contrato del resumen estático', sampleAutomatedQaNotRun: 'sin registrar', sampleLineageNotice: 'Este resumen partió de una muestra pública y se puede editar. No se inicia ninguna ejecución automáticamente. El control de calidad automatizado ({automatedQaStatus}) cubre solo el contrato del resumen estático, no esta ejecución, los resultados generados ni la validación observada o humana. La revisión por hablante nativo está {nativeReviewStatus}; se aplica al texto de la muestra, no a la ejecución.' },
  'pt-BR': { sampleLineageTitle: 'Origem da amostra pública', sampleAutomatedQaPassed: 'aprovado para o contrato do briefing estático', sampleAutomatedQaNotRun: 'não registrado', sampleLineageNotice: 'Este briefing começou com uma amostra pública e pode ser editado. Nenhuma execução começa automaticamente. A garantia de qualidade automatizada ({automatedQaStatus}) cobre somente o contrato do briefing estático, não esta execução, resultados gerados ou validação observada/humana. A revisão por falante nativo está {nativeReviewStatus}; ela se aplica ao texto da amostra, não à execução.' },
  'fr-FR': { sampleLineageTitle: 'Origine de l’exemple public', sampleAutomatedQaPassed: 'réussie pour le contrat du brief statique', sampleAutomatedQaNotRun: 'non enregistrée', sampleLineageNotice: 'Ce brief a démarré à partir d’un exemple public et peut être modifié. Aucun lancement ne démarre automatiquement. L’assurance qualité automatisée ({automatedQaStatus}) couvre uniquement le contrat du brief statique, pas cette exécution, les résultats générés ni une validation observée ou humaine. La revue par un locuteur natif est {nativeReviewStatus} ; elle concerne le texte de l’exemple, pas l’exécution.' },
  'de-DE': { sampleLineageTitle: 'Herkunft der öffentlichen Beispielstudie', sampleAutomatedQaPassed: 'für den statischen Brief-Vertrag bestanden', sampleAutomatedQaNotRun: 'nicht erfasst', sampleLineageNotice: 'Dieser Brief begann mit einer öffentlichen Beispielstudie und ist bearbeitbar. Es startet kein Lauf automatisch. Die automatisierte Qualitätssicherung ({automatedQaStatus}) deckt nur den Vertrag des statischen Briefs ab, nicht diesen Lauf, erzeugte Ergebnisse oder beobachtete/menschliche Validierung. Die muttersprachliche Prüfung ist {nativeReviewStatus}; sie gilt für den Beispieltext, nicht für den Lauf.' },
  'zh-CN': { sampleLineageTitle: '公开示例来源', sampleAutomatedQaPassed: '已通过静态简报合同检查', sampleAutomatedQaNotRun: '未记录', sampleLineageNotice: '此简报基于公开示例开始，可继续编辑。不会自动启动运行。自动质量检查（{automatedQaStatus}）仅覆盖静态示例简报合同，不覆盖本次运行、生成结果或观察到的／人工验证。母语审核状态为{nativeReviewStatus}；它只适用于示例文案，不适用于本次运行。' },
  'ja-JP': { sampleLineageTitle: '公開サンプルの由来', sampleAutomatedQaPassed: '静的ブリーフ契約に合格', sampleAutomatedQaNotRun: '記録なし', sampleLineageNotice: 'このブリーフは公開サンプルから始めたもので、編集できます。自動的に実行が開始されることはありません。自動品質確認（{automatedQaStatus}）が対象とするのは静的サンプルのブリーフ契約のみで、この実行、生成結果、観測済み／人による検証は対象外です。ネイティブレビューの状態は{nativeReviewStatus}で、サンプル文言にのみ適用され、実行には適用されません。' },
  'ko-KR': { sampleLineageTitle: '공개 샘플 출처', sampleAutomatedQaPassed: '정적 브리프 계약 통과', sampleAutomatedQaNotRun: '기록되지 않음', sampleLineageNotice: '이 브리프는 공개 샘플에서 시작했으며 편집할 수 있습니다. 실행은 자동으로 시작되지 않습니다. 자동 품질 검사({automatedQaStatus})는 정적 샘플 브리프 계약에만 적용되며, 이번 실행, 생성 결과 또는 관찰된/인적 검증에는 적용되지 않습니다. 원어민 검토 상태는 {nativeReviewStatus}이며 샘플 문구에만 적용되고 실행에는 적용되지 않습니다.' },
  'ar-SA': { sampleLineageTitle: 'مصدر العينة العامة', sampleAutomatedQaPassed: 'اجتاز عقد الملخص الثابت', sampleAutomatedQaNotRun: 'غير مسجل', sampleLineageNotice: 'بدأ هذا الملخص من عينة عامة ويمكنك تعديله. لا تبدأ أي عملية تشغيل تلقائيًا. يغطي فحص الجودة الآلي ({automatedQaStatus}) عقد ملخص العينة الثابت فقط، ولا يغطي هذه العملية أو النتائج المولّدة أو التحقق الملحوظ أو البشري. حالة مراجعة المتحدث الأصلي هي {nativeReviewStatus}؛ وهي تنطبق على نص العينة لا على عملية التشغيل.' },
  'hi-IN': { sampleLineageTitle: 'सार्वजनिक नमूने का स्रोत', sampleAutomatedQaPassed: 'स्थिर ब्रीफ़ अनुबंध के लिए पास', sampleAutomatedQaNotRun: 'दर्ज नहीं', sampleLineageNotice: 'यह ब्रीफ़ एक सार्वजनिक नमूने से शुरू हुआ है और संपादन योग्य है। कोई रन अपने-आप शुरू नहीं होता। स्वचालित गुणवत्ता जांच ({automatedQaStatus}) केवल स्थिर नमूना-ब्रीफ़ अनुबंध को कवर करती है, इस रन, जनरेट किए गए परिणामों या देखे गए/मानवीय सत्यापन को नहीं। मूल-भाषी समीक्षा की स्थिति {nativeReviewStatus} है; यह नमूना कॉपी पर लागू होती है, रन पर नहीं।' },
});

const dictionaries = {
  'en-US': en,
  'es-ES': {
    free: 'Gratis · sin cuenta', ad: 'Publicidad', adReserved: 'Espacio publicitario reservado', hero: 'Crea un estudio sintético defendible', subhero: 'Fundamenta un panel direccional en fuentes actuales, supuestos de población y revisión independiente de modelos.', question: 'Pregunta de investigación', audience: 'Audiencia', audiencePlaceholder: 'p. ej., profesionales remotos · 25–54 años', market: 'Mercado', global: 'Global', reportLanguage: 'Idioma del informe', sourceLanguage: 'Idioma de las fuentes', anyLanguage: 'Cualquier idioma', units: 'Unidades de simulación', notPeople: 'no son personas encuestadas', sources: 'Fuentes de evidencia', optionalUrls: 'URL públicas opcionales', addSource: 'Añadir fuente', removeSource: 'Eliminar fuente', run: 'Ejecutar estudio fundamentado', running: 'Agentes investigando…', assumptions: 'Supuestos', assumptionsLabel: 'Supuestos que pueden usar los modelos', assumptionsNote: 'Los supuestos sin respaldo se identifican en el registro.', readySources: 'Listo con {sources} fuente(s) y {assumptions} supuesto(s).', autoEvidence: 'Likerts hará dos búsquedas web acotadas mediante Vercel AI Gateway y mostrará las fuentes recuperadas.', progress: 'Progreso del estudio', frame: 'Definir', search: 'Buscar', simulate: 'Simular', review: 'Revisar', complete: 'Completo', fallback: 'Se usó respaldo', inProgress: 'En curso', queued: 'En cola', runLabel: 'Ejecución', notStarted: 'sin iniciar', copyRun: 'Copiar ID', overview: 'Resumen', segments: 'Segmentos', verbatims: 'Respuestas', evidence: 'Evidencia', method: 'Método', export: 'Exportar evidencia', replay: 'Repetir', likely: 'probable', unlikely: 'improbable', unsure: 'duda', hypothesis: 'Trátalo como una hipótesis, no como una estimación de mercado.', suggest: 'Lo que sugieren los modelos', changeRead: 'Qué cambiaría esta lectura', ledger: 'Registro de investigación', coverage: 'Cobertura de evidencia', populationFit: 'Ajuste poblacional', independentReview: 'Revisión independiente', inspectEvidence: 'Ver evidencia', marketLabel: 'Mercado', outputLabel: 'Informe', directional: 'Estimación sintética direccional — no es evidencia humana observada.', methodological: 'confianza metodológica',
  },
  'pt-BR': {
    free: 'Grátis · sem conta', ad: 'Publicidade', adReserved: 'Espaço publicitário reservado', hero: 'Crie um estudo sintético defensável', subhero: 'Fundamente um painel direcional em fontes atuais, premissas populacionais e revisão independente de modelos.', question: 'Pergunta de pesquisa', audience: 'Público', audiencePlaceholder: 'ex.: profissionais remotos · 25–54 anos', market: 'Mercado', global: 'Global', reportLanguage: 'Idioma do relatório', sourceLanguage: 'Idioma das fontes', anyLanguage: 'Qualquer idioma', units: 'Unidades de simulação', notPeople: 'não são pessoas pesquisadas', sources: 'Fontes de evidência', optionalUrls: 'URLs públicas opcionais', addSource: 'Adicionar fonte', removeSource: 'Remover fonte', run: 'Executar estudo fundamentado', running: 'Agentes pesquisando…', assumptions: 'Premissas', assumptionsLabel: 'Premissas que os modelos podem usar', assumptionsNote: 'Premissas sem suporte são marcadas no registro.', readySources: 'Pronto com {sources} fonte(s) e {assumptions} premissa(s).', autoEvidence: 'O Likerts fará duas buscas web limitadas pelo Vercel AI Gateway e mostrará as fontes recuperadas.', progress: 'Progresso da pesquisa', frame: 'Definir', search: 'Buscar', simulate: 'Simular', review: 'Revisar', complete: 'Concluído', fallback: 'Fallback usado', inProgress: 'Em andamento', queued: 'Na fila', runLabel: 'Execução', notStarted: 'não iniciada', copyRun: 'Copiar ID', overview: 'Visão geral', segments: 'Segmentos', verbatims: 'Respostas', evidence: 'Evidência', method: 'Método', export: 'Exportar evidências', replay: 'Repetir', likely: 'provável', unlikely: 'improvável', unsure: 'incerto', hypothesis: 'Trate como hipótese a testar, não como estimativa de mercado.', suggest: 'O que os modelos sugerem', changeRead: 'O que mudaria esta leitura', ledger: 'Registro de pesquisa', coverage: 'Cobertura de evidência', populationFit: 'Adequação populacional', independentReview: 'Revisão independente', inspectEvidence: 'Ver evidência', marketLabel: 'Mercado', outputLabel: 'Relatório', directional: 'Estimativa sintética direcional — não é evidência humana observada.', methodological: 'confiança metodológica',
  },
  'fr-FR': {
    free: 'Gratuit · sans compte', ad: 'Publicité', adReserved: 'Emplacement publicitaire réservé', hero: 'Créez une étude synthétique défendable', subhero: 'Fondez un panel directionnel sur des sources actuelles, des hypothèses de population et une revue indépendante des modèles.', question: 'Question de recherche', audience: 'Audience', audiencePlaceholder: 'ex. télétravailleurs qualifiés · 25–54 ans', market: 'Marché', global: 'Monde', reportLanguage: 'Langue du rapport', sourceLanguage: 'Langue des sources', anyLanguage: 'Toutes les langues', units: 'Unités de simulation', notPeople: 'pas des personnes interrogées', sources: 'Sources de preuve', optionalUrls: 'URL publiques facultatives', addSource: 'Ajouter une source', removeSource: 'Supprimer la source', run: 'Lancer l’étude étayée', running: 'Agents de recherche en cours…', assumptions: 'Hypothèses', assumptionsLabel: 'Hypothèses utilisables par les modèles', assumptionsNote: 'Les hypothèses non étayées sont signalées dans le registre.', readySources: 'Prêt avec {sources} source(s) et {assumptions} hypothèse(s).', autoEvidence: 'Likerts effectuera deux recherches web ciblées via Vercel AI Gateway et indiquera chaque source.', progress: 'Progression de l’étude', frame: 'Cadrer', search: 'Chercher', simulate: 'Simuler', review: 'Réviser', complete: 'Terminé', fallback: 'Solution de repli', inProgress: 'En cours', queued: 'En attente', runLabel: 'Exécution', notStarted: 'non démarrée', copyRun: 'Copier l’ID', overview: 'Vue d’ensemble', segments: 'Segments', verbatims: 'Verbatims', evidence: 'Preuves', method: 'Méthode', export: 'Exporter les preuves', replay: 'Relancer', likely: 'probable', unlikely: 'improbable', unsure: 'incertain', hypothesis: 'Traitez ceci comme une hypothèse, pas comme une estimation de marché.', suggest: 'Ce que suggèrent les modèles', changeRead: 'Ce qui changerait cette lecture', ledger: 'Registre de recherche', coverage: 'Couverture des preuves', populationFit: 'Adéquation population', independentReview: 'Revue indépendante', inspectEvidence: 'Voir les preuves', marketLabel: 'Marché', outputLabel: 'Rapport', directional: 'Estimation synthétique directionnelle — aucune preuve humaine observée.', methodological: 'confiance méthodologique',
  },
  'de-DE': {
    free: 'Kostenlos · kein Konto', ad: 'Werbung', adReserved: 'Reservierte Werbefläche', hero: 'Erstelle eine belastbare synthetische Studie', subhero: 'Stütze ein richtungsweisendes Panel auf aktuelle Quellen, Populationsannahmen und unabhängige Modellprüfung.', question: 'Forschungsfrage', audience: 'Zielgruppe', audiencePlaceholder: 'z. B. Remote-Wissensarbeiter · 25–54 Jahre', market: 'Markt', global: 'Global', reportLanguage: 'Berichtssprache', sourceLanguage: 'Quellsprache', anyLanguage: 'Alle Sprachen', units: 'Simulationseinheiten', notPeople: 'keine befragten Personen', sources: 'Evidenzquellen', optionalUrls: 'optionale öffentliche URLs', addSource: 'Quelle hinzufügen', removeSource: 'Quelle entfernen', run: 'Fundierte Studie starten', running: 'Recherche-Agenten arbeiten…', assumptions: 'Annahmen', assumptionsLabel: 'Annahmen für die Modelle', assumptionsNote: 'Unbelegte Annahmen werden im Evidenzprotokoll markiert.', readySources: 'Bereit mit {sources} Quelle(n) und {assumptions} Annahme(n).', autoEvidence: 'Likerts führt zwei begrenzte Websuchen über Vercel AI Gateway aus und legt alle Quellen offen.', progress: 'Studienfortschritt', frame: 'Rahmen', search: 'Suche', simulate: 'Simulation', review: 'Prüfung', complete: 'Fertig', fallback: 'Fallback genutzt', inProgress: 'In Arbeit', queued: 'Wartend', runLabel: 'Lauf', notStarted: 'nicht gestartet', copyRun: 'Lauf-ID kopieren', overview: 'Überblick', segments: 'Segmente', verbatims: 'Antworten', evidence: 'Evidenz', method: 'Methode', export: 'Evidenz exportieren', replay: 'Wiederholen', likely: 'wahrscheinlich', unlikely: 'unwahrscheinlich', unsure: 'unsicher', hypothesis: 'Als zu testende Hypothese behandeln, nicht als Marktschätzung.', suggest: 'Was die Modelle nahelegen', changeRead: 'Was diese Einschätzung ändern würde', ledger: 'Forschungsprotokoll', coverage: 'Evidenzabdeckung', populationFit: 'Populationspassung', independentReview: 'Unabhängige Prüfung', inspectEvidence: 'Evidenz prüfen', marketLabel: 'Markt', outputLabel: 'Bericht', directional: 'Synthetische Richtungsschätzung — keine beobachtete menschliche Evidenz.', methodological: 'methodische Sicherheit',
  },
  'zh-CN': {
    free: '免费使用 · 无需账户', ad: '广告', adReserved: '预留广告位', hero: '构建可辩护的合成研究', subhero: '以当前来源、人口假设和独立模型审查为方向性面板提供依据。', question: '研究问题', audience: '受众', audiencePlaceholder: '例如：远程知识工作者 · 25–54 岁', market: '市场', global: '全球', reportLanguage: '报告语言', sourceLanguage: '来源语言', anyLanguage: '任何语言', units: '模拟单位', notPeople: '并非受访者', sources: '证据来源', optionalUrls: '可选公开网址', addSource: '添加来源', removeSource: '删除来源', run: '运行有依据的研究', running: '研究代理运行中…', assumptions: '假设', assumptionsLabel: '模型可使用的假设', assumptionsNote: '无支持的假设会在证据账本中标注。', readySources: '已准备 {sources} 个来源和 {assumptions} 个假设。', autoEvidence: 'Likerts 将通过 Vercel AI Gateway 运行两次有限网页搜索，并披露检索到的来源。', progress: '研究进度', frame: '定义', search: '搜索', simulate: '模拟', review: '审查', complete: '完成', fallback: '使用回退', inProgress: '进行中', queued: '排队中', runLabel: '运行', notStarted: '未开始', copyRun: '复制运行 ID', overview: '概览', segments: '细分', verbatims: '回答', evidence: '证据', method: '方法', export: '导出证据包', replay: '重放', likely: '可能', unlikely: '不太可能', unsure: '不确定', hypothesis: '请将其视为待验证假设，而不是市场估计。', suggest: '模型给出的提示', changeRead: '什么会改变这一判断', ledger: '研究账本', coverage: '证据覆盖度', populationFit: '人群匹配度', independentReview: '独立审查', inspectEvidence: '查看证据', marketLabel: '市场', outputLabel: '报告', directional: '方向性合成估计——不是观察到的人类证据。', methodological: '方法学置信度',
  },
  'ja-JP': {
    free: '無料 · アカウント不要', ad: '広告', adReserved: '広告枠', hero: '説明可能な合成調査を作成', subhero: '最新の情報源、母集団の前提、独立したモデルレビューに基づく方向性パネル。', question: '調査質問', audience: '対象者', audiencePlaceholder: '例：リモート知識労働者 · 25～54歳', market: '市場', global: 'グローバル', reportLanguage: 'レポート言語', sourceLanguage: '情報源の言語', anyLanguage: 'すべての言語', units: 'シミュレーション単位', notPeople: '実際の回答者ではありません', sources: '証拠情報源', optionalUrls: '任意の公開URL', addSource: '情報源を追加', removeSource: '情報源を削除', run: '根拠付き調査を実行', running: '調査エージェント実行中…', assumptions: '前提', assumptionsLabel: 'モデルが使用できる前提', assumptionsNote: '裏付けのない前提は証拠台帳に表示されます。', readySources: '{sources}件の情報源と{assumptions}件の前提で準備完了。', autoEvidence: 'Likerts は Vercel AI Gateway で限定的なウェブ検索を2回行い、取得元を開示します。', progress: '調査の進捗', frame: '設計', search: '検索', simulate: '模擬', review: 'レビュー', complete: '完了', fallback: '代替を使用', inProgress: '進行中', queued: '待機中', runLabel: '実行', notStarted: '未開始', copyRun: '実行IDをコピー', overview: '概要', segments: 'セグメント', verbatims: '回答例', evidence: '証拠', method: '方法', export: '証拠パックを出力', replay: '再実行', likely: '可能性あり', unlikely: '可能性低い', unsure: '不明', hypothesis: '市場推定ではなく、検証すべき仮説として扱ってください。', suggest: 'モデルの示唆', changeRead: 'この判断を変えるもの', ledger: '調査台帳', coverage: '証拠カバレッジ', populationFit: '母集団適合度', independentReview: '独立レビュー', inspectEvidence: '証拠を見る', marketLabel: '市場', outputLabel: 'レポート', directional: '方向性の合成推定値 — 観察された人間の証拠ではありません。', methodological: '方法論的信頼度',
  },
  'ko-KR': {
    free: '무료 · 계정 불필요', ad: '광고', adReserved: '광고 영역', hero: '방어 가능한 합성 연구 만들기', subhero: '최신 출처, 모집단 가정, 독립 모델 검토를 기반으로 방향성 패널을 구성합니다.', question: '연구 질문', audience: '대상', audiencePlaceholder: '예: 원격 지식 근로자 · 25–54세', market: '시장', global: '글로벌', reportLanguage: '보고서 언어', sourceLanguage: '출처 언어', anyLanguage: '모든 언어', units: '시뮬레이션 단위', notPeople: '실제 설문 응답자 아님', sources: '근거 출처', optionalUrls: '선택적 공개 URL', addSource: '출처 추가', removeSource: '출처 삭제', run: '근거 기반 연구 실행', running: '연구 에이전트 실행 중…', assumptions: '가정', assumptionsLabel: '모델이 사용할 수 있는 가정', assumptionsNote: '근거 없는 가정은 근거 원장에 표시됩니다.', readySources: '출처 {sources}개와 가정 {assumptions}개로 준비됨.', autoEvidence: 'Likerts는 Vercel AI Gateway로 제한된 웹 검색을 두 번 실행하고 검색 출처를 공개합니다.', progress: '연구 진행 상황', frame: '설계', search: '검색', simulate: '시뮬레이션', review: '검토', complete: '완료', fallback: '대체 사용', inProgress: '진행 중', queued: '대기 중', runLabel: '실행', notStarted: '시작 전', copyRun: '실행 ID 복사', overview: '개요', segments: '세그먼트', verbatims: '응답 예시', evidence: '근거', method: '방법', export: '근거 팩 내보내기', replay: '다시 실행', likely: '가능성 있음', unlikely: '가능성 낮음', unsure: '불확실', hypothesis: '시장 추정치가 아니라 검증할 가설로 다루세요.', suggest: '모델이 제안하는 것', changeRead: '이 해석을 바꿀 요인', ledger: '연구 원장', coverage: '근거 범위', populationFit: '모집단 적합도', independentReview: '독립 검토', inspectEvidence: '근거 확인', marketLabel: '시장', outputLabel: '보고서', directional: '방향성 합성 추정치 — 관찰된 인간 근거가 아닙니다.', methodological: '방법론적 신뢰도',
  },
  'ar-SA': {
    free: 'مجاني · بلا حساب', ad: 'إعلان', adReserved: 'مساحة إعلانية محجوزة', hero: 'أنشئ دراسة تركيبية قابلة للدفاع', subhero: 'أسّس لوحة اتجاهية على مصادر حديثة وافتراضات سكانية ومراجعة مستقلة للنماذج.', question: 'سؤال البحث', audience: 'الجمهور', audiencePlaceholder: 'مثال: العاملون عن بُعد · 25–54 سنة', market: 'السوق', global: 'عالمي', reportLanguage: 'لغة التقرير', sourceLanguage: 'لغة المصادر', anyLanguage: 'أي لغة', units: 'وحدات المحاكاة', notPeople: 'ليست أشخاصاً تم استطلاعهم', sources: 'مصادر الأدلة', optionalUrls: 'روابط عامة اختيارية', addSource: 'إضافة مصدر', removeSource: 'حذف المصدر', run: 'تشغيل دراسة مؤسّسة', running: 'وكلاء البحث يعملون…', assumptions: 'الافتراضات', assumptionsLabel: 'افتراضات يمكن للنماذج استخدامها', assumptionsNote: 'تُعلّم الافتراضات غير المدعومة في سجل الأدلة.', readySources: 'جاهز مع {sources} مصدر و{assumptions} افتراض.', autoEvidence: 'سيجري Likerts عمليتي بحث محدودتين عبر Vercel AI Gateway ويكشف المصادر المسترجعة.', progress: 'تقدم البحث', frame: 'تأطير', search: 'بحث', simulate: 'محاكاة', review: 'مراجعة', complete: 'مكتمل', fallback: 'استُخدم البديل', inProgress: 'قيد التنفيذ', queued: 'في الانتظار', runLabel: 'التشغيل', notStarted: 'لم يبدأ', copyRun: 'نسخ معرّف التشغيل', overview: 'نظرة عامة', segments: 'شرائح', verbatims: 'إجابات', evidence: 'الأدلة', method: 'المنهج', export: 'تصدير حزمة الأدلة', replay: 'إعادة', likely: 'مرجّح', unlikely: 'غير مرجّح', unsure: 'غير مؤكد', hypothesis: 'تعامل معها كفرضية للاختبار، لا كتقدير للسوق.', suggest: 'ما تقترحه النماذج', changeRead: 'ما الذي سيغيّر هذه القراءة', ledger: 'سجل البحث', coverage: 'تغطية الأدلة', populationFit: 'ملاءمة السكان', independentReview: 'مراجعة مستقلة', inspectEvidence: 'فحص الأدلة', marketLabel: 'السوق', outputLabel: 'التقرير', directional: 'تقدير تركيبي اتجاهي — وليس دليلاً بشرياً ملحوظاً.', methodological: 'الثقة المنهجية',
  },
  'hi-IN': {
    free: 'मुफ़्त · खाता आवश्यक नहीं', ad: 'विज्ञापन', adReserved: 'आरक्षित विज्ञापन स्थान', hero: 'एक विश्वसनीय सिंथेटिक अध्ययन बनाएँ', subhero: 'वर्तमान स्रोतों, जनसंख्या मान्यताओं और स्वतंत्र मॉडल समीक्षा पर दिशात्मक पैनल आधारित करें।', question: 'शोध प्रश्न', audience: 'ऑडियंस', audiencePlaceholder: 'जैसे दूरस्थ नॉलेज वर्कर · आयु 25–54', market: 'बाज़ार', global: 'वैश्विक', reportLanguage: 'रिपोर्ट की भाषा', sourceLanguage: 'स्रोत की भाषा', anyLanguage: 'कोई भी भाषा', units: 'सिमुलेशन इकाइयाँ', notPeople: 'सर्वे किए गए लोग नहीं', sources: 'साक्ष्य स्रोत', optionalUrls: 'वैकल्पिक सार्वजनिक URL', addSource: 'स्रोत जोड़ें', removeSource: 'स्रोत हटाएँ', run: 'आधारित अध्ययन चलाएँ', running: 'रिसर्च एजेंट चल रहे हैं…', assumptions: 'मान्यताएँ', assumptionsLabel: 'मॉडल द्वारा उपयोग की जा सकने वाली मान्यताएँ', assumptionsNote: 'असमर्थित मान्यताएँ साक्ष्य लेजर में चिह्नित होती हैं।', readySources: '{sources} स्रोत और {assumptions} मान्यताओं के साथ तैयार।', autoEvidence: 'Likerts, Vercel AI Gateway से दो सीमित वेब खोज चलाकर हर स्रोत दिखाएगा।', progress: 'शोध प्रगति', frame: 'ढाँचा', search: 'खोज', simulate: 'सिमुलेट', review: 'समीक्षा', complete: 'पूर्ण', fallback: 'वैकल्पिक उपयोग', inProgress: 'चल रहा है', queued: 'कतार में', runLabel: 'रन', notStarted: 'शुरू नहीं', copyRun: 'रन ID कॉपी करें', overview: 'अवलोकन', segments: 'सेगमेंट', verbatims: 'प्रतिक्रियाएँ', evidence: 'साक्ष्य', method: 'विधि', export: 'साक्ष्य पैक निर्यात करें', replay: 'दोहराएँ', likely: 'संभावित', unlikely: 'असंभावित', unsure: 'अनिश्चित', hypothesis: 'इसे परीक्षण योग्य परिकल्पना मानें, बाज़ार अनुमान नहीं।', suggest: 'मॉडल क्या सुझाते हैं', changeRead: 'इस निष्कर्ष को क्या बदलेगा', ledger: 'शोध लेजर', coverage: 'साक्ष्य कवरेज', populationFit: 'जनसंख्या अनुकूलता', independentReview: 'स्वतंत्र समीक्षा', inspectEvidence: 'साक्ष्य देखें', marketLabel: 'बाज़ार', outputLabel: 'रिपोर्ट', directional: 'दिशात्मक सिंथेटिक अनुमान — देखा गया मानवीय साक्ष्य नहीं।', methodological: 'पद्धतिगत भरोसा',
  },
};

// Kept separate from the older dictionaries so this product language stays complete
// across every interface locale and can safely override unsupported freshness claims.
const researchUiTranslations = {
  'en-US': { hero: 'Free synthetic data for market research', subhero: 'Generate synthetic outputs for concept tests, audience hypotheses, messages, pricing, and research planning—free, with no account required.', currentSources: 'Sources', sourcesCurrent: 'Source date provided', researchMode: 'Research depth', quickResearch: 'Quick', deepResearch: 'Deep', quickResearchNote: 'Faster, lower owner cost; bounded synthetic estimate with source retrieval when available.', deepResearchNote: 'Slower, multiple model cells plus disagreement checks; higher owner cost.', runStudy: 'Run study', runUpdatedStudy: 'Run updated study', researchSignals: 'Run signals', stability: 'Stability', ensemble: 'Ensemble', provenance: 'Reproducibility', estimatedOwnerCost: 'Estimated owner cost', exactOwnerCost: 'Exact owner cost', sourceDate: 'Source date' },
  'es-ES': { hero: 'Investigación de mercado sintética gratis, basada en fuentes divulgadas', subhero: 'Prueba conceptos e hipótesis de audiencia con evidencia de fuentes según el mercado, supuestos explícitos y revisión de varios modelos; sin cuenta.', currentSources: 'Fuentes', sourcesCurrent: 'Fecha de fuente disponible', researchMode: 'Profundidad de investigación', quickResearch: 'Rápida', deepResearch: 'Profunda', quickResearchNote: 'Más rápida y de menor coste para el operador; estimación sintética acotada con recuperación de fuentes si está disponible.', deepResearchNote: 'Más lenta, con varias celdas de modelos y comprobaciones de discrepancia; mayor coste para el operador.', runStudy: 'Ejecutar estudio', runUpdatedStudy: 'Ejecutar estudio actualizado', researchSignals: 'Señales de la ejecución', stability: 'Estabilidad', ensemble: 'Conjunto de modelos', provenance: 'Reproducibilidad', estimatedOwnerCost: 'Coste estimado del operador', exactOwnerCost: 'Coste exacto del operador', sourceDate: 'Fecha de la fuente' },
  'pt-BR': { hero: 'Pesquisa de mercado sintética grátis, baseada em fontes divulgadas', subhero: 'Teste conceitos e hipóteses de público com evidências de fontes por mercado, premissas explícitas e revisão de vários modelos — sem conta.', currentSources: 'Fontes', sourcesCurrent: 'Data da fonte disponível', researchMode: 'Profundidade da pesquisa', quickResearch: 'Rápida', deepResearch: 'Profunda', quickResearchNote: 'Mais rápida e com menor custo para o operador; estimativa sintética limitada com busca de fontes quando disponível.', deepResearchNote: 'Mais lenta, com várias células de modelo e verificações de divergência; maior custo para o operador.', runStudy: 'Executar estudo', runUpdatedStudy: 'Executar estudo atualizado', researchSignals: 'Sinais da execução', stability: 'Estabilidade', ensemble: 'Conjunto de modelos', provenance: 'Reprodutibilidade', estimatedOwnerCost: 'Custo estimado do operador', exactOwnerCost: 'Custo exato do operador', sourceDate: 'Data da fonte' },
  'fr-FR': { hero: 'Études de marché synthétiques gratuites, fondées sur des sources divulguées', subhero: 'Testez des concepts et hypothèses d’audience avec des sources adaptées au marché, des hypothèses explicites et une revue multi-modèles, sans compte.', currentSources: 'Sources', sourcesCurrent: 'Date de source fournie', researchMode: 'Profondeur de recherche', quickResearch: 'Rapide', deepResearch: 'Approfondie', quickResearchNote: 'Plus rapide, coût opérateur réduit ; estimation synthétique bornée avec récupération de sources si disponible.', deepResearchNote: 'Plus lente, avec plusieurs cellules de modèles et des contrôles de divergence ; coût opérateur plus élevé.', runStudy: 'Lancer l’étude', runUpdatedStudy: 'Lancer l’étude mise à jour', researchSignals: 'Signaux de l’exécution', stability: 'Stabilité', ensemble: 'Ensemble de modèles', provenance: 'Reproductibilité', estimatedOwnerCost: 'Coût opérateur estimé', exactOwnerCost: 'Coût opérateur exact', sourceDate: 'Date de la source' },
  'de-DE': { hero: 'Kostenlose synthetische Marktforschung auf Basis offengelegter Quellen', subhero: 'Teste Konzepte und Zielgruppenhypothesen mit marktbezogenen Quellen, expliziten Annahmen und Mehrmodell-Prüfung – ohne Konto.', currentSources: 'Quellen', sourcesCurrent: 'Quelldatum vorhanden', researchMode: 'Recherchetiefe', quickResearch: 'Schnell', deepResearch: 'Tiefgehend', quickResearchNote: 'Schneller und mit niedrigeren Betreiberkosten; begrenzte synthetische Schätzung mit Quellenabruf, wenn verfügbar.', deepResearchNote: 'Langsamer, mit mehreren Modellzellen und Abweichungsprüfungen; höhere Betreiberkosten.', runStudy: 'Studie starten', runUpdatedStudy: 'Aktualisierte Studie starten', researchSignals: 'Laufsignale', stability: 'Stabilität', ensemble: 'Modellensemble', provenance: 'Reproduzierbarkeit', estimatedOwnerCost: 'Geschätzte Betreiberkosten', exactOwnerCost: 'Exakte Betreiberkosten', sourceDate: 'Quelldatum' },
  'zh-CN': { hero: '免费合成市场研究，基于已披露来源', subhero: '无需账户即可用市场相关的来源证据、明确假设和多模型审查测试概念与受众假设。', currentSources: '来源', sourcesCurrent: '已提供来源日期', researchMode: '研究深度', quickResearch: '快速', deepResearch: '深入', quickResearchNote: '更快、运营方成本更低；有来源时进行检索的有限合成估计。', deepResearchNote: '更慢，采用多个模型单元并进行分歧检查；运营方成本更高。', runStudy: '运行研究', runUpdatedStudy: '运行更新后的研究', researchSignals: '运行信号', stability: '稳定性', ensemble: '模型集成', provenance: '可复现性', estimatedOwnerCost: '预计运营方成本', exactOwnerCost: '确切运营方成本', sourceDate: '来源日期' },
  'ja-JP': { hero: '開示済みの情報源に基づく無料の合成市場調査', subhero: '市場に応じた情報源、明示的な前提、複数モデルのレビューで、コンセプトと対象者の仮説をアカウントなしで検証します。', currentSources: '情報源', sourcesCurrent: '情報源の日付あり', researchMode: '調査の深さ', quickResearch: 'クイック', deepResearch: '詳細', quickResearchNote: 'より速く、運用コストを抑え、情報源が利用可能な場合に取得する限定的な合成推定です。', deepResearchNote: 'より時間がかかり、複数のモデルセルと不一致の確認を行うため、運用コストが上がります。', runStudy: '調査を実行', runUpdatedStudy: '更新した調査を実行', researchSignals: '実行シグナル', stability: '安定性', ensemble: 'モデルアンサンブル', provenance: '再現可能性', estimatedOwnerCost: '推定運用コスト', exactOwnerCost: '確定運用コスト', sourceDate: '情報源の日付' },
  'ko-KR': { hero: '공개된 출처에 근거한 무료 합성 시장 조사', subhero: '계정 없이 시장별 출처 근거, 명시적 가정, 다중 모델 검토로 콘셉트와 대상 가설을 검증하세요.', currentSources: '출처', sourcesCurrent: '출처 날짜 제공됨', researchMode: '조사 깊이', quickResearch: '빠르게', deepResearch: '심층', quickResearchNote: '더 빠르고 운영자 비용이 낮으며, 가능할 때 출처를 가져오는 제한된 합성 추정입니다.', deepResearchNote: '더 느리지만 여러 모델 셀과 불일치 검사를 수행하므로 운영자 비용이 높습니다.', runStudy: '연구 실행', runUpdatedStudy: '업데이트된 연구 실행', researchSignals: '실행 신호', stability: '안정성', ensemble: '모델 앙상블', provenance: '재현성', estimatedOwnerCost: '예상 운영자 비용', exactOwnerCost: '정확한 운영자 비용', sourceDate: '출처 날짜' },
  'ar-SA': { hero: 'بحث سوقي تركيبي مجاني يستند إلى مصادر مُفصح عنها', subhero: 'اختبر المفاهيم وفرضيات الجمهور بأدلة مصادر ملائمة للسوق وافتراضات صريحة ومراجعة عدة نماذج، بلا حساب.', currentSources: 'المصادر', sourcesCurrent: 'تاريخ المصدر متاح', researchMode: 'عمق البحث', quickResearch: 'سريع', deepResearch: 'متعمق', quickResearchNote: 'أسرع وبتكلفة تشغيل أقل؛ تقدير تركيبي محدود مع استرجاع المصادر عند توفرها.', deepResearchNote: 'أبطأ، مع خلايا نماذج متعددة وفحوص للاختلاف؛ تكلفة تشغيل أعلى.', runStudy: 'تشغيل الدراسة', runUpdatedStudy: 'تشغيل الدراسة المحدّثة', researchSignals: 'إشارات التشغيل', stability: 'الاستقرار', ensemble: 'مجموعة النماذج', provenance: 'قابلية التكرار', estimatedOwnerCost: 'تكلفة التشغيل المقدّرة', exactOwnerCost: 'تكلفة التشغيل الدقيقة', sourceDate: 'تاريخ المصدر' },
  'hi-IN': { hero: 'प्रकट स्रोतों पर आधारित मुफ़्त सिंथेटिक बाज़ार शोध', subhero: 'बिना खाते के बाज़ार-अनुरूप स्रोत साक्ष्य, स्पष्ट मान्यताओं और बहु-मॉडल समीक्षा के साथ अवधारणाओं और ऑडियंस परिकल्पनाओं का परीक्षण करें।', currentSources: 'स्रोत', sourcesCurrent: 'स्रोत तिथि उपलब्ध', researchMode: 'शोध की गहराई', quickResearch: 'त्वरित', deepResearch: 'गहन', quickResearchNote: 'तेज़ और कम ऑपरेटर लागत; उपलब्ध होने पर स्रोत प्राप्ति के साथ सीमित सिंथेटिक अनुमान।', deepResearchNote: 'धीमा, कई मॉडल कोशिकाओं और असहमति जाँच के साथ; अधिक ऑपरेटर लागत।', runStudy: 'अध्ययन चलाएँ', runUpdatedStudy: 'अपडेट किया अध्ययन चलाएँ', researchSignals: 'रन संकेत', stability: 'स्थिरता', ensemble: 'मॉडल समूह', provenance: 'पुनरुत्पादकता', estimatedOwnerCost: 'अनुमानित ऑपरेटर लागत', exactOwnerCost: 'सटीक ऑपरेटर लागत', sourceDate: 'स्रोत तिथि' },
};

const researchStatusTranslations = {
  'en-US': { stabilityNotEstimated: 'Not estimated for Quick mode', stabilityMeasured: 'Measured across model cells' },
  'es-ES': { stabilityNotEstimated: 'No estimada en el modo Rápido', stabilityMeasured: 'Medida entre celdas de modelos' },
  'pt-BR': { stabilityNotEstimated: 'Não estimada no modo Rápido', stabilityMeasured: 'Medida entre células de modelos' },
  'fr-FR': { stabilityNotEstimated: 'Non estimée en mode Rapide', stabilityMeasured: 'Mesurée entre cellules de modèles' },
  'de-DE': { stabilityNotEstimated: 'Im Schnellmodus nicht geschätzt', stabilityMeasured: 'Über Modellzellen gemessen' },
  'zh-CN': { stabilityNotEstimated: '快速模式下未估计', stabilityMeasured: '已跨模型单元测量' },
  'ja-JP': { stabilityNotEstimated: 'クイックモードでは未推定', stabilityMeasured: 'モデルセル間で測定' },
  'ko-KR': { stabilityNotEstimated: '빠른 모드에서는 추정되지 않음', stabilityMeasured: '모델 셀 전반에서 측정됨' },
  'ar-SA': { stabilityNotEstimated: 'غير مقدّر في الوضع السريع', stabilityMeasured: 'مقاس عبر خلايا النماذج' },
  'hi-IN': { stabilityNotEstimated: 'त्वरित मोड में अनुमानित नहीं', stabilityMeasured: 'मॉडल कोशिकाओं में मापा गया' },
};

const syntheticMethodTranslations = {
  'en-US': { syntheticMethodNote: 'Synthetic estimates use sources when available, not human respondents; runs are not deterministic.' },
  'es-ES': { syntheticMethodNote: 'Las estimaciones sintéticas usan fuentes cuando están disponibles, no personas encuestadas; las ejecuciones no son deterministas.' },
  'pt-BR': { syntheticMethodNote: 'As estimativas sintéticas usam fontes quando disponíveis, não pessoas respondentes; as execuções não são determinísticas.' },
  'fr-FR': { syntheticMethodNote: 'Les estimations synthétiques utilisent des sources lorsqu’elles sont disponibles, et non des répondants humains ; les exécutions ne sont pas déterministes.' },
  'de-DE': { syntheticMethodNote: 'Synthetische Schätzungen nutzen Quellen, wenn verfügbar, keine befragten Menschen; Läufe sind nicht deterministisch.' },
  'zh-CN': { syntheticMethodNote: '合成估计会在来源可用时使用来源，而非人工受访者；每次运行并非确定性的。' },
  'ja-JP': { syntheticMethodNote: '合成推定は利用可能な場合に情報源を用い、人の回答者は使用しません。実行結果は決定論的ではありません。' },
  'ko-KR': { syntheticMethodNote: '합성 추정은 가능할 때 출처를 사용하며 실제 응답자를 사용하지 않습니다. 실행 결과는 결정론적이지 않습니다.' },
  'ar-SA': { syntheticMethodNote: 'تستخدم التقديرات التركيبية المصادر عند توفرها، لا مستجيبين بشريين؛ وعمليات التشغيل غير حتمية.' },
  'hi-IN': { syntheticMethodNote: 'सिंथेटिक अनुमान उपलब्ध होने पर स्रोतों का उपयोग करते हैं, मानव उत्तरदाताओं का नहीं; रन नियतात्मक नहीं होते।' },
};

const gatewayCostTranslations = {
  'en-US': { exactGatewayCost: 'Gateway cost', estimatedGatewayCost: 'Estimated Gateway cost', gatewayCostNote: 'Excludes hosting and non-Gateway services.' },
  'es-ES': { exactGatewayCost: 'Coste de Gateway', estimatedGatewayCost: 'Coste estimado de Gateway', gatewayCostNote: 'No incluye alojamiento ni servicios ajenos a Gateway.' },
  'pt-BR': { exactGatewayCost: 'Custo do Gateway', estimatedGatewayCost: 'Custo estimado do Gateway', gatewayCostNote: 'Não inclui hospedagem nem serviços fora do Gateway.' },
  'fr-FR': { exactGatewayCost: 'Coût Gateway', estimatedGatewayCost: 'Coût Gateway estimé', gatewayCostNote: 'Hébergement et services hors Gateway exclus.' },
  'de-DE': { exactGatewayCost: 'Gateway-Kosten', estimatedGatewayCost: 'Geschätzte Gateway-Kosten', gatewayCostNote: 'Hosting und Dienste außerhalb des Gateways sind ausgeschlossen.' },
  'zh-CN': { exactGatewayCost: 'Gateway 成本', estimatedGatewayCost: '预计 Gateway 成本', gatewayCostNote: '不含托管和非 Gateway 服务。' },
  'ja-JP': { exactGatewayCost: 'Gateway コスト', estimatedGatewayCost: '推定 Gateway コスト', gatewayCostNote: 'ホスティングと Gateway 以外のサービスは含みません。' },
  'ko-KR': { exactGatewayCost: 'Gateway 비용', estimatedGatewayCost: '예상 Gateway 비용', gatewayCostNote: '호스팅 및 Gateway 외 서비스는 제외됩니다.' },
  'ar-SA': { exactGatewayCost: 'تكلفة Gateway', estimatedGatewayCost: 'تكلفة Gateway المقدّرة', gatewayCostNote: 'لا تشمل الاستضافة أو الخدمات خارج Gateway.' },
  'hi-IN': { exactGatewayCost: 'Gateway लागत', estimatedGatewayCost: 'अनुमानित Gateway लागत', gatewayCostNote: 'होस्टिंग और गैर-Gateway सेवाएँ शामिल नहीं हैं।' },
};

const researchMethodKeys = ['researchMethod', 'conceptIntentTest', 'conceptIntentTestDescription', 'generalLikertLegacy', 'generalLikertLegacyDescription', 'conceptStimulus', 'required', 'researchDesign', 'researchDesignMissing', 'primaryOutcome', 'estimand', 'chartPlan', 'includedQuestions', 'requiredInputs', 'criticCriteria', 'humanValidationRequired', 'methodDisclosure', 'templateVersion'];
const researchMethodValues = {
  'en-US': ['Research method', 'Concept intent test', 'Monadic concept exposure with a five-point directional intent read.', 'General directional Likert (legacy)', 'Legacy-compatible directional exploration; choose Concept intent test for a method-specific design.', 'Concept stimulus', 'required', 'Research design', 'This legacy result has no method-specific research design.', 'Primary outcome', 'Estimand', 'Chart plan', 'Included questions', 'Required inputs', 'Critic criteria', 'Human validation required', 'Model-generated direction—not a human measurement.', 'Template version'],
  'es-ES': ['Método de investigación', 'Prueba de intención del concepto', 'Exposición monádica al concepto con una lectura direccional de intención en cinco puntos.', 'Likert direccional general (heredado)', 'Exploración direccional compatible con versiones anteriores; elige la prueba de concepto para un diseño específico.', 'Estímulo del concepto', 'obligatorio', 'Diseño de investigación', 'Este resultado heredado no incluye un diseño específico del método.', 'Resultado principal', 'Estimando', 'Plan de gráfico', 'Preguntas incluidas', 'Entradas obligatorias', 'Criterios de revisión', 'Se requiere validación humana', 'Dirección generada por modelos; no es una medición humana.', 'Versión de plantilla'],
  'pt-BR': ['Método de pesquisa', 'Teste de intenção do conceito', 'Exposição monádica ao conceito com leitura direcional de intenção em cinco pontos.', 'Likert direcional geral (legado)', 'Exploração direcional compatível com o legado; escolha o teste de conceito para um desenho específico.', 'Estímulo do conceito', 'obrigatório', 'Desenho da pesquisa', 'Este resultado legado não inclui um desenho específico do método.', 'Resultado principal', 'Estimando', 'Plano do gráfico', 'Perguntas incluídas', 'Entradas obrigatórias', 'Critérios de crítica', 'Validação humana obrigatória', 'Direção gerada por modelos — não é uma medição humana.', 'Versão do modelo'],
  'fr-FR': ['Méthode de recherche', 'Test d’intention du concept', 'Exposition monadique au concept avec lecture directionnelle de l’intention en cinq points.', 'Likert directionnel général (hérité)', 'Exploration directionnelle compatible avec l’existant ; choisissez le test de concept pour un protocole spécifique.', 'Stimulus du concept', 'obligatoire', 'Plan de recherche', 'Ce résultat hérité ne comporte aucun plan propre à une méthode.', 'Résultat principal', 'Estimande', 'Plan du graphique', 'Questions incluses', 'Entrées requises', 'Critères de critique', 'Validation humaine requise', 'Direction générée par les modèles — pas une mesure humaine.', 'Version du modèle'],
  'de-DE': ['Forschungsmethode', 'Konzept-Absichtstest', 'Monadische Konzeptexposition mit einer richtungsweisenden Fünf-Punkte-Absichtsmessung.', 'Allgemeiner richtungsweisender Likert (Altversion)', 'Altkompatible Richtungsexploration; für ein methodenspezifisches Design den Konzepttest wählen.', 'Konzeptstimulus', 'erforderlich', 'Forschungsdesign', 'Dieses ältere Ergebnis enthält kein methodenspezifisches Forschungsdesign.', 'Primäres Ergebnis', 'Schätzgröße', 'Diagrammplan', 'Enthaltene Fragen', 'Erforderliche Eingaben', 'Prüfkriterien', 'Validierung mit Menschen erforderlich', 'Modellgenerierte Richtung — keine Messung an Menschen.', 'Vorlagenversion'],
  'zh-CN': ['研究方法', '概念意向测试', '单一概念展示，并以五点量表读取方向性意向。', '通用方向性 Likert（旧版）', '兼容旧版的方向性探索；如需方法专属设计，请选择概念意向测试。', '概念刺激材料', '必填', '研究设计', '此旧版结果不含方法专属研究设计。', '主要结果', '目标估量', '图表方案', '包含的问题', '必需输入', '审查标准', '必须进行真人验证', '模型生成的方向，不是真人测量。', '模板版本'],
  'ja-JP': ['調査手法', 'コンセプト意向テスト', '単一コンセプトを提示し、5段階で方向性のある意向を確認します。', '一般的な方向性リッカート（旧方式）', '旧方式と互換の方向性探索です。手法固有の設計にはコンセプトテストを選択してください。', 'コンセプト刺激', '必須', '調査設計', 'この旧結果には手法固有の調査設計がありません。', '主要アウトカム', '推定対象', 'チャート計画', '含まれる質問', '必須入力', '批評基準', '人による検証が必要', 'モデル生成の方向性であり、人の測定値ではありません。', 'テンプレート版'],
  'ko-KR': ['조사 방법', '콘셉트 의향 테스트', '단일 콘셉트를 노출하고 5점 방향성 의향을 확인합니다.', '일반 방향성 Likert(레거시)', '레거시 호환 방향성 탐색입니다. 방법별 설계에는 콘셉트 테스트를 선택하세요.', '콘셉트 자극물', '필수', '조사 설계', '이 레거시 결과에는 방법별 조사 설계가 없습니다.', '주요 결과', '추정 대상', '차트 계획', '포함 질문', '필수 입력', '비평 기준', '실제 사람을 통한 검증 필요', '모델 생성 방향이며 사람을 측정한 값이 아닙니다.', '템플릿 버전'],
  'ar-SA': ['منهج البحث', 'اختبار نية المفهوم', 'عرض أحادي للمفهوم مع قراءة اتجاهية للنية على خمس نقاط.', 'ليكرت اتجاهي عام (قديم)', 'استكشاف اتجاهي متوافق مع الإصدارات القديمة؛ اختر اختبار المفهوم لتصميم خاص بالمنهج.', 'مادة المفهوم', 'مطلوب', 'تصميم البحث', 'لا تتضمن هذه النتيجة القديمة تصميماً بحثياً خاصاً بالمنهج.', 'النتيجة الأساسية', 'المقدار المستهدف', 'خطة الرسم', 'الأسئلة المضمنة', 'المدخلات المطلوبة', 'معايير النقد', 'التحقق البشري مطلوب', 'اتجاه مولّد بالنموذج — وليس قياساً بشرياً.', 'إصدار القالب'],
  'hi-IN': ['शोध विधि', 'अवधारणा इरादा परीक्षण', 'एक अवधारणा दिखाकर पाँच-बिंदु दिशात्मक इरादा पढ़ना।', 'सामान्य दिशात्मक Likert (पुराना)', 'पुराने संस्करण के अनुकूल दिशात्मक खोज; विधि-विशिष्ट डिज़ाइन के लिए अवधारणा परीक्षण चुनें।', 'अवधारणा सामग्री', 'आवश्यक', 'शोध डिज़ाइन', 'इस पुराने परिणाम में विधि-विशिष्ट शोध डिज़ाइन नहीं है।', 'प्राथमिक परिणाम', 'अनुमान लक्ष्य', 'चार्ट योजना', 'शामिल प्रश्न', 'आवश्यक इनपुट', 'आलोचक मानदंड', 'मानवीय सत्यापन आवश्यक', 'मॉडल-जनित दिशा — मानवीय माप नहीं।', 'टेम्पलेट संस्करण'],
};
const researchMethodUiTranslations = Object.fromEntries(Object.entries(researchMethodValues).map(([locale, values]) => [locale, Object.fromEntries(researchMethodKeys.map((key, index) => [key, values[index]]))]));

const purchaseMethodTranslations = {
  'en-US': { purchaseIntentTest: 'Purchase-intent test', purchaseIntentTestDescription: 'Exact priced offer, channel, horizon, and alternative with a five-point intent read.', exactOffer: 'Exact offer', category: 'Category', price: 'Price', currency: 'Currency', priceUnit: 'Price unit', priceUnitPlaceholder: 'per month, per item…', purchaseChannel: 'Purchase channel', purchaseHorizon: 'Purchase horizon', referenceAlternative: 'Reference alternative', definitelyWouldNot: 'Definitely would not', probablyWouldNot: 'Probably would not', mightOrMightNot: 'Might or might not', probablyWould: 'Probably would', definitelyWould: 'Definitely would' },
  'es-ES': { purchaseIntentTest: 'Prueba de intención de compra', purchaseIntentTestDescription: 'Oferta exacta con precio, canal, horizonte y alternativa, con intención en cinco puntos.', exactOffer: 'Oferta exacta', category: 'Categoría', price: 'Precio', currency: 'Moneda', priceUnit: 'Unidad de precio', priceUnitPlaceholder: 'al mes, por artículo…', purchaseChannel: 'Canal de compra', purchaseHorizon: 'Horizonte de compra', referenceAlternative: 'Alternativa de referencia', definitelyWouldNot: 'Definitivamente no compraría', probablyWouldNot: 'Probablemente no compraría', mightOrMightNot: 'Podría comprar o no', probablyWould: 'Probablemente compraría', definitelyWould: 'Definitivamente compraría' },
  'pt-BR': { purchaseIntentTest: 'Teste de intenção de compra', purchaseIntentTestDescription: 'Oferta exata com preço, canal, horizonte e alternativa, com intenção em cinco pontos.', exactOffer: 'Oferta exata', category: 'Categoria', price: 'Preço', currency: 'Moeda', priceUnit: 'Unidade de preço', priceUnitPlaceholder: 'por mês, por item…', purchaseChannel: 'Canal de compra', purchaseHorizon: 'Horizonte de compra', referenceAlternative: 'Alternativa de referência', definitelyWouldNot: 'Definitivamente não compraria', probablyWouldNot: 'Provavelmente não compraria', mightOrMightNot: 'Talvez comprasse, talvez não', probablyWould: 'Provavelmente compraria', definitelyWould: 'Definitivamente compraria' },
  'fr-FR': { purchaseIntentTest: 'Test d’intention d’achat', purchaseIntentTestDescription: 'Offre exacte tarifée, canal, horizon et alternative avec intention en cinq points.', exactOffer: 'Offre exacte', category: 'Catégorie', price: 'Prix', currency: 'Devise', priceUnit: 'Unité de prix', priceUnitPlaceholder: 'par mois, par article…', purchaseChannel: 'Canal d’achat', purchaseHorizon: 'Horizon d’achat', referenceAlternative: 'Alternative de référence', definitelyWouldNot: 'N’achèterait certainement pas', probablyWouldNot: 'N’achèterait probablement pas', mightOrMightNot: 'Pourrait acheter ou non', probablyWould: 'Achèterait probablement', definitelyWould: 'Achèterait certainement' },
  'de-DE': { purchaseIntentTest: 'Kaufabsichtstest', purchaseIntentTestDescription: 'Exaktes bepreistes Angebot, Kanal, Zeitraum und Alternative mit Fünf-Punkte-Kaufabsicht.', exactOffer: 'Exaktes Angebot', category: 'Kategorie', price: 'Preis', currency: 'Währung', priceUnit: 'Preiseinheit', priceUnitPlaceholder: 'pro Monat, pro Artikel…', purchaseChannel: 'Kaufkanal', purchaseHorizon: 'Kaufzeitraum', referenceAlternative: 'Referenzalternative', definitelyWouldNot: 'Würde definitiv nicht kaufen', probablyWouldNot: 'Würde wahrscheinlich nicht kaufen', mightOrMightNot: 'Vielleicht ja, vielleicht nein', probablyWould: 'Würde wahrscheinlich kaufen', definitelyWould: 'Würde definitiv kaufen' },
  'zh-CN': { purchaseIntentTest: '购买意向测试', purchaseIntentTestDescription: '基于明确价格、渠道、时间范围和替代方案的五点购买意向读取。', exactOffer: '明确产品方案', category: '品类', price: '价格', currency: '币种', priceUnit: '计价单位', priceUnitPlaceholder: '每月、每件…', purchaseChannel: '购买渠道', purchaseHorizon: '购买时间范围', referenceAlternative: '参照替代方案', definitelyWouldNot: '肯定不会购买', probablyWouldNot: '可能不会购买', mightOrMightNot: '不确定是否购买', probablyWould: '可能会购买', definitelyWould: '肯定会购买' },
  'ja-JP': { purchaseIntentTest: '購入意向テスト', purchaseIntentTestDescription: '価格、チャネル、時期、代替案を明示した5段階の購入意向確認。', exactOffer: '具体的なオファー', category: 'カテゴリー', price: '価格', currency: '通貨', priceUnit: '価格単位', priceUnitPlaceholder: '月額、1点あたり…', purchaseChannel: '購入チャネル', purchaseHorizon: '購入時期', referenceAlternative: '比較する代替案', definitelyWouldNot: '絶対に購入しない', probablyWouldNot: 'おそらく購入しない', mightOrMightNot: 'どちらともいえない', probablyWould: 'おそらく購入する', definitelyWould: '絶対に購入する' },
  'ko-KR': { purchaseIntentTest: '구매 의향 테스트', purchaseIntentTestDescription: '정확한 가격, 채널, 시점, 대안을 제시한 5점 구매 의향 확인.', exactOffer: '정확한 제안', category: '카테고리', price: '가격', currency: '통화', priceUnit: '가격 단위', priceUnitPlaceholder: '월별, 품목별…', purchaseChannel: '구매 채널', purchaseHorizon: '구매 시점', referenceAlternative: '비교 대안', definitelyWouldNot: '절대 구매하지 않음', probablyWouldNot: '아마 구매하지 않음', mightOrMightNot: '구매할 수도, 아닐 수도 있음', probablyWould: '아마 구매함', definitelyWould: '확실히 구매함' },
  'ar-SA': { purchaseIntentTest: 'اختبار نية الشراء', purchaseIntentTestDescription: 'عرض محدد بسعر وقناة وأفق وبديل مع قراءة نية من خمس نقاط.', exactOffer: 'العرض المحدد', category: 'الفئة', price: 'السعر', currency: 'العملة', priceUnit: 'وحدة السعر', priceUnitPlaceholder: 'شهرياً، لكل قطعة…', purchaseChannel: 'قناة الشراء', purchaseHorizon: 'أفق الشراء', referenceAlternative: 'البديل المرجعي', definitelyWouldNot: 'لن يشتري بالتأكيد', probablyWouldNot: 'على الأرجح لن يشتري', mightOrMightNot: 'قد يشتري أو لا يشتري', probablyWould: 'على الأرجح سيشتري', definitelyWould: 'سيشتري بالتأكيد' },
  'hi-IN': { purchaseIntentTest: 'खरीद इरादा परीक्षण', purchaseIntentTestDescription: 'सटीक कीमत, चैनल, समय-सीमा और विकल्प के साथ पाँच-बिंदु खरीद इरादा।', exactOffer: 'सटीक ऑफ़र', category: 'श्रेणी', price: 'कीमत', currency: 'मुद्रा', priceUnit: 'कीमत इकाई', priceUnitPlaceholder: 'प्रति माह, प्रति वस्तु…', purchaseChannel: 'खरीद चैनल', purchaseHorizon: 'खरीद समय-सीमा', referenceAlternative: 'संदर्भ विकल्प', definitelyWouldNot: 'बिल्कुल नहीं खरीदेगा', probablyWouldNot: 'शायद नहीं खरीदेगा', mightOrMightNot: 'खरीद भी सकता है, नहीं भी', probablyWould: 'शायद खरीदेगा', definitelyWould: 'ज़रूर खरीदेगा' },
};

const segmentPerspectiveTranslations = {
  'es-ES': { exploreModeledSegment: 'Explorar segmento modelado', exploreSegment: 'Explorar segmento', syntheticSegmentExploration: 'Exploración sintética del segmento', followUpSegment: 'Profundizar en este segmento modelado', modeledSegmentNote: 'Segmento construido por el modelo; no es un grupo muestreado.', yourQuestion: 'Tu pregunta', evidenceAndAssumptions: 'Evidencia y supuestos utilizados', assumptionsUsed: 'Supuestos utilizados', noPerspectiveEvidence: 'No se registró evidencia externa para esta perspectiva.', noAssumptionsRecorded: 'No se registraron supuestos adicionales.', generatingPerspective: 'Generando perspectiva…', perspectiveReady: 'Perspectiva lista', perspectiveModes: 'Formas de explorar', testObjection: 'Probar una objeción', exploreCounterfactual: 'Explorar un contrafactual', compareConcepts: 'Comparar dos conceptos', changedCondition: 'Condición modificada', fixedConditions: 'Condiciones fijas', defaultFixedConditions: 'Mantén el segmento, el marco poblacional y la evidencia sin cambios.', conceptA: 'Concepto A', conceptB: 'Concepto B', askFollowUp: 'Hacer una pregunta de seguimiento', followUpPlaceholder: 'Pregunta cómo podría reaccionar este segmento modelado ante una condición, objeción o comparación concreta.', perspectiveError: 'No se pudo generar la perspectiva. Inténtalo de nuevo.', retry: 'Reintentar', sendQuestion: 'Enviar pregunta', objectionStarter: '¿Qué objeción sería más importante para este segmento modelado y qué podría reducirla?', counterfactualStarter: '¿Cómo cambiaría esta perspectiva si cambiara esta condición?', comparisonStarter: 'Compara la reacción ante el Concepto A y el Concepto B, manteniendo iguales las demás condiciones.' },
  'pt-BR': { exploreModeledSegment: 'Explorar segmento modelado', exploreSegment: 'Explorar segmento', syntheticSegmentExploration: 'Exploração sintética do segmento', followUpSegment: 'Aprofundar neste segmento modelado', modeledSegmentNote: 'Segmento construído pelo modelo; não é um grupo amostrado.', yourQuestion: 'Sua pergunta', evidenceAndAssumptions: 'Evidências e premissas usadas', assumptionsUsed: 'Premissas usadas', noPerspectiveEvidence: 'Nenhuma evidência externa foi registrada para esta perspectiva.', noAssumptionsRecorded: 'Nenhuma premissa adicional foi registrada.', generatingPerspective: 'Gerando perspectiva…', perspectiveReady: 'Perspectiva pronta', perspectiveModes: 'Formas de explorar', testObjection: 'Testar uma objeção', exploreCounterfactual: 'Explorar um contrafactual', compareConcepts: 'Comparar dois conceitos', changedCondition: 'Condição alterada', fixedConditions: 'Condições mantidas', defaultFixedConditions: 'Mantenha o segmento, o quadro populacional e as evidências inalterados.', conceptA: 'Conceito A', conceptB: 'Conceito B', askFollowUp: 'Fazer uma pergunta de acompanhamento', followUpPlaceholder: 'Pergunte como este segmento modelado poderia reagir a uma condição, objeção ou comparação específica.', perspectiveError: 'Não foi possível gerar a perspectiva. Tente novamente.', retry: 'Tentar novamente', sendQuestion: 'Enviar pergunta', objectionStarter: 'Qual objeção seria mais importante para este segmento modelado e o que poderia reduzi-la?', counterfactualStarter: 'Como essa perspectiva mudaria se esta condição fosse diferente?', comparisonStarter: 'Compare a reação ao Conceito A e ao Conceito B, mantendo as demais condições iguais.' },
  'fr-FR': { exploreModeledSegment: 'Explorer le segment modélisé', exploreSegment: 'Explorer le segment', syntheticSegmentExploration: 'Exploration synthétique du segment', followUpSegment: 'Approfondir ce segment modélisé', modeledSegmentNote: 'Segment construit par le modèle ; il ne s’agit pas d’un groupe échantillonné.', yourQuestion: 'Votre question', evidenceAndAssumptions: 'Éléments probants et hypothèses utilisés', assumptionsUsed: 'Hypothèses utilisées', noPerspectiveEvidence: 'Aucune source externe n’a été enregistrée pour cette perspective.', noAssumptionsRecorded: 'Aucune hypothèse supplémentaire n’a été enregistrée.', generatingPerspective: 'Génération de la perspective…', perspectiveReady: 'Perspective prête', perspectiveModes: 'Façons d’explorer', testObjection: 'Tester une objection', exploreCounterfactual: 'Explorer un contrefactuel', compareConcepts: 'Comparer deux concepts', changedCondition: 'Condition modifiée', fixedConditions: 'Conditions maintenues', defaultFixedConditions: 'Conservez le segment, le cadre de population et les sources inchangés.', conceptA: 'Concept A', conceptB: 'Concept B', askFollowUp: 'Poser une question de suivi', followUpPlaceholder: 'Demandez comment ce segment modélisé pourrait réagir à une condition, une objection ou une comparaison précise.', perspectiveError: 'Impossible de générer la perspective. Réessayez.', retry: 'Réessayer', sendQuestion: 'Envoyer la question', objectionStarter: 'Quelle objection serait la plus importante pour ce segment modélisé, et qu’est-ce qui pourrait l’atténuer ?', counterfactualStarter: 'Comment cette perspective changerait-elle si cette condition était différente ?', comparisonStarter: 'Comparez la réaction au Concept A et au Concept B, toutes les autres conditions restant identiques.' },
  'de-DE': { exploreModeledSegment: 'Modelliertes Segment erkunden', exploreSegment: 'Segment erkunden', syntheticSegmentExploration: 'Synthetische Segmenterkundung', followUpSegment: 'Dieses modellierte Segment vertiefen', modeledSegmentNote: 'Vom Modell konstruiertes Segment; keine gezogene Stichprobe.', yourQuestion: 'Ihre Frage', evidenceAndAssumptions: 'Verwendete Evidenz und Annahmen', assumptionsUsed: 'Verwendete Annahmen', noPerspectiveEvidence: 'Für diese Perspektive wurde keine externe Evidenz erfasst.', noAssumptionsRecorded: 'Es wurden keine zusätzlichen Annahmen erfasst.', generatingPerspective: 'Perspektive wird generiert…', perspectiveReady: 'Perspektive bereit', perspectiveModes: 'Erkundungsmöglichkeiten', testObjection: 'Einwand testen', exploreCounterfactual: 'Kontrafaktisches Szenario erkunden', compareConcepts: 'Zwei Konzepte vergleichen', changedCondition: 'Veränderte Bedingung', fixedConditions: 'Unveränderte Bedingungen', defaultFixedConditions: 'Segment, Populationsrahmen und Evidenz unverändert lassen.', conceptA: 'Konzept A', conceptB: 'Konzept B', askFollowUp: 'Eine Folgefrage stellen', followUpPlaceholder: 'Fragen Sie, wie dieses modellierte Segment auf eine bestimmte Bedingung, einen Einwand oder einen Vergleich reagieren könnte.', perspectiveError: 'Die Perspektive konnte nicht generiert werden. Bitte erneut versuchen.', retry: 'Erneut versuchen', sendQuestion: 'Frage senden', objectionStarter: 'Welcher Einwand wäre für dieses modellierte Segment am wichtigsten, und was könnte ihn verringern?', counterfactualStarter: 'Wie würde sich diese Perspektive ändern, wenn diese Bedingung anders wäre?', comparisonStarter: 'Vergleichen Sie die Reaktion auf Konzept A und Konzept B bei ansonsten gleichen Bedingungen.' },
  'zh-CN': { exploreModeledSegment: '探索建模细分人群', exploreSegment: '探索细分人群', syntheticSegmentExploration: '合成细分人群探索', followUpSegment: '深入了解这一建模细分人群', modeledSegmentNote: '该细分人群由模型构建，并非抽样群体。', yourQuestion: '你的问题', evidenceAndAssumptions: '所用证据与假设', assumptionsUsed: '所用假设', noPerspectiveEvidence: '未记录支持此观点的外部证据。', noAssumptionsRecorded: '未记录其他假设。', generatingPerspective: '正在生成观点…', perspectiveReady: '观点已就绪', perspectiveModes: '探索方式', testObjection: '测试异议', exploreCounterfactual: '探索反事实情境', compareConcepts: '比较两个概念', changedCondition: '变化条件', fixedConditions: '保持不变的条件', defaultFixedConditions: '保持细分人群、总体框架和证据不变。', conceptA: '概念 A', conceptB: '概念 B', askFollowUp: '提出后续问题', followUpPlaceholder: '询问这一建模细分人群可能如何回应某个具体条件、异议或比较。', perspectiveError: '无法生成观点。请重试。', retry: '重试', sendQuestion: '发送问题', objectionStarter: '对这一建模细分人群而言，最重要的异议可能是什么？什么因素可能减轻它？', counterfactualStarter: '如果这一条件发生变化，这一观点会如何改变？', comparisonStarter: '在其他条件相同的情况下，比较对概念 A 和概念 B 的反应。' },
  'ja-JP': { exploreModeledSegment: 'モデル化されたセグメントを探索', exploreSegment: 'セグメントを探索', syntheticSegmentExploration: '合成セグメント探索', followUpSegment: 'このモデル化されたセグメントを掘り下げる', modeledSegmentNote: 'モデルが構成したセグメントであり、抽出標本ではありません。', yourQuestion: '質問', evidenceAndAssumptions: '使用した根拠と前提', assumptionsUsed: '使用した前提', noPerspectiveEvidence: 'この見解について外部根拠は記録されていません。', noAssumptionsRecorded: '追加の前提は記録されていません。', generatingPerspective: '見解を生成中…', perspectiveReady: '見解の準備ができました', perspectiveModes: '探索方法', testObjection: '反論を検討する', exploreCounterfactual: '反実仮想を検討する', compareConcepts: '2つのコンセプトを比較する', changedCondition: '変更する条件', fixedConditions: '固定する条件', defaultFixedConditions: 'セグメント、母集団フレーム、根拠は変更しません。', conceptA: 'コンセプト A', conceptB: 'コンセプト B', askFollowUp: '追加の質問をする', followUpPlaceholder: 'このモデル化されたセグメントが、特定の条件・反論・比較にどう反応し得るかを質問してください。', perspectiveError: '見解を生成できませんでした。もう一度お試しください。', retry: '再試行', sendQuestion: '質問を送信', objectionStarter: 'このモデル化されたセグメントにとって最も重要な反論は何で、何がそれを和らげるでしょうか？', counterfactualStarter: 'この条件が変わった場合、この見解はどう変わるでしょうか？', comparisonStarter: '他の条件を同じにしたまま、コンセプト A とコンセプト B への反応を比較してください。' },
  'ko-KR': { exploreModeledSegment: '모델링된 세그먼트 탐색', exploreSegment: '세그먼트 탐색', syntheticSegmentExploration: '합성 세그먼트 탐색', followUpSegment: '이 모델링된 세그먼트 더 살펴보기', modeledSegmentNote: '모델이 구성한 세그먼트이며 표본 추출 집단이 아닙니다.', yourQuestion: '질문', evidenceAndAssumptions: '사용한 근거와 가정', assumptionsUsed: '사용한 가정', noPerspectiveEvidence: '이 관점을 뒷받침하는 외부 근거가 기록되지 않았습니다.', noAssumptionsRecorded: '추가 가정이 기록되지 않았습니다.', generatingPerspective: '관점 생성 중…', perspectiveReady: '관점 준비 완료', perspectiveModes: '탐색 방식', testObjection: '반론 테스트', exploreCounterfactual: '반사실 시나리오 탐색', compareConcepts: '두 콘셉트 비교', changedCondition: '변경된 조건', fixedConditions: '고정 조건', defaultFixedConditions: '세그먼트, 모집단 프레임, 근거는 그대로 유지합니다.', conceptA: '콘셉트 A', conceptB: '콘셉트 B', askFollowUp: '후속 질문하기', followUpPlaceholder: '이 모델링된 세그먼트가 특정 조건, 반론 또는 비교에 어떻게 반응할 수 있는지 물어보세요.', perspectiveError: '관점을 생성할 수 없습니다. 다시 시도하세요.', retry: '다시 시도', sendQuestion: '질문 보내기', objectionStarter: '이 모델링된 세그먼트에 가장 중요한 반론은 무엇이며, 무엇이 이를 줄일 수 있을까요?', counterfactualStarter: '이 조건이 달라진다면 이 관점은 어떻게 바뀔까요?', comparisonStarter: '다른 조건은 동일하게 유지한 채 콘셉트 A와 콘셉트 B에 대한 반응을 비교하세요.' },
  'ar-SA': { exploreModeledSegment: 'استكشف الشريحة المُنمذجة', exploreSegment: 'استكشف الشريحة', syntheticSegmentExploration: 'استكشاف تركيبي للشريحة', followUpSegment: 'تعمّق في هذه الشريحة المُنمذجة', modeledSegmentNote: 'شريحة أنشأها النموذج وليست مجموعة عيّنة.', yourQuestion: 'سؤالك', evidenceAndAssumptions: 'الأدلة والافتراضات المستخدمة', assumptionsUsed: 'الافتراضات المستخدمة', noPerspectiveEvidence: 'لم تُسجَّل أدلة خارجية لهذه الرؤية.', noAssumptionsRecorded: 'لم تُسجَّل افتراضات إضافية.', generatingPerspective: 'جارٍ إنشاء الرؤية…', perspectiveReady: 'الرؤية جاهزة', perspectiveModes: 'طرق الاستكشاف', testObjection: 'اختبر اعتراضاً', exploreCounterfactual: 'استكشف سيناريو مخالفاً للواقع', compareConcepts: 'قارن بين مفهومين', changedCondition: 'الشرط المتغيّر', fixedConditions: 'الشروط الثابتة', defaultFixedConditions: 'أبقِ الشريحة وإطار السكان والأدلة دون تغيير.', conceptA: 'المفهوم أ', conceptB: 'المفهوم ب', askFollowUp: 'اطرح سؤال متابعة', followUpPlaceholder: 'اسأل كيف يمكن أن تتفاعل هذه الشريحة المُنمذجة مع شرط أو اعتراض أو مقارنة محددة.', perspectiveError: 'تعذّر إنشاء الرؤية. حاول مرة أخرى.', retry: 'إعادة المحاولة', sendQuestion: 'إرسال السؤال', objectionStarter: 'ما الاعتراض الأهم لهذه الشريحة المُنمذجة، وما الذي قد يخفف منه؟', counterfactualStarter: 'كيف ستتغير هذه الرؤية إذا تغيّر هذا الشرط؟', comparisonStarter: 'قارن الاستجابة للمفهوم أ والمفهوم ب مع إبقاء الشروط الأخرى متساوية.' },
  'hi-IN': { exploreModeledSegment: 'मॉडल किए गए सेगमेंट को देखें', exploreSegment: 'सेगमेंट देखें', syntheticSegmentExploration: 'सिंथेटिक सेगमेंट अन्वेषण', followUpSegment: 'इस मॉडल किए गए सेगमेंट को और समझें', modeledSegmentNote: 'यह मॉडल द्वारा बनाया गया सेगमेंट है; यह नमूना लिया गया समूह नहीं है।', yourQuestion: 'आपका प्रश्न', evidenceAndAssumptions: 'उपयोग किए गए साक्ष्य और मान्यताएँ', assumptionsUsed: 'उपयोग की गई मान्यताएँ', noPerspectiveEvidence: 'इस दृष्टिकोण के लिए कोई बाहरी साक्ष्य दर्ज नहीं है।', noAssumptionsRecorded: 'कोई अतिरिक्त मान्यता दर्ज नहीं है।', generatingPerspective: 'दृष्टिकोण बनाया जा रहा है…', perspectiveReady: 'दृष्टिकोण तैयार है', perspectiveModes: 'अन्वेषण के तरीके', testObjection: 'आपत्ति जाँचें', exploreCounterfactual: 'प्रतितथ्य स्थिति देखें', compareConcepts: 'दो अवधारणाओं की तुलना करें', changedCondition: 'बदली हुई शर्त', fixedConditions: 'स्थिर शर्तें', defaultFixedConditions: 'सेगमेंट, जनसंख्या फ्रेम और साक्ष्य को अपरिवर्तित रखें।', conceptA: 'अवधारणा A', conceptB: 'अवधारणा B', askFollowUp: 'अनुवर्ती प्रश्न पूछें', followUpPlaceholder: 'पूछें कि यह मॉडल किया गया सेगमेंट किसी विशेष शर्त, आपत्ति या तुलना पर कैसे प्रतिक्रिया दे सकता है।', perspectiveError: 'दृष्टिकोण तैयार नहीं किया जा सका। फिर से प्रयास करें।', retry: 'फिर से प्रयास करें', sendQuestion: 'प्रश्न भेजें', objectionStarter: 'इस मॉडल किए गए सेगमेंट के लिए सबसे महत्वपूर्ण आपत्ति क्या हो सकती है, और क्या उसे कम कर सकता है?', counterfactualStarter: 'यदि यह शर्त बदल जाए, तो यह दृष्टिकोण कैसे बदलेगा?', comparisonStarter: 'अन्य शर्तों को समान रखते हुए अवधारणा A और अवधारणा B की प्रतिक्रिया की तुलना करें।' },
};

const marketRoutingTranslations = {
  'en-US': {
    marketRoutingOnlyTitle: '{market}: market routing only',
    marketRoutingOnlyBody: 'Population framing and retrieval use {market} ({countryCode}). Market-specific language packs are not available yet.',
    marketRoutingOnlyLocalesLabel: 'Planned, unavailable locales',
    marketRoutingOnlyLanguageState: 'Interface: {interfaceLanguage} · report: {reportLanguage} · instrument: {instrumentLanguage}. These are not {market}-localized releases.',
    marketRoutingOnlyCurrencyNote: 'Price fields currently use {currentCurrency}; the local currency for {market} is {marketCurrency}.',
    marketLocalizedOutputTitle: '{market}: localized study output available',
    marketLocalizedOutputBody: 'Population framing and retrieval use {market} ({countryCode}). Report, source, retrieval, instrument, and sample output are enabled for {outputLocales}; the app interface is not localized for that locale yet.',
    marketLocalizedOutputLocalesLabel: 'Output-enabled locale',
    marketLocalizedOutputLanguageState: 'Interface: {interfaceLanguage} · report: {reportLanguage} · instrument: {instrumentLanguage}. Interface localization is separate from localized study output.',
    useMarketCurrency: 'Use {currency}',
    languageAlignmentTitle: 'Study languages differ from the interface',
    languageAlignmentBody: 'This study keeps its existing report and instrument languages unless you change them. Research inputs are never translated automatically.',
    alignStudyLanguages: 'Use {interfaceLanguage} for report and instrument',
    reviewLanguageSettings: 'Review language settings',
  },
  'es-ES': {
    marketRoutingOnlyTitle: '{market}: solo enrutamiento de mercado',
    marketRoutingOnlyBody: 'El marco poblacional y la recuperación de fuentes usan {market} ({countryCode}). Los paquetes de idioma específicos del mercado aún no están disponibles.',
    marketRoutingOnlyLocalesLabel: 'Variantes previstas y no disponibles',
    marketRoutingOnlyLanguageState: 'Interfaz: {interfaceLanguage} · informe: {reportLanguage} · instrumento: {instrumentLanguage}. No son versiones localizadas para {market}.',
    marketRoutingOnlyCurrencyNote: 'Los campos de precio usan {currentCurrency}; la moneda local de {market} es {marketCurrency}.',
    useMarketCurrency: 'Usar {currency}',
    languageAlignmentTitle: 'Los idiomas del estudio difieren del idioma de la interfaz',
    languageAlignmentBody: 'Este estudio conserva los idiomas actuales del informe y del instrumento salvo que los cambies. Las entradas de investigación nunca se traducen automáticamente.',
    alignStudyLanguages: 'Usar {interfaceLanguage} para el informe y el instrumento',
    reviewLanguageSettings: 'Revisar los ajustes de idioma',
  },
  'pt-BR': {
    marketRoutingOnlyTitle: '{market}: somente roteamento de mercado',
    marketRoutingOnlyBody: 'O enquadramento populacional e a recuperação de fontes usam {market} ({countryCode}). Os pacotes de idioma específicos do mercado ainda não estão disponíveis.',
    marketRoutingOnlyLocalesLabel: 'Variantes planejadas e indisponíveis',
    marketRoutingOnlyLanguageState: 'Interface: {interfaceLanguage} · relatório: {reportLanguage} · instrumento: {instrumentLanguage}. Estas não são versões localizadas para {market}.',
    marketRoutingOnlyCurrencyNote: 'Os campos de preço usam {currentCurrency}; a moeda local de {market} é {marketCurrency}.',
    useMarketCurrency: 'Usar {currency}',
    languageAlignmentTitle: 'Os idiomas do estudo diferem do idioma da interface',
    languageAlignmentBody: 'Este estudo mantém os idiomas atuais do relatório e do instrumento, a menos que você os altere. As entradas da pesquisa nunca são traduzidas automaticamente.',
    alignStudyLanguages: 'Usar {interfaceLanguage} no relatório e no instrumento',
    reviewLanguageSettings: 'Revisar configurações de idioma',
  },
  'fr-FR': {
    marketRoutingOnlyTitle: '{market} : routage de marché uniquement',
    marketRoutingOnlyBody: 'Le cadrage de population et la recherche de sources utilisent {market} ({countryCode}). Les variantes linguistiques propres au marché ne sont pas encore disponibles.',
    marketRoutingOnlyLocalesLabel: 'Variantes prévues et indisponibles',
    marketRoutingOnlyLanguageState: 'Interface : {interfaceLanguage} · rapport : {reportLanguage} · questionnaire : {instrumentLanguage}. Il ne s’agit pas de versions localisées pour {market}.',
    marketRoutingOnlyCurrencyNote: 'Les champs de prix utilisent {currentCurrency} ; la devise locale de {market} est {marketCurrency}.',
    useMarketCurrency: 'Utiliser {currency}',
    languageAlignmentTitle: 'Les langues de l’étude diffèrent de celle de l’interface',
    languageAlignmentBody: 'Cette étude conserve les langues actuelles du rapport et du questionnaire sauf si vous les modifiez. Les contenus de recherche ne sont jamais traduits automatiquement.',
    alignStudyLanguages: 'Utiliser {interfaceLanguage} pour le rapport et le questionnaire',
    reviewLanguageSettings: 'Vérifier les paramètres de langue',
  },
  'de-DE': {
    marketRoutingOnlyTitle: '{market}: nur Marktrouting',
    marketRoutingOnlyBody: 'Populationsrahmen und Quellenabruf verwenden {market} ({countryCode}). Marktspezifische Sprachvarianten sind noch nicht verfügbar.',
    marketRoutingOnlyLocalesLabel: 'Geplante, nicht verfügbare Varianten',
    marketRoutingOnlyLanguageState: 'Oberfläche: {interfaceLanguage} · Bericht: {reportLanguage} · Instrument: {instrumentLanguage}. Dies sind keine für {market} lokalisierten Versionen.',
    marketRoutingOnlyCurrencyNote: 'Preisfelder verwenden derzeit {currentCurrency}; die lokale Währung für {market} ist {marketCurrency}.',
    useMarketCurrency: '{currency} verwenden',
    languageAlignmentTitle: 'Die Studiensprachen weichen von der Oberflächensprache ab',
    languageAlignmentBody: 'Diese Studie behält die vorhandenen Berichts- und Instrumentensprachen bei, sofern Sie sie nicht ändern. Forschungseingaben werden nie automatisch übersetzt.',
    alignStudyLanguages: '{interfaceLanguage} für Bericht und Instrument verwenden',
    reviewLanguageSettings: 'Spracheinstellungen prüfen',
  },
  'zh-CN': {
    marketRoutingOnlyTitle: '{market}：仅支持市场路由',
    marketRoutingOnlyBody: '总体框定和来源检索使用 {market}（{countryCode}）。尚未提供该市场专用的语言版本。',
    marketRoutingOnlyLocalesLabel: '已规划但尚不可用的地区语言',
    marketRoutingOnlyLanguageState: '界面：{interfaceLanguage} · 报告：{reportLanguage} · 调查工具：{instrumentLanguage}。这些并非面向 {market} 发布的本地化版本。',
    marketRoutingOnlyCurrencyNote: '价格字段当前使用 {currentCurrency}；{market} 的本地货币为 {marketCurrency}。',
    marketLocalizedOutputTitle: '{market}：已启用本地化研究输出',
    marketLocalizedOutputBody: '总体框定和来源检索使用 {market}（{countryCode}）。已为 {outputLocales} 启用报告、来源、检索、调查工具和示例输出；应用界面尚未为该语言本地化。',
    marketLocalizedOutputLocalesLabel: '已启用输出的语言',
    marketLocalizedOutputLanguageState: '界面：{interfaceLanguage} · 报告：{reportLanguage} · 调查工具：{instrumentLanguage}。界面本地化与本地化研究输出是分开的。',
    useMarketCurrency: '使用 {currency}',
    languageAlignmentTitle: '研究语言与界面语言不同',
    languageAlignmentBody: '除非你更改设置，本研究会保留现有的报告和调查工具语言。研究输入绝不会被自动翻译。',
    alignStudyLanguages: '报告和调查工具使用{interfaceLanguage}',
    reviewLanguageSettings: '检查语言设置',
  },
  'ja-JP': {
    marketRoutingOnlyTitle: '{market}：市場ルーティングのみ',
    marketRoutingOnlyBody: '母集団フレームと情報源の検索には {market}（{countryCode}）を使用します。この市場向けの言語版はまだ利用できません。',
    marketRoutingOnlyLocalesLabel: '予定済み・未提供のロケール',
    marketRoutingOnlyLanguageState: 'インターフェース：{interfaceLanguage} · レポート：{reportLanguage} · 調査票：{instrumentLanguage}。これらは {market} 向けにローカライズされたリリースではありません。',
    marketRoutingOnlyCurrencyNote: '価格欄は現在 {currentCurrency} を使用しています。{market} の現地通貨は {marketCurrency} です。',
    marketLocalizedOutputTitle: '{market}：ローカライズ済み調査出力を利用できます',
    marketLocalizedOutputBody: '母集団フレームと情報源の検索には {market}（{countryCode}）を使用します。{outputLocales} では、レポート、情報源、検索、調査票、サンプル出力が有効です。アプリのインターフェースはまだそのロケールに対応していません。',
    marketLocalizedOutputLocalesLabel: '出力が有効なロケール',
    marketLocalizedOutputLanguageState: 'インターフェース：{interfaceLanguage} · レポート：{reportLanguage} · 調査票：{instrumentLanguage}。インターフェースのローカライズと調査出力のローカライズは別です。',
    useMarketCurrency: '{currency} を使用',
    languageAlignmentTitle: '調査の言語がインターフェース言語と異なります',
    languageAlignmentBody: '設定を変更しない限り、現在のレポート言語と調査票言語を維持します。調査入力が自動翻訳されることはありません。',
    alignStudyLanguages: 'レポートと調査票に{interfaceLanguage}を使用',
    reviewLanguageSettings: '言語設定を確認',
  },
  'ko-KR': {
    marketRoutingOnlyTitle: '{market}: 시장 라우팅만 지원',
    marketRoutingOnlyBody: '모집단 프레임과 출처 검색에는 {market}({countryCode})을 사용합니다. 이 시장 전용 언어 버전은 아직 제공되지 않습니다.',
    marketRoutingOnlyLocalesLabel: '계획되었지만 아직 사용할 수 없는 로케일',
    marketRoutingOnlyLanguageState: '인터페이스: {interfaceLanguage} · 보고서: {reportLanguage} · 조사 도구: {instrumentLanguage}. 이는 {market}용으로 현지화해 출시한 버전이 아닙니다.',
    marketRoutingOnlyCurrencyNote: '가격 필드는 현재 {currentCurrency}을(를) 사용합니다. {market}의 현지 통화는 {marketCurrency}입니다.',
    marketLocalizedOutputTitle: '{market}: 현지화된 조사 출력 사용 가능',
    marketLocalizedOutputBody: '모집단 프레임과 출처 검색에는 {market}({countryCode})을 사용합니다. {outputLocales}에는 보고서, 출처, 검색, 조사 도구 및 샘플 출력이 활성화되어 있지만 앱 인터페이스는 아직 해당 로케일로 현지화되지 않았습니다.',
    marketLocalizedOutputLocalesLabel: '출력 활성화 로케일',
    marketLocalizedOutputLanguageState: '인터페이스: {interfaceLanguage} · 보고서: {reportLanguage} · 조사 도구: {instrumentLanguage}. 인터페이스 현지화와 현지화된 조사 출력은 별개입니다.',
    useMarketCurrency: '{currency} 사용',
    languageAlignmentTitle: '조사 언어가 인터페이스 언어와 다릅니다',
    languageAlignmentBody: '설정을 변경하지 않으면 현재 보고서 및 조사 도구 언어가 유지됩니다. 조사 입력은 자동으로 번역되지 않습니다.',
    alignStudyLanguages: '보고서와 조사 도구에 {interfaceLanguage} 사용',
    reviewLanguageSettings: '언어 설정 검토',
  },
  'ar-SA': {
    marketRoutingOnlyTitle: '{market}: توجيه السوق فقط',
    marketRoutingOnlyBody: 'يستخدم إطار السكان واسترجاع المصادر {market} ({countryCode}). حزم اللغات الخاصة بهذا السوق غير متاحة بعد.',
    marketRoutingOnlyLocalesLabel: 'لغات محلية مخططة وغير متاحة',
    marketRoutingOnlyLanguageState: 'الواجهة: {interfaceLanguage} · التقرير: {reportLanguage} · أداة البحث: {instrumentLanguage}. هذه ليست إصدارات موطنة لسوق {market}.',
    marketRoutingOnlyCurrencyNote: 'تستخدم حقول السعر حالياً {currentCurrency}؛ العملة المحلية في {market} هي {marketCurrency}.',
    useMarketCurrency: 'استخدام {currency}',
    languageAlignmentTitle: 'لغات الدراسة تختلف عن لغة الواجهة',
    languageAlignmentBody: 'تحتفظ هذه الدراسة بلغتي التقرير والأداة الحاليتين ما لم تغيّرهما. لا تُترجم مدخلات البحث تلقائياً أبداً.',
    alignStudyLanguages: 'استخدام {interfaceLanguage} للتقرير والأداة',
    reviewLanguageSettings: 'مراجعة إعدادات اللغة',
  },
  'hi-IN': {
    marketRoutingOnlyTitle: '{market}: केवल बाज़ार रूटिंग',
    marketRoutingOnlyBody: 'जनसंख्या फ्रेम और स्रोत पुनर्प्राप्ति के लिए {market} ({countryCode}) का उपयोग होता है। इस बाज़ार के भाषा पैक अभी उपलब्ध नहीं हैं।',
    marketRoutingOnlyLocalesLabel: 'नियोजित, अनुपलब्ध लोकेल',
    marketRoutingOnlyLanguageState: 'इंटरफ़ेस: {interfaceLanguage} · रिपोर्ट: {reportLanguage} · शोध उपकरण: {instrumentLanguage}। ये {market} के लिए स्थानीयकृत रिलीज़ नहीं हैं।',
    marketRoutingOnlyCurrencyNote: 'मूल्य फ़ील्ड अभी {currentCurrency} का उपयोग करते हैं; {market} की स्थानीय मुद्रा {marketCurrency} है।',
    useMarketCurrency: '{currency} उपयोग करें',
    languageAlignmentTitle: 'अध्ययन की भाषाएँ इंटरफ़ेस भाषा से अलग हैं',
    languageAlignmentBody: 'जब तक आप इन्हें बदलते नहीं, यह अध्ययन रिपोर्ट और शोध उपकरण की मौजूदा भाषाएँ बनाए रखता है। शोध इनपुट का कभी स्वतः अनुवाद नहीं होता।',
    alignStudyLanguages: 'रिपोर्ट और शोध उपकरण के लिए {interfaceLanguage} उपयोग करें',
    reviewLanguageSettings: 'भाषा सेटिंग जाँचें',
  },
};

const uxKeys = [
  'firstRunKicker', 'firstRunTitle', 'firstRunDescription', 'startStudy', 'viewExample',
  'firstRunBoundary', 'exampleReportLabel', 'exampleReportDescription', 'optionalContext',
  'addPublicSource', 'evidenceSourceLabel', 'questionPlaceholder', 'readinessMissing',
  'readinessReady', 'readinessAtLeastCharacters', 'readinessAtMostCharacters',
  'readinessAtLeastItems', 'readinessAtMostItems', 'readinessUniqueItems',
  'readinessPositiveNumber', 'readinessValidCurrency', 'readinessSelectOption',
  'readinessAscending', 'focusRequirement', 'readinessFocusHint', 'reportSection',
  'likelyOrVeryLikely', 'nextSteps', 'humanResearchDraftBoundary', 'opensInNewWindow',
  'population', 'researchMaterials', 'none', 'autoEvidence', 'quickResearchNote',
  'deepResearchNote', 'runInProgressTitle', 'runInProgressSummary', 'planned', 'readinessMore',
  'modelConstructedSegment', 'seeHumanValidationPlan', 'humanValidationPlanAfterRun',
  'startNewStudyConfirm', 'skipToWorkspace',
];

const uxValues = {
  'en-US': [
    'For market researchers · free · no account required', 'Free synthetic market research',
    'Generate synthetic data for concept tests, audience hypotheses, messages, pricing, and research planning—with disclosed sources, assumptions, and limitations.',
    'Start study', 'View example',
    'Model-generated synthetic data—not observed survey responses, a representative sample, or evidence about a real population.',
    'Example report · not a run', 'Illustrative content only. It was not generated from your brief.',
    'Optional context', 'Add public source', 'Evidence source {count}', 'What do you want to learn or decide?',
    '{count} requirement(s) missing', 'Ready to run', 'Enter at least {count} characters',
    'Use no more than {count} characters', 'Add at least {count} items', 'Use no more than {count} items',
    'Each item needs a unique identifier', 'Enter a number greater than zero',
    'Use a three-letter currency code, such as USD', 'Select a valid option',
    'Order prices from lowest to highest', 'Go to {requirement}', 'The first incomplete requirement is focused.',
    'Report section', 'likely or very likely', 'Next steps',
    'Human research handoff—planning materials only. Likerts has not recruited, screened, contacted, or surveyed anyone. Sample size, incidence, feasibility, timing, and cost remain planning estimates until confirmed by a researcher and provider.',
    'Opens in a new window', 'Population', 'Research materials', 'None',
    'We’ll check up to two public sources and show what influenced the read. If none are available, the result is model-only.',
    'Faster directional read using available public sources.',
    'More model passes and disagreement checks; takes longer.',
    'Your study is running', 'Stage completion appears only after the server confirms it.', 'Planned', '{count} more requirement(s) will appear after you try to run.', 'Model-constructed segment · no sampled n',
    'See human validation plan', 'A human-research handoff becomes available after you complete a run.',
    'Start a new study? This clears the current brief, results, research materials, and modeled conversations.', 'Skip to workspace',
  ],
  'es-ES': [
    'Sin cuenta', 'Empieza con una pregunta de investigación',
    'Define la pregunta, la audiencia y el método. Likerts mostrará las fuentes, los supuestos y los límites de población detrás del resultado.',
    'Empezar estudio', 'Ver ejemplo',
    'El resultado sintético es direccional y generado por modelos. No se recluta ni encuesta a nadie.',
    'Informe de ejemplo · no es una ejecución', 'Contenido ilustrativo únicamente. No se generó a partir de tu resumen.',
    'Contexto opcional', 'Añadir fuente pública', 'Fuente de evidencia {count}', '¿Qué quieres aprender o decidir?',
    'Faltan {count} requisito(s)', 'Listo para ejecutar', 'Introduce al menos {count} caracteres',
    'Usa como máximo {count} caracteres', 'Añade al menos {count} elementos', 'Usa como máximo {count} elementos',
    'Cada elemento necesita un identificador único', 'Introduce un número mayor que cero',
    'Usa un código de moneda de tres letras, como EUR', 'Selecciona una opción válida',
    'Ordena los precios de menor a mayor', 'Ir a {requirement}', 'Se enfocó el primer requisito incompleto.',
    'Sección del informe', 'probable o muy probable', 'Siguientes pasos',
    'Entrega para investigación humana: solo materiales de planificación. Likerts no ha reclutado, filtrado, contactado ni encuestado a nadie. El tamaño de muestra, la incidencia, la viabilidad, los plazos y el coste siguen siendo estimaciones hasta que los confirmen un investigador y un proveedor.',
    'Se abre en una ventana nueva', 'Población', 'Materiales de investigación', 'Ninguno',
    'Comprobaremos hasta dos fuentes públicas y mostraremos qué influyó en la lectura. Si no hay ninguna, el resultado se basará solo en el modelo.',
    'Lectura direccional más rápida con las fuentes públicas disponibles.',
    'Más pasadas de modelo y controles de discrepancias; tarda más.',
    'El estudio se está ejecutando', 'La finalización de cada etapa solo aparece cuando la confirma el servidor.', 'Planificada', 'Se mostrarán {count} requisito(s) más cuando intentes ejecutar.', 'Segmento construido por el modelo · sin n muestral',
    'Ver el plan de validación humana', 'La entrega para investigación humana estará disponible después de completar una ejecución.',
    '¿Empezar un estudio nuevo? Esto borrará el resumen, los resultados, los materiales de investigación y las conversaciones modeladas actuales.', 'Saltar al espacio de trabajo',
  ],
  'pt-BR': [
    'Sem conta', 'Comece com uma pergunta de pesquisa',
    'Defina a pergunta, o público e o método. O Likerts mostrará as fontes, as premissas e os limites populacionais por trás do resultado.',
    'Começar estudo', 'Ver exemplo',
    'O resultado sintético é direcional e gerado por modelos. Ninguém é recrutado ou entrevistado.',
    'Relatório de exemplo · não é uma execução', 'Conteúdo apenas ilustrativo. Não foi gerado a partir do seu briefing.',
    'Contexto opcional', 'Adicionar fonte pública', 'Fonte de evidência {count}', 'O que você quer aprender ou decidir?',
    'Faltam {count} requisito(s)', 'Pronto para executar', 'Insira pelo menos {count} caracteres',
    'Use no máximo {count} caracteres', 'Adicione pelo menos {count} itens', 'Use no máximo {count} itens',
    'Cada item precisa de um identificador exclusivo', 'Insira um número maior que zero',
    'Use um código de moeda com três letras, como BRL', 'Selecione uma opção válida',
    'Ordene os preços do menor para o maior', 'Ir para {requirement}', 'O primeiro requisito incompleto recebeu foco.',
    'Seção do relatório', 'provável ou muito provável', 'Próximos passos',
    'Entrega para pesquisa humana — somente materiais de planejamento. O Likerts não recrutou, selecionou, contatou ou entrevistou ninguém. Tamanho da amostra, incidência, viabilidade, prazo e custo continuam sendo estimativas até confirmação por um pesquisador e um fornecedor.',
    'Abre em uma nova janela', 'População', 'Materiais de pesquisa', 'Nenhum',
    'Verificaremos até duas fontes públicas e mostraremos o que influenciou a leitura. Se nenhuma estiver disponível, o resultado será somente do modelo.',
    'Leitura direcional mais rápida com as fontes públicas disponíveis.',
    'Mais passagens de modelo e verificações de divergência; leva mais tempo.',
    'Seu estudo está em execução', 'A conclusão das etapas só aparece após confirmação do servidor.', 'Planejada', 'Mais {count} requisito(s) aparecerão quando você tentar executar.', 'Segmento construído pelo modelo · sem n amostral',
    'Ver plano de validação humana', 'A entrega para pesquisa humana ficará disponível após a conclusão de uma execução.',
    'Iniciar um novo estudo? Isso apagará o briefing, os resultados, os materiais de pesquisa e as conversas modeladas atuais.', 'Ir para o espaço de trabalho',
  ],
  'fr-FR': [
    'Aucun compte requis', 'Commencez par une question de recherche',
    'Définissez la question, l’audience et la méthode. Likerts indiquera les sources, les hypothèses et les limites de population qui fondent le résultat.',
    'Commencer l’étude', 'Voir un exemple',
    'Le résultat synthétique est directionnel et généré par des modèles. Personne n’est recruté ni interrogé.',
    'Rapport d’exemple · pas une exécution', 'Contenu purement illustratif. Il n’a pas été généré à partir de votre brief.',
    'Contexte facultatif', 'Ajouter une source publique', 'Source de preuve {count}', 'Que souhaitez-vous apprendre ou décider ?',
    '{count} exigence(s) manquante(s)', 'Prêt à lancer', 'Saisissez au moins {count} caractères',
    'Utilisez au maximum {count} caractères', 'Ajoutez au moins {count} éléments', 'Utilisez au maximum {count} éléments',
    'Chaque élément doit avoir un identifiant unique', 'Saisissez un nombre supérieur à zéro',
    'Utilisez un code devise à trois lettres, comme EUR', 'Sélectionnez une option valide',
    'Classez les prix du plus bas au plus élevé', 'Aller à {requirement}', 'Le premier élément incomplet a reçu le focus.',
    'Section du rapport', 'probable ou très probable', 'Prochaines étapes',
    'Transmission pour recherche humaine — documents de planification uniquement. Likerts n’a recruté, filtré, contacté ni interrogé personne. La taille de l’échantillon, l’incidence, la faisabilité, le calendrier et le coût restent des estimations jusqu’à confirmation par un chercheur et un fournisseur.',
    'S’ouvre dans une nouvelle fenêtre', 'Population', 'Documents de recherche', 'Aucun',
    'Nous vérifierons jusqu’à deux sources publiques et montrerons ce qui a influencé la lecture. Si aucune n’est disponible, le résultat repose uniquement sur le modèle.',
    'Lecture directionnelle plus rapide avec les sources publiques disponibles.',
    'Davantage de passages de modèles et de contrôles de désaccord ; plus lent.',
    'Votre étude est en cours', 'La fin d’une étape ne s’affiche qu’après confirmation du serveur.', 'Planifiée', '{count} exigence(s) supplémentaire(s) apparaîtront lorsque vous tenterez de lancer.', 'Segment construit par le modèle · aucun n échantillonné',
    'Voir le plan de validation humaine', 'Le dossier de transfert vers une recherche humaine sera disponible après une exécution terminée.',
    'Commencer une nouvelle étude ? Le brief, les résultats, les documents de recherche et les conversations modélisées actuels seront effacés.', 'Aller à l’espace de travail',
  ],
  'de-DE': [
    'Kein Konto erforderlich', 'Mit einer Forschungsfrage beginnen',
    'Definieren Sie Frage, Zielgruppe und Methode. Likerts legt die Quellen, Annahmen und Populationsgrenzen hinter dem Ergebnis offen.',
    'Studie beginnen', 'Beispiel ansehen',
    'Die synthetische Ausgabe ist richtungsweisend und modellgeneriert. Es werden keine Menschen rekrutiert oder befragt.',
    'Beispielbericht · kein Lauf', 'Nur illustrativer Inhalt. Er wurde nicht aus Ihrem Brief erstellt.',
    'Optionaler Kontext', 'Öffentliche Quelle hinzufügen', 'Evidenzquelle {count}', 'Was möchten Sie lernen oder entscheiden?',
    '{count} Anforderung(en) fehlen', 'Bereit zum Start', 'Mindestens {count} Zeichen eingeben',
    'Höchstens {count} Zeichen verwenden', 'Mindestens {count} Elemente hinzufügen', 'Höchstens {count} Elemente verwenden',
    'Jedes Element benötigt eine eindeutige Kennung', 'Eine Zahl größer als null eingeben',
    'Einen dreistelligen Währungscode wie EUR verwenden', 'Eine gültige Option auswählen',
    'Preise aufsteigend sortieren', 'Zu {requirement}', 'Die erste unvollständige Anforderung wurde fokussiert.',
    'Berichtsabschnitt', 'wahrscheinlich oder sehr wahrscheinlich', 'Nächste Schritte',
    'Übergabe für Forschung mit Menschen — nur Planungsunterlagen. Likerts hat niemanden rekrutiert, geprüft, kontaktiert oder befragt. Stichprobengröße, Inzidenz, Machbarkeit, Zeitplan und Kosten bleiben Schätzungen, bis Forschende und Anbieter sie bestätigen.',
    'Öffnet in einem neuen Fenster', 'Population', 'Forschungsmaterialien', 'Keine',
    'Wir prüfen bis zu zwei öffentliche Quellen und zeigen, was die Einschätzung beeinflusst hat. Sind keine verfügbar, basiert das Ergebnis nur auf dem Modell.',
    'Schnellere Richtungseinschätzung mit verfügbaren öffentlichen Quellen.',
    'Mehr Modelldurchläufe und Abweichungsprüfungen; dauert länger.',
    'Ihre Studie läuft', 'Ein Etappenabschluss erscheint erst nach Bestätigung durch den Server.', 'Geplant', '{count} weitere Anforderung(en) erscheinen nach dem Startversuch.', 'Modellkonstruiertes Segment · kein Stichproben-n',
    'Plan für Humanvalidierung ansehen', 'Eine Übergabe an Humanforschung ist nach einem abgeschlossenen Lauf verfügbar.',
    'Neue Studie beginnen? Dadurch werden der aktuelle Brief, Ergebnisse, Forschungsmaterialien und modellierte Gespräche gelöscht.', 'Zum Arbeitsbereich springen',
  ],
  'zh-CN': [
    '无需账户', '从研究问题开始',
    '定义问题、受众和方法。Likerts 会披露结果所依据的来源、假设和人群限制。',
    '开始研究', '查看示例',
    '合成输出仅用于方向判断，由模型生成。没有招募或调查任何人。',
    '示例报告 · 不是实际运行', '仅为示意内容，并非根据你的简报生成。',
    '可选背景', '添加公开来源', '证据来源 {count}', '你想了解什么或做出什么决定？',
    '缺少 {count} 项要求', '可以运行', '至少输入 {count} 个字符',
    '最多使用 {count} 个字符', '至少添加 {count} 项', '最多使用 {count} 项',
    '每一项都需要唯一标识符', '请输入大于零的数字',
    '请使用三位货币代码，例如 CNY', '请选择有效选项',
    '请按从低到高排列价格', '前往{requirement}', '已聚焦第一个未完成的要求。',
    '报告部分', '可能或非常可能', '后续步骤',
    '真人研究交接——仅限规划材料。Likerts 未招募、筛选、联系或调查任何人。样本量、发生率、可行性、时间和成本均为规划估计，须由研究人员和供应商确认。',
    '在新窗口中打开', '人群', '研究材料', '无',
    '我们会检查最多两个公开来源，并说明哪些信息影响了判断。如无可用来源，结果仅来自模型。',
    '使用可用公开来源，更快获得方向性判断。',
    '增加模型运行和分歧检查，因此需要更长时间。',
    '研究正在运行', '只有服务器确认后，才会显示阶段完成。', '计划中', '尝试运行后将显示另外 {count} 项要求。', '模型构建的细分人群 · 无抽样 n',
    '查看真人验证计划', '完成一次运行后，即可使用真人研究交接资料。',
    '开始新研究？这将清除当前简报、结果、研究材料和建模对话。', '跳至工作区',
  ],
  'ja-JP': [
    'アカウント不要', '調査質問から始める',
    '質問、対象者、手法を定義します。Likerts は結果の根拠となる情報源、前提、母集団上の限界を開示します。',
    '調査を始める', '例を見る',
    '合成出力は方向性を示すモデル生成物です。人の募集や調査は行っていません。',
    'サンプルレポート · 実行結果ではありません', '説明用の内容です。あなたの概要から生成されたものではありません。',
    '任意の背景情報', '公開情報源を追加', '証拠情報源 {count}', '何を明らかにし、何を決めたいですか？',
    '{count} 件の要件が未完了です', '実行できます', '{count} 文字以上入力してください',
    '{count} 文字以内にしてください', '{count} 件以上追加してください', '{count} 件以内にしてください',
    '各項目には一意の識別子が必要です', '0 より大きい数を入力してください',
    'JPY など3文字の通貨コードを使用してください', '有効な選択肢を選んでください',
    '価格を低い順に並べてください', '{requirement}へ移動', '最初の未完了要件にフォーカスしました。',
    'レポートのセクション', '可能性が高い、または非常に高い', '次のステップ',
    '人による調査への引き継ぎ — 計画資料のみです。Likerts は誰も募集、選定、連絡、調査していません。サンプル数、発生率、実現可能性、期間、費用は、研究者と提供者が確認するまで計画上の推定値です。',
    '新しいウィンドウで開きます', '母集団', '調査資料', 'なし',
    '最大2件の公開情報源を確認し、判断に影響した内容を示します。利用できない場合、結果はモデルのみに基づきます。',
    '利用可能な公開情報源を使った、より速い方向性の確認です。',
    'モデル実行と不一致確認を増やすため、時間がかかります。',
    '調査を実行中です', '段階の完了はサーバー確認後にのみ表示されます。', '予定', '実行を試すと、残り {count} 件の要件が表示されます。', 'モデル構築セグメント · 抽出 n なし',
    '人による検証計画を見る', '実行が完了すると、人による調査への引き継ぎ資料を利用できます。',
    '新しい調査を始めますか？現在の概要、結果、調査資料、モデル化された会話が消去されます。', 'ワークスペースへ移動',
  ],
  'ko-KR': [
    '계정 불필요', '연구 질문으로 시작하기',
    '질문, 대상, 방법을 정의하세요. Likerts는 결과에 영향을 준 출처, 가정, 모집단 한계를 공개합니다.',
    '연구 시작', '예시 보기',
    '합성 결과는 방향성을 위한 모델 생성물입니다. 사람을 모집하거나 조사하지 않습니다.',
    '예시 보고서 · 실제 실행 아님', '설명용 콘텐츠입니다. 사용자의 브리프로 생성되지 않았습니다.',
    '선택적 배경 정보', '공개 출처 추가', '근거 출처 {count}', '무엇을 알아보거나 결정하고 싶으신가요?',
    '{count}개 요구사항이 남았습니다', '실행 준비 완료', '최소 {count}자를 입력하세요',
    '최대 {count}자까지 입력하세요', '최소 {count}개 항목을 추가하세요', '최대 {count}개 항목만 사용하세요',
    '각 항목에는 고유 식별자가 필요합니다', '0보다 큰 숫자를 입력하세요',
    'KRW와 같은 세 글자 통화 코드를 사용하세요', '유효한 옵션을 선택하세요',
    '가격을 낮은 순서에서 높은 순서로 정렬하세요', '{requirement}(으)로 이동', '첫 번째 미완료 요구사항에 포커스했습니다.',
    '보고서 섹션', '가능성 높음 또는 매우 높음', '다음 단계',
    '실제 사람 연구 인계 — 계획 자료 전용입니다. Likerts는 누구도 모집, 선별, 연락 또는 조사하지 않았습니다. 표본 크기, 발생률, 실행 가능성, 일정, 비용은 연구자와 제공업체가 확인하기 전까지 계획 추정치입니다.',
    '새 창에서 열림', '모집단', '연구 자료', '없음',
    '최대 두 개의 공개 출처를 확인하고 무엇이 판단에 영향을 주었는지 보여줍니다. 출처가 없으면 결과는 모델에만 기반합니다.',
    '사용 가능한 공개 출처로 더 빠르게 방향성을 확인합니다.',
    '모델 실행과 불일치 검사를 늘리므로 시간이 더 걸립니다.',
    '연구가 실행 중입니다', '단계 완료는 서버가 확인한 후에만 표시됩니다.', '예정', '실행을 시도하면 나머지 {count}개 요구사항이 표시됩니다.', '모델 구성 세그먼트 · 표본 n 없음',
    '실제 사람 검증 계획 보기', '실행을 완료하면 실제 사람 연구 인계 자료를 사용할 수 있습니다.',
    '새 연구를 시작할까요? 현재 브리프, 결과, 연구 자료 및 모델링된 대화가 삭제됩니다.', '작업 영역으로 건너뛰기',
  ],
  'ar-SA': [
    'لا يلزم حساب', 'ابدأ بسؤال بحثي',
    'حدّد السؤال والجمهور والمنهج. سيكشف Likerts المصادر والافتراضات وحدود السكان التي يستند إليها الناتج.',
    'بدء الدراسة', 'عرض مثال',
    'الناتج التركيبي اتجاهي ومولّد بالنماذج. لم يُجنّد أو يُستطلع أي شخص.',
    'تقرير توضيحي · ليس عملية تشغيل', 'محتوى توضيحي فقط، ولم يُنشأ من ملخصك.',
    'سياق اختياري', 'إضافة مصدر عام', 'مصدر الدليل {count}', 'ما الذي تريد معرفته أو اتخاذ قرار بشأنه؟',
    'ينقص {count} من المتطلبات', 'جاهز للتشغيل', 'أدخل {count} حرفاً على الأقل',
    'استخدم {count} حرفاً كحد أقصى', 'أضف {count} عناصر على الأقل', 'استخدم {count} عناصر كحد أقصى',
    'يحتاج كل عنصر إلى معرّف فريد', 'أدخل رقماً أكبر من الصفر',
    'استخدم رمز عملة من ثلاثة أحرف مثل SAR', 'اختر خياراً صالحاً',
    'رتّب الأسعار من الأدنى إلى الأعلى', 'انتقل إلى {requirement}', 'تم التركيز على أول متطلب غير مكتمل.',
    'قسم التقرير', 'مرجّح أو مرجّح جداً', 'الخطوات التالية',
    'تسليم للبحث البشري — مواد تخطيط فقط. لم يُجنّد Likerts أي شخص أو يفرزه أو يتواصل معه أو يستطلعه. يظل حجم العينة ومعدل الحدوث والجدوى والتوقيت والتكلفة تقديرات تخطيطية حتى يؤكدها باحث ومزوّد.',
    'يفتح في نافذة جديدة', 'السكان', 'مواد البحث', 'لا شيء',
    'سنتحقق من مصدرين عامين كحد أقصى ونوضح ما أثّر في القراءة. إن لم تتوفر مصادر، فسيستند الناتج إلى النموذج فقط.',
    'قراءة اتجاهية أسرع باستخدام المصادر العامة المتاحة.',
    'جولات نماذج وفحوص اختلاف أكثر؛ يستغرق وقتاً أطول.',
    'دراستك قيد التشغيل', 'لا يظهر اكتمال المرحلة إلا بعد تأكيد الخادم.', 'مخطط', 'ستظهر {count} متطلبات إضافية بعد محاولة التشغيل.', 'شريحة أنشأها النموذج · بلا حجم عينة',
    'عرض خطة التحقق البشري', 'يصبح تسليم البحث البشري متاحاً بعد إكمال عملية تشغيل.',
    'بدء دراسة جديدة؟ سيؤدي ذلك إلى مسح الملخص والنتائج ومواد البحث والمحادثات المُنمذجة الحالية.', 'التخطي إلى مساحة العمل',
  ],
  'hi-IN': [
    'खाता आवश्यक नहीं', 'एक शोध प्रश्न से शुरू करें',
    'प्रश्न, ऑडियंस और विधि तय करें। Likerts परिणाम के पीछे के स्रोत, मान्यताएँ और जनसंख्या सीमाएँ दिखाएगा।',
    'अध्ययन शुरू करें', 'उदाहरण देखें',
    'सिंथेटिक आउटपुट दिशात्मक और मॉडल-जनित है। किसी व्यक्ति को भर्ती या सर्वे नहीं किया जाता।',
    'उदाहरण रिपोर्ट · वास्तविक रन नहीं', 'केवल उदाहरणात्मक सामग्री। यह आपके ब्रीफ़ से नहीं बनाई गई।',
    'वैकल्पिक संदर्भ', 'सार्वजनिक स्रोत जोड़ें', 'साक्ष्य स्रोत {count}', 'आप क्या जानना या तय करना चाहते हैं?',
    '{count} आवश्यकता अभी बाकी', 'चलाने के लिए तैयार', 'कम से कम {count} अक्षर दर्ज करें',
    'अधिकतम {count} अक्षर रखें', 'कम से कम {count} आइटम जोड़ें', 'अधिकतम {count} आइटम रखें',
    'हर आइटम का अलग पहचानकर्ता होना चाहिए', 'शून्य से बड़ी संख्या दर्ज करें',
    'INR जैसा तीन-अक्षर का मुद्रा कोड इस्तेमाल करें', 'मान्य विकल्प चुनें',
    'कीमतों को कम से अधिक क्रम में रखें', '{requirement} पर जाएँ', 'पहली अधूरी आवश्यकता पर फ़ोकस किया गया।',
    'रिपोर्ट अनुभाग', 'संभावित या बहुत संभावित', 'अगले कदम',
    'मानवीय शोध हैंडऑफ़ — केवल योजना सामग्री। Likerts ने किसी को भर्ती, स्क्रीन, संपर्क या सर्वे नहीं किया है। नमूना आकार, घटना दर, व्यवहार्यता, समय और लागत शोधकर्ता व प्रदाता की पुष्टि तक योजना अनुमान हैं।',
    'नई विंडो में खुलता है', 'जनसंख्या', 'शोध सामग्री', 'कोई नहीं',
    'हम अधिकतम दो सार्वजनिक स्रोत जाँचेंगे और दिखाएँगे कि किसने निष्कर्ष को प्रभावित किया। स्रोत न मिलने पर परिणाम केवल मॉडल पर आधारित होगा।',
    'उपलब्ध सार्वजनिक स्रोतों के साथ तेज़ दिशात्मक निष्कर्ष।',
    'अधिक मॉडल पास और असहमति जाँच; इसमें अधिक समय लगता है।',
    'आपका अध्ययन चल रहा है', 'किसी चरण की पूर्णता सर्वर की पुष्टि के बाद ही दिखाई जाती है।', 'नियोजित', 'चलाने की कोशिश के बाद {count} और आवश्यकताएँ दिखेंगी।', 'मॉडल-निर्मित सेगमेंट · नमूना n नहीं',
    'मानवीय सत्यापन योजना देखें', 'एक रन पूरा होने के बाद मानवीय शोध हैंडऑफ़ उपलब्ध होगा।',
    'नया अध्ययन शुरू करें? इससे मौजूदा ब्रीफ़, परिणाम, शोध सामग्री और मॉडल की गई बातचीत साफ़ हो जाएँगी।', 'कार्यक्षेत्र पर जाएँ',
  ],
};

const uxUiTranslations = Object.fromEntries(
  Object.entries(uxValues).map(([locale, values]) => [locale, Object.fromEntries(uxKeys.map((key, index) => [key, values[index]]))]),
);

export const CJK_UI_LOCALES = CJK_LOCALE_IDS;
export const CJK_UI_CANONICAL_TECHNICAL_KEYS = Object.freeze(['stabilityJsd']);

// Project declared provenance from the shared registry. These declarations are
// presentation metadata only; server scorecards still decide release eligibility.
export const CJK_UI_COPY_PROVENANCE = Object.freeze(Object.fromEntries(CJK_UI_LOCALES.map((locale) => {
  const release = LOCALE_CAPABILITIES[locale].release;
  return [locale, Object.freeze({
    copyStatus: release.copyStatus,
    nativeReviewStatus: release.nativeReview.statusByCapability.ui,
  })];
})));

const cjkPopulationAndStabilityRows = [
  ['localizationReadiness', '本地化状态：{copyStatus} · 母语审校：{nativeReviewStatus}', 'ローカライズ状況：{copyStatus} · ネイティブレビュー：{nativeReviewStatus}', '현지화 상태: {copyStatus} · 원어민 검토: {nativeReviewStatus}'],
  ['copyStatusMachineDrafted', '机器起草（machine-drafted）', '機械起草（machine-drafted）', '기계 초안(machine-drafted)'],
  ['copyStatusNativeReviewed', '已由母语人士审核（native-reviewed）', 'ネイティブレビュー済み（native-reviewed）', '원어민 검토 완료(native-reviewed)'],
  ['nativeReviewPending', '待母语审校（review-pending）', 'ネイティブレビュー待ち（review-pending）', '원어민 검토 대기(review-pending)'],
  ['evidenceClaimSourceNumber', '来源 {count}', '情報源 {count}', '출처 {count}'],
  ['methodSpecificModelOutput', '方法专用模型输出', '調査手法別のモデル出力', '연구 방법별 모델 출력'],
  ['finalLikertDistribution', '最终五点李克特分布', '最終的な5段階リッカート分布', '최종 5점 리커트 분포'],
  ['audienceSegmentDifferences', '受众细分之间的差异', '対象者セグメント間の差', '대상 세그먼트 간 차이'],
  ['responseScoreReasons', '作答评分背后的原因', '回答スコアの背景にある理由', '응답 점수의 배경 요인'],
  ['populationFrame', '总体框架', '母集団フレーム', '모집단 프레임'],
  ['populationFrameMissing', '此旧版结果不包含总体框架。', 'この旧形式の結果には母集団フレームがありません。', '이 이전 형식의 결과에는 모집단 프레임이 없습니다.'],
  ['populationFrameNote', '准确显示模拟前可用的总体约束，以及仍缺乏支持的特征。', 'シミュレーション前に利用できた母集団制約と、未対応の特性を正確に示します。', '시뮬레이션 전에 사용할 수 있었던 모집단 제약과 아직 지원되지 않는 특성을 정확히 보여 줍니다.'],
  ['intendedPopulation', '目标总体', '対象母集団', '의도한 모집단'],
  ['geography', '地理范围', '地域', '지역'],
  ['notSupplied', '未提供', '未提供', '제공되지 않음'],
  ['coverageDate', '覆盖日期', '対象日', '적용 날짜'],
  ['weightingMethod', '加权方法', '重み付け方法', '가중치 적용 방법'],
  ['officialDatasets', '官方来源数据集', '公的情報源データセット', '공식 출처 데이터 세트'],
  ['noOfficialDatasets', '未提供或匹配到官方总体数据集。', '公的な母集団データセットは提供も照合もされていません。', '공식 모집단 데이터 세트가 제공되거나 일치하지 않았습니다.'],
  ['marginalDistributions', '边际分布', '周辺分布', '주변 분포'],
  ['noMarginals', '没有可用的人口统计或企业特征边际分布。', '人口統計または企業属性の周辺分布は利用できません。', '사용 가능한 인구통계 또는 기업통계 주변 분포가 없습니다.'],
  ['knownIntersections', '已知交叉分组', '既知の交差区分', '알려진 교차 집단'],
  ['intersectionRecordOne', '个有记录的交叉分组', '件の記録済み交差区分', '개의 기록된 교차 집단'],
  ['intersectionRecords', '个有记录的交叉分组', '件の記録済み交差区分', '개의 기록된 교차 집단'],
  ['noIntersections', '没有可用的总体交叉分组。', '利用可能な母集団の交差区分はありません。', '사용 가능한 모집단 교차 집단이 없습니다.'],
  ['fitComponents', '总体匹配度组成', '母集団適合度の構成要素', '모집단 적합도 구성 요소'],
  ['unsupportedCharacteristics', '缺乏支持的特征', '未対応の特性', '지원되지 않는 특성'],
  ['noneRecorded', '无记录', '記録なし', '기록 없음'],
  ['modelCard', '模型卡', 'モデルカード', '모델 카드'],
  ['modelCardMissing', '此旧版结果未记录模型卡来源信息。', 'この旧形式の結果にはモデルカードの来歴が記録されていません。', '이 이전 형식의 결과에는 모델 카드 출처가 기록되지 않았습니다.'],
  ['cardVersion', '卡片版本', 'カードバージョン', '카드 버전'],
  ['purpose', '用途', '目的', '목적'],
  ['permittedUse', '允许用途', '許可される用途', '허용 용도'],
  ['populationGrounding', '总体依据', '母集団の根拠', '모집단 근거'],
  ['attitudinalValidation', '态度验证', '態度の検証', '태도 검증'],
  ['populationFrameHash', '总体框架哈希', '母集団フレームのハッシュ', '모집단 프레임 해시'],
  ['prohibitedUses', '禁止用途', '禁止される用途', '금지 용도'],
  ['modelGeneratedPerspective', '模型生成的观点，并非参与者原话。', 'モデル生成の見解であり、参加者の発言ではありません。', '모델이 생성한 관점이며 참여자 발언이 아닙니다.'],
  ['repeatRunStability', '多次运行稳定性', '複数実行の安定性', '반복 실행 안정성'],
  ['repeatRunNote', '比较同一版本简报的重复运行。它衡量的是变化，而不是真实性。', '同じバージョンの概要を繰り返し実行して比較します。測るのは変動であり、真実性ではありません。', '동일한 버전의 브리프를 반복 실행해 비교합니다. 이는 진실성이 아니라 변동을 측정합니다.'],
  ['repeatRunComparison', '重复运行比较', '反復実行の比較', '반복 실행 비교'],
  ['completedRuns', '可比较的运行', '比較可能な実行', '비교 가능한 실행'],
  ['comparisonStatus', '比较状态', '比較状況', '비교 상태'],
  ['variationLabel', '变化分类', '変動区分', '변동 분류'],
  ['lowVariation', '变化较小', '変動小', '낮은 변동'],
  ['materialVariation', '显著变化', '重要な変動', '중대한 변동'],
  ['notAssessed', '未评估', '未評価', '평가되지 않음'],
  ['evidenceSensitivity', '证据敏感性', '根拠への感度', '근거 민감도'],
  ['evidenceChanged', '各次运行的证据发生变化', '実行間で根拠が変わりました', '실행 간 근거가 변경됨'],
  ['evidenceStable', '证据哈希未变化', '根拠ハッシュは変更なし', '근거 해시 변경 없음'],
  ['maxCategorySpread', '最大类别差值', 'カテゴリ差の最大値', '최대 범주 차이'],
  ['topTwoBoxSpread', '高分两档差值', '上位2区分の差', '상위 2개 응답 차이'],
  ['pairwiseJsd', '平均成对 JSD', 'ペアごとの平均 JSD', '평균 쌍별 JSD'],
  ['thresholds', '已发布阈值', '公開済みしきい値', '공개된 임계값'],
  ['runDistributions', '已记录的运行分布', '記録済みの実行分布', '기록된 실행 분포'],
  ['replayForStability', '重放此研究以创建重复运行比较。', 'この調査を再実行して反復実行の比較を作成します。', '이 연구를 다시 실행하여 반복 실행 비교를 만드세요.'],
  ['withinRunStability', '单次运行内的模型单元稳定性', '実行内のモデルセル安定性', '실행 내 모델 셀 안정성'],
  ['modelCells', '模型单元', 'モデルセル', '모델 셀'],
  ['modelCount', '{count} 个模型', '{count}モデル', '모델 {count}개'],
];

const cjkMethodRows = [
  ['instrument', '研究工具', '調査票', '조사 도구'],
  ['humanValidationPlan', '真人验证计划', '人による検証計画', '실제 사람 검증 계획'],
  ['recommendedHumanMethod', '建议的真人研究方法', '推奨する人による調査方法', '권장 실제 사람 연구 방법'],
  ['methodQuestionPurpose', '题目用途由{method}模板定义。', '質問の目的は{method}テンプレートで定義されています。', '문항 목적은 {method} 템플릿에 정의되어 있습니다.'],
  ['methodCriticSummary', '检查方法忠实度、证据一致性、无依据主张以及真人验证边界。', '手法への忠実性、根拠との整合、裏付けのない主張、人による検証との境界を確認します。', '방법 충실도, 근거 정합성, 뒷받침되지 않은 주장, 실제 사람 검증의 경계를 확인합니다.'],
  ['methodHumanValidationSummary', '请使用相匹配的真人研究验证这项由模型生成的{method}结果。', 'このモデル生成の{method}結果は、対応する人を対象とした調査で検証してください。', '모델이 생성한 이 {method} 결과를 적합한 실제 사람 대상 연구로 검증하세요.'],
  ['methodHumanValidationRationale', '模型生成的结果不构成实际观察到的真人证据。', 'モデル生成の出力は、人を対象に観察された根拠を立証するものではありません。', '모델 생성 결과는 관찰된 사람 대상 근거를 확립하지 않습니다.'],
  ['methodHumanValidationChecks', '在作出决策前，请核实理解情况、研究设计匹配度和实际观察到的真人结果。', '意思決定前に、理解度、調査設計の適合性、観察された人の結果を確認してください。', '의사결정 전에 이해도, 연구 설계 적합성, 관찰된 사람 대상 결과를 확인하세요.'],
  ['humanValidationGeneralLikert', '先进行认知预测试，再开展抽样问卷调查', '認知プレテスト後に実施するサンプル調査', '인지 사전 테스트 후 실시하는 표본 설문조사'],
  ['humanValidationConceptTest', '结合认知访谈的单一概念（monadic）问卷调查', '認知インタビューを伴うモナディック・コンセプト調査', '인지 인터뷰를 포함한 모나딕 콘셉트 설문조사'],
  ['humanValidationPurchaseIntent', '包含品类资格和近期行为筛选的抽样购买意向调查', 'カテゴリー適格性と最近の行動によるスクリーニングを含む購入意向サンプル調査', '카테고리 적격성 및 최근 행동 스크리닝을 포함한 표본 구매 의향 조사'],
  ['humanValidationMessageTest', '带理解度检查的单一信息（monadic）测试', '理解度確認を伴うモナディック・メッセージテスト', '이해도 확인을 포함한 모나딕 메시지 테스트'],
  ['humanValidationClaimsTest', '结合法律审查的真人主张理解度与可信度测试', '法務レビューを伴う、人を対象とした主張理解度・信頼性テスト', '법률 검토를 포함한 실제 사람 대상 주장 이해도 및 신뢰도 테스트'],
  ['humanValidationUxExpectation', '真人主持式任务测试或原型可用性研究', '人を対象としたモデレーター付きタスクテスト、またはプロトタイプのユーザビリティ調査', '실제 사람 대상 진행자 주도 과업 테스트 또는 프로토타입 사용성 연구'],
  ['humanValidationFeaturePrioritization', '真人 MaxDiff、强制排序或联合分析（conjoint）研究', '人を対象とした MaxDiff、強制順位付け、またはコンジョイント調査', '실제 사람 대상 MaxDiff, 강제 순위 또는 컨조인트 연구'],
  ['humanValidationBrandPositioning', '盲测式真人品牌联想追踪研究', 'ブラインド方式の人を対象としたブランド連想トラッキング調査', '블라인드 방식의 실제 사람 대상 브랜드 연상 추적 조사'],
  ['humanValidationPriceSensitivity', '由真人参与的随机化 Gabor–Granger 或选择实验', '実参加者による無作為化 Gabor–Granger または選択実験', '실제 참여자를 대상으로 한 무작위 Gabor–Granger 또는 선택 연구'],
  ['humanValidationSurveyPretest', '认知访谈和研究人员审查', '認知インタビューと研究者レビュー', '인지 인터뷰 및 연구자 검토'],
  ['humanValidationInterviewGuide', '研究人员审查和真人访谈试测', '研究者レビューと人を対象としたインタビューのパイロット実施', '연구자 검토 및 실제 사람 대상 인터뷰 파일럿'],
  ['stableFeatureIds', '3–8 项带稳定 ID 的功能', '固定 ID を持つ3～8個の機能', '안정적인 ID가 있는 기능 3~8개'],
  ['comparatorBrandRange', '2–5 个比较品牌', '比較ブランド2～5件', '비교 브랜드 2~5개'],
  ['suppliedAttributeRange', '所提供的 3–6 项属性', '提示された属性3～6件', '제공된 속성 3~6개'],
  ['ascendingPricePointRange', '3–8 个递增价格点', '昇順の価格3～8件', '오름차순 가격 지점 3~8개'],
  ['surveyQuestionsStableReferences', '带稳定引用标识的问卷题目', '固定参照 ID 付きの調査質問', '안정적인 참조 ID가 있는 설문 문항'],
  ['stableTopicIds', '2–8 个带稳定 ID 的主题', '固定 ID を持つ2～8個のトピック', '안정적인 ID가 있는 주제 2~8개'],
  ['messageTest', '信息测试', 'メッセージテスト', '메시지 테스트'],
  ['messageTestDescription', '用五点方向性反应测试一条信息及其预期行动。', '1つのメッセージと意図する行動を、5段階の方向性反応で確認します。', '하나의 메시지와 의도한 행동을 5점 방향성 반응으로 테스트합니다.'],
  ['claimsTest', '主张测试', '主張テスト', '주장 테스트'],
  ['claimsTestDescription', '审查一项明确主张的方向性可信度和理解风险，而非认证其真实性。', '1つの明確な主張について、方向性のある信頼感と理解上のリスクを確認します。真実性の認証ではありません。', '하나의 명확한 주장을 방향성 신뢰도와 이해 위험 측면에서 검토하며 사실 인증은 하지 않습니다.'],
  ['uxExpectationTest', 'UX 预期测试', 'UX期待値テスト', 'UX 기대 테스트'],
  ['uxExpectationTestDescription', '探索一个任务情境下的预期易用性；这不是观察到的可用性。', '1つのタスク場面で予想される使いやすさを探索します。観察によるユーザビリティではありません。', '하나의 작업 상황에서 예상되는 용이성을 살펴봅니다. 관찰된 사용성 결과가 아닙니다.'],
  ['featurePrioritization', '功能优先级排序', '機能の優先順位付け', '기능 우선순위 지정'],
  ['featurePrioritizationDescription', '对提供的三至八项功能进行方向性顺序排名。', '提示された3～8個の機能について、方向性を示す順位を作成します。', '제공된 3~8개 기능의 방향성 순위를 만듭니다.'],
  ['brandPositioning', '品牌定位', 'ブランドポジショニング', '브랜드 포지셔닝'],
  ['brandPositioningDescription', '按提供的联想属性比较所提供的品牌。', '提示されたブランドを、提示された連想属性ごとに比較します。', '제공된 브랜드를 제공된 연상 속성별로 비교합니다.'],
  ['priceSensitivity', '价格敏感度', '価格感度', '가격 민감도'],
  ['priceSensitivityDescription', '比较三至八个递增价格点下的购买意向分布。', '昇順に提示された3～8個の価格について、表明された意向の分布を比較します。', '오름차순으로 제공된 3~8개 가격에서 진술된 의향 분포를 비교합니다.'],
  ['surveyPretest', '问卷预测试', '調査票プレテスト', '설문 사전 테스트'],
  ['surveyPretestDescription', '审查所提供问卷题目的措辞、覆盖范围和认知测试风险。', '提示された調査質問について、表現、網羅性、認知テスト上のリスクを確認します。', '제공된 설문 문항의 표현, 범위, 인지 테스트 위험을 검토합니다.'],
  ['interviewGuide', '访谈提纲', 'インタビューガイド', '인터뷰 가이드'],
  ['interviewGuideDescription', '起草与所提供研究主题对应的中立问题和追问。', '提示された調査トピックに対応する、中立的な質問と深掘り質問を作成します。', '제공된 연구 주제에 맞춘 중립적 질문과 탐색 질문을 작성합니다.'],
  ['messageStimulus', '信息刺激材料', 'メッセージ刺激', '메시지 자극물'],
  ['intendedAction', '预期行动', '意図する行動', '의도한 행동'],
  ['exposureContext', '接触情境', '提示状況', '노출 상황'],
  ['claimStimulus', '主张刺激材料', '主張刺激', '주장 자극물'],
  ['claimStatus', '主张状态', '主張の状態', '주장 상태'],
  ['claimStatusNotSupplied', '未提供', '未提供', '제공되지 않음'],
  ['claimStatusUnverified', '未核实', '未検証', '검증되지 않음'],
  ['claimStatusDeclared', '用户声明已有依据', 'ユーザー申告による裏付けあり', '사용자 선언에 따른 근거 있음'],
  ['taskScenario', '任务情境', 'タスク場面', '작업 상황'],
  ['userGoal', '用户目标', 'ユーザー目標', '사용자 목표'],
  ['experienceDescription', '体验说明', '体験の説明', '경험 설명'],
  ['experienceContext', '体验情境', '体験の状況', '경험 상황'],
  ['device', '设备', 'デバイス', '기기'],
  ['features', '功能', '機能', '기능'],
  ['feature', '功能', '機能', '기능'],
  ['addFeature', '添加功能', '機能を追加', '기능 추가'],
  ['decisionContext', '决策情境', '意思決定の状況', '의사결정 상황'],
  ['selectionConstraint', '选择限制', '選択の制約', '선택 제약'],
  ['focalBrand', '目标品牌', '対象ブランド', '중점 브랜드'],
  ['comparatorBrands', '比较品牌', '比較ブランド', '비교 브랜드'],
  ['comparatorBrand', '比较品牌', '比較ブランド', '비교 브랜드'],
  ['addComparator', '添加比较品牌', '比較ブランドを追加', '비교 브랜드 추가'],
  ['attributes', '属性', '属性', '속성'],
  ['attribute', '属性', '属性', '속성'],
  ['addAttribute', '添加属性', '属性を追加', '속성 추가'],
  ['ascendingPricePoints', '递增价格点', '昇順の価格', '오름차순 가격'],
  ['pricePoint', '价格点', '価格', '가격 지점'],
  ['addPricePoint', '添加价格点', '価格を追加', '가격 추가'],
  ['studyObjective', '研究目标', '調査目的', '연구 목표'],
  ['targetPopulation', '目标总体', '対象母集団', '대상 모집단'],
  ['surveyQuestions', '问卷题目', '調査質問', '설문 문항'],
  ['surveyQuestion', '问卷题目', '調査質問', '설문 문항'],
  ['addSurveyQuestion', '添加问卷题目', '調査質問を追加', '설문 문항 추가'],
  ['researchObjective', '研究目标', '調査目的', '연구 목표'],
  ['participantContext', '参与者情境', '参加者の状況', '참여자 상황'],
  ['interviewTopics', '访谈主题', 'インタビュートピック', '인터뷰 주제'],
  ['topic', '主题', 'トピック', '주제'],
  ['addTopic', '添加主题', 'トピックを追加', '주제 추가'],
  ['sensitiveAreas', '敏感领域', '配慮が必要な領域', '민감 영역'],
  ['sensitiveArea', '敏感领域', '配慮が必要な領域', '민감 영역'],
  ['addSensitiveArea', '添加敏感领域', '配慮領域を追加', '민감 영역 추가'],
  ['removeItem', '删除项目', '項目を削除', '항목 삭제'],
  ['rankedItems', '方向性优先顺序', '方向性を示す優先順位', '방향성 우선순위'],
  ['attributeMatrix', '品牌联想矩阵', 'ブランド連想マトリクス', '브랜드 연상 행렬'],
  ['brand', '品牌', 'ブランド', '브랜드'],
  ['associationLOW', '低', '低', '낮음'],
  ['associationMEDIUM', '中', '中', '보통'],
  ['associationHIGH', '高', '高', '높음'],
  ['priceLadder', '价格阶梯', '価格ラダー', '가격 사다리'],
  ['positiveIntent', '正向意向', '肯定的な意向', '긍정 의향'],
  ['instrumentIssues', '研究工具审查问题', '調査票レビューの問題', '조사 도구 검토 문제'],
  ['severityLOW', '低', '低', '낮음'],
  ['severityMEDIUM', '中', '中', '보통'],
  ['severityHIGH', '高', '高', '높음'],
  ['revisionSuggestion', '修改建议', '修正案', '수정 제안'],
  ['noInstrumentIssues', '未返回任何问题，但这并不表示研究工具已通过验证。', '問題は返されませんでしたが、調査票が検証されたことを意味しません。', '문제가 반환되지 않았지만 조사 도구가 검증된 것은 아닙니다.'],
  ['coverageGaps', '覆盖缺口', '網羅性の不足', '범위 공백'],
  ['cognitiveProbes', '建议的认知追问', '推奨する認知プローブ', '권장 인지 탐색 질문'],
  ['opening', '开场', '導入', '도입'],
  ['guideQuestions', '提纲问题', 'ガイド質問', '가이드 질문'],
  ['probes', '追问', '深掘り質問', '탐색 질문'],
  ['moderatorNotes', '主持人备注', 'モデレーター向けメモ', '진행자 메모'],
  ['consentAccessibility', '同意与无障碍', '同意とアクセシビリティ', '동의 및 접근성'],
  ['closing', '结束语', '終了', '마무리'],
  ['notAtAllCompelling', '完全没有吸引力', 'まったく魅力を感じない', '전혀 매력적이지 않음'],
  ['slightlyCompelling', '略有吸引力', 'やや魅力を感じる', '약간 매력적임'],
  ['neitherCompelling', '既无吸引力也不乏味', '魅力的とも魅力がないともいえない', '매력적이지도 매력 없지도 않음'],
  ['compelling', '有吸引力', '魅力を感じる', '매력적임'],
  ['veryCompelling', '非常有吸引力', '非常に魅力を感じる', '매우 매력적임'],
  ['notAtAllBelievable', '完全不可信', 'まったく信じられない', '전혀 믿기 어려움'],
  ['slightlyBelievable', '略可信', 'やや信じられる', '약간 믿을 만함'],
  ['neitherBelievable', '既非可信也非不可信', '信じられるとも信じられないともいえない', '믿을 만하지도 믿기 어렵지도 않음'],
  ['believable', '可信', '信じられる', '믿을 만함'],
  ['veryBelievable', '非常可信', '非常に信じられる', '매우 믿을 만함'],
  ['veryDifficult', '非常困难', '非常に難しい', '매우 어려움'],
  ['difficult', '困难', '難しい', '어려움'],
  ['neitherDifficultNorEasy', '既不困难也不容易', '難しいとも簡単ともいえない', '어렵지도 쉽지도 않음'],
  ['easy', '容易', '簡単', '쉬움'],
  ['veryEasy', '非常容易', '非常に簡単', '매우 쉬움'],
  ['probablyOrDefinitelyWould', '可能会或肯定会', 'おそらく購入する／必ず購入する', '아마도 또는 확실히 구매함'],
  ['compellingOrVeryCompelling', '有吸引力或非常有吸引力', '魅力的／非常に魅力的', '매력적임 또는 매우 매력적임'],
  ['believableOrVeryBelievable', '可信或非常可信', '信じられる／非常に信じられる', '믿을 만함 또는 매우 믿을 만함'],
  ['easyOrVeryEasy', '容易或非常容易', '簡単／非常に簡単', '쉬움 또는 매우 쉬움'],
  ['resultContractErrorTitle', '无法显示此结果', 'この結果を表示できません', '이 결과를 표시할 수 없습니다'],
  ['resultContractErrorBody', '结果数据不符合受支持的版本化契约。请重新运行研究；不要将此状态解读为研究发现。', '結果データが対応するバージョン付き契約に適合していません。調査を再実行し、この状態を調査結果として解釈しないでください。', '결과 데이터가 지원되는 버전 계약과 일치하지 않습니다. 연구를 다시 실행하고 이 상태를 연구 결과로 해석하지 마세요.'],
];

const cjkWorkflowRows = [
  ['localProject', '本地项目', 'ローカルプロジェクト', '로컬 프로젝트'],
  ['localProjectTitle', '持久化定性项目', '永続化された定性プロジェクト', '영구 정성 프로젝트'],
  ['localProjectNote', '将细分人群的后续访谈背景保存在此浏览器中，使建模访谈在重新加载后仍可使用、可清晰导出，并与观察到的真人研究分开保存。', 'セグメントの追加質問の文脈をこのブラウザに保存し、モデル化されたインタビューを再読み込み後も維持して、整理された形で書き出し、観察された人による調査とは分けて管理します。', '세그먼트 후속 질문의 맥락을 이 브라우저에 저장하여 모델링된 인터뷰를 새로고침 후에도 유지하고 깔끔하게 내보내며 관찰된 실제 사람 연구와 분리합니다.'],
  ['localProjectDisclosure', '本地浏览器数据；并非加密的账户存储。', 'ブラウザ内のローカルデータです。暗号化されたアカウント保存領域ではありません。', '브라우저의 로컬 데이터이며 암호화된 계정 저장소가 아닙니다.'],
  ['localProjectPending', '正在准备本地存储', 'ローカル保存領域を準備中', '로컬 저장소 준비 중'],
  ['localProjectReady', '已在 {conversations} 个细分人群对话中保存 {turns} 组问答', '{conversations}件のセグメントスレッドに{turns}組の応答を保存済み', '{conversations}개 세그먼트 대화에 {turns}개 대화 쌍 저장됨'],
  ['localProjectUnsupported', '此浏览器不提供持久化本地项目存储。细分人群后续访谈将仅保留在本次会话中。', 'このブラウザでは永続的なローカルプロジェクト保存を利用できません。セグメントの追加質問はこのセッション内だけに保持されます。', '이 브라우저는 영구 로컬 프로젝트 저장소를 제공하지 않습니다. 세그먼트 후속 질문은 현재 세션에만 유지됩니다.'],
  ['localProjectError', '无法更新本地定性项目。请重试。参考代码：{code}', 'ローカル定性プロジェクトを更新できませんでした。再試行してください。参照：{code}', '로컬 정성 프로젝트를 업데이트하지 못했습니다. 다시 시도하세요. 참조: {code}'],
  ['savedConversations', '已保存的细分人群对话', '保存済みセグメントスレッド', '저장된 세그먼트 대화'],
  ['savedTurnPairs', '已保存的问答组', '保存済みの応答ペア', '저장된 대화 쌍'],
  ['savedMaterials', '已保存的材料', '保存済み資料', '저장된 자료'],
  ['exportLocalProject', '导出本地项目', 'ローカルプロジェクトを書き出す', '로컬 프로젝트 내보내기'],
  ['importLocalProject', '导入本地项目', 'ローカルプロジェクトを読み込む', '로컬 프로젝트 가져오기'],
  ['clearLocalProject', '清除本地项目', 'ローカルプロジェクトを消去', '로컬 프로젝트 지우기'],
  ['addResearchMaterial', '添加你的研究材料', '調査資料を追加', '연구 자료 추가'],
  ['researchMaterialPrivacy', '提取在本地进行。运行时仅发送有长度限制的摘录，这些摘录可能保留在本地运行记录中；原始文件字节绝不会保存。', '抽出はローカルで行われます。長さを制限した抜粋だけが実行時に送信され、ローカルの実行記録に残る場合があります。元ファイルのバイト列は保存されません。', '추출은 로컬에서 이루어집니다. 길이가 제한된 발췌문만 실행 시 전송되고 로컬 실행 기록에 남을 수 있으며 원본 파일 바이트는 저장되지 않습니다.'],
  ['researchMaterialRawText', '最多可添加四个文本文件或文档。文本文件必须小于 400 KB，文档必须小于 5 MB。', 'テキストファイルまたは文書は最大4件追加できます。テキストファイルは400 KB未満、文書は5 MB未満にしてください。', '텍스트 파일 또는 문서를 최대 4개 추가할 수 있습니다. 텍스트 파일은 400 KB 미만, 문서는 5 MB 미만이어야 합니다.'],
  ['researchDocumentExtractionNote', 'PDF 最多 50 页，XLSX 文件最多 20 个工作表。提取只读取文本和单元格值，不读取公式、宏、链接或嵌入对象。所有材料仍属于未经验证的依据。', 'PDFは50ページ、XLSXファイルは20シートまでです。抽出ではテキストとセルの値だけを読み取り、数式、マクロ、リンク、埋め込みオブジェクトは読み取りません。すべての資料は未検証の根拠として扱われます。', 'PDF는 50페이지, XLSX 파일은 20개 시트로 제한됩니다. 추출은 텍스트와 셀 값만 읽으며 수식, 매크로, 링크 또는 포함된 개체는 읽지 않습니다. 모든 자료는 검증되지 않은 근거로 유지됩니다.'],
  ['researchMaterialLimit', '最多添加四份研究材料。', '調査資料は最大4件まで追加できます。', '연구 자료는 최대 4개까지 추가할 수 있습니다.'],
  ['pastedResearchExcerpt', '粘贴的研究摘录', '貼り付けた調査抜粋', '붙여 넣은 연구 발췌문'],
  ['chooseResearchFiles', '选择文件或文档', 'ファイルまたは文書を選択', '파일 또는 문서 선택'],
  ['researchFileLimits', 'txt、md、csv、json < 400 KB · PDF、DOCX、XLSX < 5 MB · PDF ≤ 50 页 · XLSX ≤ 20 个工作表', 'txt、md、csv、json < 400 KB · PDF、DOCX、XLSX < 5 MB · PDF ≤ 50ページ · XLSX ≤ 20シート', 'txt, md, csv, json < 400 KB · PDF, DOCX, XLSX < 5 MB · PDF ≤ 50페이지 · XLSX ≤ 20시트'],
  ['pasteResearchExcerpt', '或粘贴摘录', 'または抜粋を貼り付け', '또는 발췌문 붙여 넣기'],
  ['addExcerpt', '添加摘录', '抜粋を追加', '발췌문 추가'],
  ['readingResearchMaterial', '正在读取研究材料…', '調査資料を読み取り中…', '연구 자료 읽는 중…'],
  ['noResearchMaterial', '尚未添加研究材料。', '調査資料は追加されていません。', '추가된 연구 자료가 없습니다.'],
  ['characters', '字符', '文字', '자'],
  ['pastedMaterial', '粘贴的文本', '貼り付けたテキスト', '붙여 넣은 텍스트'],
  ['uploadedText', '上传的文本', 'アップロードしたテキスト', '업로드된 텍스트'],
  ['extractedDocument', '已提取的文档', '抽出済み文書', '추출된 문서'],
  ['documentLocators', '{count} 个来源位置', '情報源の位置 {count}件', '출처 위치 {count}개'],
  ['excerptTruncated', '摘录已按上限截取', '抜粋は上限内に制限済み', '발췌문 길이 제한됨'],
  ['removeResearchMaterial', '删除研究材料', '調査資料を削除', '연구 자료 삭제'],
  ['providedResearchMaterial', '提供的研究材料', '提供された調査資料', '제공된 연구 자료'],
  ['clientReportedHash', '客户端报告的内容哈希', 'クライアント申告のコンテンツハッシュ', '클라이언트 보고 콘텐츠 해시'],
  ['uploadedMaterialTrace', '提供的材料 → 有长度限制的摘录 → 证据包', '提供資料 → 長さを制限した抜粋 → 根拠パケット', '제공된 자료 → 길이가 제한된 발췌문 → 근거 패킷'],
  ['uploadedMaterialRisk', '未经验证的背景信息，并非真人验证', '未検証の文脈であり、人による検証ではありません', '검증되지 않은 맥락이며 실제 사람 검증이 아님'],
  ['validateWithPeople', '用真人研究验证', '実際の人で検証', '실제 사람으로 검증'],
  ['humanResearchDraft', '真人研究交接', '人による調査への引き継ぎ', '실제 사람 연구 인계'],
  ['questionnaireForReview', '待审查问卷', 'レビュー用調査票', '검토용 설문지'],
  ['stimuliForReview', '待审查刺激材料', 'レビュー用刺激素材', '검토용 자극물'],
  ['stimulusIdentifier', '刺激材料标识符', '刺激素材識別子', '자극물 식별자'],
  ['stimulusType', '刺激材料类型', '刺激素材の種類', '자극물 유형'],
  ['technicalReference', '技术参考', '技術参照', '기술 참조'],
  ['handoffBlockerUnsupportedLocale', '所选问卷语言需要先由人工翻译，才能用于现场调研。', '選択した質問票の言語は、実査前に人による翻訳が必要です。', '선택한 설문지 언어는 현장 조사 전에 사람의 번역이 필요합니다.'],
  ['handoffBlockerLocaleMismatch', '报告语言与问卷语言必须一致，或完成有记录的翻译审查。', 'レポートと質問票の言語を一致させるか、記録に残る翻訳レビューを完了してください。', '보고서와 설문지 언어를 일치시키거나 기록 가능한 번역 검토를 완료해야 합니다.'],
  ['handoffBlockerSpecializedMethodRequired', '请先选择一种专用研究方法，再创建可用于现场调研的问卷。', '実査可能な質問票を作成する前に、専用の調査手法を選択してください。', '현장 조사용 설문지를 만들기 전에 전용 연구 방법을 선택하세요.'],
  ['handoffBlockerPrimaryScriptMismatch', '主要问题与所选问卷语言不匹配。', '主要質問が選択した質問票の言語と一致していません。', '주요 질문이 선택한 설문지 언어와 일치하지 않습니다.'],
  ['handoffBlockerMethodConfigRequired', '请先完成所选方法的设置，再创建可用于现场调研的问卷。', '実査可能な質問票を作成する前に、選択した手法の設定を完了してください。', '현장 조사용 설문지를 만들기 전에 선택한 방법 설정을 완료하세요.'],
  ['handoffBlockerTemplateMissing', '此方法没有可用的真人研究问卷模板。', 'この手法に対応する実参加者調査用の質問票テンプレートはありません。', '이 방법에 사용할 수 있는 실제 참여자 연구 설문지 템플릿이 없습니다.'],
  ['handoffBlockerRespondentCopyMismatch', '部分面向受访者的文本与所选问卷语言不匹配。', '回答者向けテキストの一部が、選択した質問票の言語と一致していません。', '일부 응답자용 텍스트가 선택한 설문지 언어와 일치하지 않습니다.'],
  ['handoffBlockerUnknown', '此问卷需要研究人员审查后才能用于现场调研。', 'この質問票を実査に使う前に、研究者によるレビューが必要です。', '이 설문지를 현장 조사에 사용하려면 연구자 검토가 필요합니다.'],
  ['questionItems', '待审查项目', 'レビュー対象項目', '검토할 항목'],
  ['rankOrderItems', '需要排序的项目', '順位付けする項目', '순위를 매길 항목'],
  ['matrixRows', '矩阵行', 'マトリクス行', '매트릭스 행'],
  ['screeningCriteria', '筛选标准', 'スクリーニング基準', '선별 기준'],
  ['quotasAndIncidence', '配额与发生率', '割付と出現率', '할당 및 발생률'],
  ['recruitmentInstructions', '招募说明', 'リクルーティング指示', '모집 지침'],
  ['analysisPlan', '分析计划', '分析計画', '분석 계획'],
  ['planningRecommendation', '规划建议', '計画上の推奨事項', '계획 권장 사항'],
  ['nominalFullSampleReference', '名义全样本参考值', '名目上の全体サンプル参照値', '명목상 전체 표본 참고값'],
  ['samplePlanStatus', '样本规划状态', 'サンプル計画の状態', '표본 계획 상태'],
  ['sampleRecommendationConfigureMethod', '请先选择并配置受支持的研究方法，再确定样本量。', 'サンプルサイズを決める前に、対応する調査手法を選択して設定してください。', '표본 크기를 정하기 전에 지원되는 연구 방법을 선택하고 구성하세요.'],
  ['sampleRecommendationNominalReference', '仅作为全样本比例的名义参考值；请根据实际招募和分析设计重新计算。', '名目上の全体サンプル比率の参照値にすぎません。実際の募集・分析設計に合わせて再計算してください。', '명목상 전체 표본 비율 참고값일 뿐입니다. 실제 모집 및 분석 설계에 맞춰 다시 계산하세요.'],
  ['sampleRecommendationExpectationReference', '仅作为预期易用性问卷的参考值；观察性可用性测试应另行确定样本量。', '予期される使いやすさの調査に対する参照値にすぎません。観察に基づくユーザビリティテストのサンプルサイズは別に設計してください。', '예상 사용 편의성 설문의 참고값일 뿐입니다. 관찰 기반 사용성 테스트의 표본 크기는 별도로 정하세요.'],
  ['sampleRecommendationRankDesign', '在计算样本目标前，先确定排序或选择设计。', 'サンプル目標を計算する前に、順位付けまたは選択の設計を確定してください。', '표본 목표를 계산하기 전에 순위 또는 선택 설계를 확정하세요.'],
  ['sampleRecommendationBrandDesign', '在计算样本目标前，先确定品牌矩阵和熟悉度规则。', 'サンプル目標を計算する前に、ブランドマトリクスと認知ルールを確定してください。', '표본 목표를 계산하기 전에 브랜드 매트릭스와 인지도 규칙을 확정하세요.'],
  ['sampleRecommendationPriceDesign', '在计算样本目标前，先确定价格展示和分支设计。', 'サンプル目標を計算する前に、価格提示と分岐の設計を確定してください。', '표본 목표를 계산하기 전에 가격 노출과 분기 설계를 확정하세요.'],
  ['sampleRecommendationCognitiveRounds', '规划迭代认知预测试轮次，并记录停止规则。', '反復的な認知プレテストのラウンドを計画し、停止ルールを文書化してください。', '반복적인 인지 사전 테스트 라운드를 계획하고 중단 규칙을 문서화하세요.'],
  ['sampleRecommendationGuidePilot', '计划目的性访谈提纲试测，并记录停止规则。', '目的抽出によるガイドのパイロットを計画し、停止ルールを文書化してください。', '목적 표집 기반 가이드 파일럿을 계획하고 중단 규칙을 문서화하세요.'],
  ['noDefensibleQuota', '在分母与筛选后总体一致之前，无法提供可辩护的配额目标。', '分母がスクリーニング対象母集団と一致するまでは、根拠のある割付目標を提示できません。', '분모가 선별된 모집단과 일치하기 전에는 근거 있는 할당 목표를 제시할 수 없습니다.'],
  ['incidenceNotEstimated', '发生率不根据合成结果估算。', '出現率は合成結果から推定しません。', '발생률은 합성 결과에서 추정하지 않습니다.'],
  ['noPanelBooked', '未预订或连接任何参与者样本组。', '参加者パネルの予約や接続は行われていません。', '참여자 패널이 예약되거나 연결되지 않았습니다.'],
  ['downloadCsvSpec', '下载 CSV 规范', 'CSV仕様をダウンロード', 'CSV 명세 다운로드'],
  ['downloadXlsxSpec', '下载 XLSX 工作簿', 'XLSXワークブックをダウンロード', 'XLSX 통합 문서 다운로드'],
  ['downloadResearchBrief', '下载研究简报', '調査概要をダウンロード', '연구 브리프 다운로드'],
  ['downloadHandoffReceipt', '下载来源链回执', '来歴レシートをダウンロード', '출처 계보 확인서 다운로드'],
  ['providerOptions', '服务提供方选项', '調査会社の選択肢', '제공업체 선택지'],
  ['outboundProviderNote', '仅提供外部链接，不代表集成或认可。请直接确认可行性、价格、时间、可用性和条款。', '外部リンクのみで、連携や推奨を意味しません。実現可能性、価格、時期、空き状況、条件は直接確認してください。', '외부 링크만 제공하며 연동 또는 추천을 의미하지 않습니다. 실행 가능성, 가격, 일정, 이용 가능 여부 및 조건을 직접 확인하세요.'],
  ['handoffExportError', '无法导出真人研究草稿。', '人による調査の草案を書き出せませんでした。', '실제 사람 연구 초안을 내보낼 수 없습니다.'],
  ['handoffStatus', '草稿状态', '草案の状態', '초안 상태'],
  ['recommendedCompletes', '建议完成样本数', '推奨完了数', '권장 완료 표본 수'],
  ['monitorOnlyTargets', '仅监测目标', '監視のみの目標', '모니터링 전용 목표'],
  ['blockingIssues', '阻断问题', '作業を妨げる問題', '차단 문제'],
  ['missingFields', '实地执行前缺少的字段', '実査前に不足している項目', '현장 조사 전 누락 항목'],
  ['observedHumanResponses', '观察到的真人回答', '観察された人の回答', '관찰된 실제 사람 응답'],
  ['openHumanDraft', '打开真人研究草稿', '人による調査の草案を開く', '실제 사람 연구 초안 열기'],
  ['closeHumanDraft', '关闭真人研究草稿', '人による調査の草案を閉じる', '실제 사람 연구 초안 닫기'],
  ['coverageDimensions', '覆盖维度', 'カバレッジの次元', '커버리지 차원'],
  ['coverageVariable', '变量', '変数', '변수'],
  ['coverageCategory', '类别', 'カテゴリー', '범주'],
  ['coverageSourceShare', '来源占比', '情報源の構成比', '출처 비율'],
  ['qualitativePurposiveCoverage', '适用定性目的抽样覆盖；配额和加权不适用。请按记录的覆盖维度进行招募，并使用预先声明的信息量或停止规则。', '定性の目的抽出によるカバレッジを適用します。割付と重み付けは適用されません。記録されたカバレッジの次元に沿って募集し、事前に定めた情報量または停止ルールを使用してください。', '정성 목적 표집 커버리지를 적용하며 할당과 가중치는 적용되지 않습니다. 기록된 커버리지 차원에 따라 모집하고 사전 선언된 정보량 또는 중단 규칙을 사용하세요.'],
  ['recruitmentInstructionCognitivePretestScope', '针对重点参与者差异，检查每道题的理解、回忆负担、敏感性和作答过程风险。', '優先する参加者の違いを踏まえ、各質問の理解、想起負担、センシティビティ、回答プロセスのリスクを確認してください。', '우선 참여자 차이를 고려해 각 문항의 이해도, 회상 부담, 민감성 및 응답 과정 위험을 검토하세요.'],
  ['recruitmentInstructionCognitivePretestRounds', '进行迭代认知访谈，并在各轮之间修改研究工具。', '反復的な認知インタビューを行い、ラウンドの間に調査票を修正してください。', '반복적인 인지 인터뷰를 진행하고 라운드 사이에 조사 도구를 수정하세요.'],
  ['recruitmentInstructionCognitivePretestDocument', '记录观察到的理解问题、修改内容、未解决风险和预先声明的停止规则。', '観察された解釈上の問題、修正、未解決のリスク、事前に定めた停止ルールを記録してください。', '관찰된 해석 문제, 수정 내용, 미해결 위험 및 사전 선언된 중단 규칙을 기록하세요.'],
  ['recruitmentInstructionCognitiveReview', '由真人研究人员审查认知访谈方案和所有已提供的问卷题项。', '人である研究者が認知インタビューのプロトコルと提供されたすべての調査項目を確認するようにしてください。', '실제 연구자가 인지 면담 프로토콜과 제공된 모든 설문 문항을 검토하게 하세요.'],
  ['recruitmentInstructionCognitiveSeparate', '认知预测试反馈应与实质性调查结果分开保存。', '認知プレテストのフィードバックは、実質的な調査結果と分けて管理してください。', '인지 사전 테스트 피드백은 실질적인 설문 결과와 분리해 관리하세요.'],
  ['recruitmentInstructionQualitativeSampling', '按记录的参与者差异进行目的抽样；不要将合成细分人群视为可招募身份。', '記録された参加者の違いに沿って目的抽出を行い、合成セグメントを募集可能な属性として扱わないでください。', '기록된 참여자 차이에 따라 목적 표집을 하고 합성 세그먼트를 모집 가능한 정체성으로 취급하지 마세요.'],
  ['recruitmentInstructionQualitativeGuide', '在正式访谈前，试测中性的主题提纲、追问、同意用语、无障碍安排和主持人流程。', '本インタビューの前に、中立的なトピックガイド、深掘り質問、同意文言、アクセシビリティ、モデレーター手順を試行してください。', '전체 인터뷰 전에 중립적인 주제 가이드, 탐색 질문, 동의 문구, 접근성 및 진행자 절차를 파일럿하세요.'],
  ['recruitmentInstructionQualitativeStopping', '在结束招募前，记录信息量判断、反例、分析覆盖范围和停止规则。', '募集を終了する前に、情報量の判断、反証事例、分析カバレッジ、停止ルールを記録してください。', '모집을 종료하기 전에 정보량 판단, 반증 사례, 분석 커버리지 및 중단 규칙을 기록하세요.'],
  ['recruitmentInstructionQualitativeReview', '在正式实地研究前，由真人研究人员审查并试测访谈提纲。', '本調査の前に、人である研究者がインタビューガイドを確認し、パイロットを行うようにしてください。', '본격적인 현장 연구 전에 실제 연구자가 면담 가이드를 검토하고 파일럿하게 하세요.'],
  ['recruitmentInstructionQualitativeSeparate', '不得将提纲试测回答作为实质性参与者结果进行分析。', 'ガイドのパイロットで得た回答を、実質的な参加者の結果として分析しないでください。', '가이드 파일럿 응답을 실질적인 참여자 결과로 분석하지 마세요.'],
  ['handoffInstructionContractError', '此交接资料使用了不受支持的招募说明契约，因此无法提供招募说明。请重新生成后再导出或实地执行。', 'この引き継ぎは未対応の募集手順契約を使用しているため、募集手順を表示できません。書き出しまたは実査の前に再生成してください。', '이 인계 자료는 지원되지 않는 모집 지침 계약을 사용하므로 모집 지침을 표시할 수 없습니다. 내보내기 또는 현장 조사 전에 다시 생성하세요.'],
  ['statFullRankOrder', '完整排序', '完全順位', '전체 순위'],
  ['statFirstRankCount', '首位计数', '1位の件数', '1순위 횟수'],
  ['statMeanRank', '平均排名', '平均順位', '평균 순위'],
  ['statAttributeBrandSelectionMatrix', '属性×品牌选择矩阵', '属性×ブランド選択マトリクス', '속성×브랜드 선택 행렬'],
  ['statFullDistributionByPricePoint', '各价格点的完整分布', '価格点別の全分布', '가격 지점별 전체 분포'],
  ['statTopTwoBoxByPricePoint', '各价格点的高分两档', '価格点別の上位2区分', '가격 지점별 상위 2개 응답'],
  ['statQuestionComprehensionIssues', '问题理解问题', '質問理解の問題', '문항 이해 문제'],
  ['statRevisionThemes', '修改主题', '修正テーマ', '수정 주제'],
  ['statTopicThematicSummary', '主题专题总结', 'トピックのテーマ要約', '주제별 주제 요약'],
  ['statTopicCoverage', '主题覆盖', 'トピックカバレッジ', '주제 커버리지'],
  ['statGuidePilotFeedback', '提纲试测反馈', 'ガイドパイロットのフィードバック', '가이드 파일럿 피드백'],
  ['statRevisionNeeds', '修改需求', '修正ニーズ', '수정 필요 사항'],
  ['reportingParticipantDispositions', '参与者处置', '参加者の処理', '참여자 처분'],
  ['reportingExclusions', '排除项', '除外', '제외'],
  ['reportingBreakoff', '中途退出', '中断', '중도 이탈'],
  ['reportingUnweightedBases', '未加权基数', '非加重ベース', '비가중 기준 수'],
  ['reportingWeightedBasesIfApplicable', '适用时的加权基数', '該当する場合の加重ベース', '해당 시 가중 기준 수'],
  ['reportingFullDistributions', '完整分布', '全分布', '전체 분포'],
  ['reportingTopTwoBoxWithBases', '含基数的高分两档', 'ベース付き上位2区分', '기준 수를 포함한 상위 2개 응답'],
  ['reportingObservedIncidence', '观察到的发生率', '観測された出現率', '관찰된 발생률'],
  ['reportingFullRankOrders', '完整排序', '完全順位', '전체 순위'],
  ['reportingFirstRankCounts', '首位计数', '1位の件数', '1순위 횟수'],
  ['reportingMeanRanks', '平均排名', '平均順位', '평균 순위'],
  ['reportingAttributeBrandSelectionMatrix', '属性×品牌选择矩阵', '属性×ブランド選択マトリクス', '속성×브랜드 선택 행렬'],
  ['reportingBrandFamiliarityBases', '品牌熟悉度基数', 'ブランド認知度ベース', '브랜드 친숙도 기준 수'],
  ['reportingFullDistributionsByPricePoint', '各价格点的完整分布', '価格点別の全分布', '가격 지점별 전체 분포'],
  ['reportingTopTwoBoxByPricePointWithBases', '各价格点含基数的高分两档', '価格点別のベース付き上位2区分', '가격 지점별 기준 수를 포함한 상위 2개 응답'],
  ['reportingPriceExposureOrder', '价格展示顺序', '価格提示順', '가격 노출 순서'],
  ['reportingParticipantCharacteristics', '参与者特征', '参加者特性', '참여자 특성'],
  ['reportingQuestionComprehensionIssues', '问题理解问题', '質問理解の問題', '문항 이해 문제'],
  ['reportingResponseMappingIssues', '回答映射问题', '回答マッピングの問題', '응답 매핑 문제'],
  ['reportingRevisionThemes', '修改主题', '修正テーマ', '수정 주제'],
  ['reportingIterationHistory', '迭代历史', '反復履歴', '반복 이력'],
  ['reportingTopicThematicSummaries', '主题专题总结', 'トピックのテーマ要約', '주제별 주제 요약'],
  ['reportingTopicCoverage', '主题覆盖', 'トピックカバレッジ', '주제 커버리지'],
  ['reportingNegativeOrDisconfirmingCases', '负面或不支持案例', '否定的または反証となる事例', '부정적 또는 반증 사례'],
  ['reportingStoppingRule', '停止规则', '停止ルール', '중단 규칙'],
  ['reportingForcedChoiceLimitation', '强制选择限制', '強制選択の制約', '강제 선택 제한'],
  ['reportingPresentationOrderLimitation', '呈现顺序限制', '提示順の制約', '제시 순서 제한'],
  ['reportingQuestionSequenceIssues', '问题顺序问题', '質問順序の問題', '문항 순서 문제'],
  ['reportingSensitiveTopicHandling', '敏感主题处理', 'センシティブなトピックの扱い', '민감한 주제 처리'],
  ['reportingRevisionLog', '修改记录', '修正ログ', '수정 로그'],
  ['reportingGuidePilotFeedback', '提纲试测反馈', 'ガイドパイロットのフィードバック', '가이드 파일럿 피드백'],
];

const cjkStaticCallsiteRows = [
  ['brandHome', 'Likerts 首页', 'Likerts ホーム', 'Likerts 홈'],
  ['researchMaterialBoundary', '你的研究材料仅作为未经验证的依据，并非真人验证。', '調査資料は未検証の根拠であり、人による検証ではありません。', '연구 자료는 검증되지 않은 근거이며 실제 사람 검증이 아닙니다.'],
  ['publishedThresholdSummary', '类别差值 ≤ {category} pp · 高分两档差值 ≤ {topTwoBox} pp', 'カテゴリ差 ≤ {category} pp · 上位2区分の差 ≤ {topTwoBox} pp', '범주 차이 ≤ {category} pp · 상위 2개 응답 차이 ≤ {topTwoBox} pp'],
  ['percentagePointsShort', '{value} 个百分点', '{value}ポイント', '{value}%p'],
  ['stabilityJsd', 'JSD {value}', 'JSD {value}', 'JSD {value}'],
  ['repeatRunDisclaimer', '重复运行的收敛性衡量模型输出的变化，而不衡量准确性、代表性或与真人意见的一致程度。', '反復実行の収束はモデル出力の変動を測るもので、正確性、代表性、実際の人との一致を測るものではありません。', '반복 실행 수렴도는 모델 출력의 변동을 측정하며 정확성, 대표성 또는 실제 사람과의 일치도를 측정하지 않습니다.'],
  ['stageNumber', '阶段 {number}', 'ステージ {number}', '단계 {number}'],
  ['statusCode', '状态代码：{status}', 'ステータスコード：{status}', '상태 코드: {status}'],
  ['populationFitFormula', '该分数使用已发布权重，综合地理覆盖、边际覆盖、交叉覆盖、来源质量、来源时效和加权质量。', 'このスコアは公開済みの重みを用いて、地域、周辺分布、交差区分、情報源の品質と鮮度、重み付け品質を組み合わせます。', '이 점수는 공개된 가중치를 사용해 지역 범위, 주변 분포 범위, 교차 집단 범위, 출처 품질, 출처 최신성 및 가중치 품질을 결합합니다.'],
  ['populationFrameDisclaimer', '人口统计匹配度不能证明态度准确性。在真人研究验证前，合成结果仍是模型生成的假设。', '人口統計上の適合は態度の正確性を証明しません。実際の人で検証されるまで、合成結果はモデル生成の仮説です。', '인구통계 적합도가 태도 정확성을 입증하지는 않습니다. 실제 사람으로 검증하기 전까지 합성 결과는 모델이 생성한 가설입니다.'],
  ['geographyCoverageComponent', '地理覆盖', '地域カバレッジ', '지역 범위'],
  ['marginalCoverageComponent', '边际覆盖', '周辺分布カバレッジ', '주변 분포 범위'],
  ['intersectionCoverageComponent', '交叉覆盖', '交差区分カバレッジ', '교차 집단 범위'],
  ['sourceQualityComponent', '来源质量', '情報源の品質', '출처 품질'],
  ['sourceRecencyComponent', '来源时效', '情報源の鮮度', '출처 최신성'],
  ['weightingQualityComponent', '加权质量', '重み付け品質', '가중치 품질'],
  ['unsupportedStructuredPopulation', '未以结构化总体数据形式提供人口统计和企业特征。', '人口統計および企業属性は、構造化された母集団データとして提供されていません。', '인구통계 및 기업통계 특성이 구조화된 모집단 데이터로 제공되지 않았습니다.'],
  ['modelCardPurposeDirectional', '用于生成假设和研究规划的方向性合成研究。', '仮説作成と調査計画のための方向性を示す合成調査です。', '가설 생성 및 연구 계획을 위한 방향성 합성 연구입니다.'],
  ['modelCardPurposeMethod', '用于生成假设和研究规划的模型生成研究方法输出。', '仮説作成と調査計画のための、モデル生成による調査手法別の出力です。', '가설 생성 및 연구 계획을 위한 모델 생성 연구 방법별 결과입니다.'],
  ['modelCardPermittedDirectional', '探索模型生成的方向性模式、假设、异议和问题，供后续真人研究使用。', 'モデル生成の方向性パターン、前提、反論、質問を、後続の人による調査に向けて探索します。', '후속 실제 사람 연구를 위해 모델이 생성한 방향성 패턴, 가정, 반론 및 질문을 탐색합니다.'],
  ['modelCardPermittedMethod', '探索模型生成的方法专用草稿、排名、比较、假设和问题，供后续真人研究使用。', 'モデル生成の手法別草案、順位、比較、前提、質問を、後続の人による調査に向けて探索します。', '후속 실제 사람 연구를 위해 모델이 생성한 방법별 초안, 순위, 비교, 가정 및 질문을 탐색합니다.'],
  ['prohibitedPopulationEstimation', '总体估算', '母集団の推定', '모집단 추정'],
  ['prohibitedObservedAttitudes', '声称观察到了真实态度', '観察された態度であるとの主張', '관찰된 태도라고 주장'],
  ['prohibitedSyntheticConfidenceIntervals', '合成置信区间', '合成信頼区間', '합성 신뢰구간'],
  ['prohibitedConsequentialSubstitution', '替代会产生重大后果的真人研究', '重要な判断に関わる人による調査の代替', '중대한 의사결정을 위한 실제 사람 연구의 대체'],
  ['modelCardDisclosure', '态度准确性尚未验证。人口统计依据不会使模型生成的回答成为真实人群的代表。', '態度の正確性は検証されていません。人口統計上の根拠があっても、モデル生成の回答が実際の人を代表することにはなりません。', '태도 정확성은 검증되지 않았습니다. 인구통계 근거가 있어도 모델 생성 응답이 실제 사람을 대표하지는 않습니다.'],
  ['statusNotApplied', '未应用', '未適用', '적용되지 않음'],
  ['statusInvalidInput', '输入无效', '入力が無効', '잘못된 입력'],
  ['statusConverged', '已收敛', '収束済み', '수렴됨'],
  ['statusMeasured', '已测量', '測定済み', '측정됨'],
  ['statusPartial', '部分完成', '一部のみ', '부분 완료'],
  ['statusCuratedOfficial', '经整理的官方来源', '精査済みの公的情報源', '선별된 공식 출처'],
  ['statusUserDeclaredOfficial', '用户声明的官方来源', 'ユーザー申告の公的情報源', '사용자 선언 공식 출처'],
  ['statusUnverified', '未核实', '未検証', '검증되지 않음'],
  ['statusContextOnly', '仅作背景依据', '文脈情報のみ', '맥락 전용'],
  ['statusNotValidated', '未验证', '未検証', '검증되지 않음'],
  ['statusBlockedRequiresRevision', '已阻断——需要修改问卷', '停止中 — 調査票の修正が必要', '차단됨 — 설문 수정 필요'],
  ['statusFieldDraftRequiresReview', '实地草稿——需要审查', '実査用草案 — レビューが必要', '현장 조사 초안 — 검토 필요'],
  ['statusBlocked', '已阻断', '停止中', '차단됨'],
  ['statusReadyForResearcherReview', '可供研究人员审查', '研究者レビュー待ち', '연구자 검토 준비 완료'],
  ['statusSingleSelect', '单选', '単一選択', '단일 선택'],
  ['statusRankOrder', '排序', '順位付け', '순위 정렬'],
  ['statusMatrixSingleSelect', '矩阵单选', 'マトリクス単一選択', '매트릭스 단일 선택'],
  ['statusOpenText', '开放文本', '自由記述', '주관식'],
  ['statusStimulus', '刺激材料', '刺激', '자극물'],
  ['statusInstruction', '说明', '説明', '안내'],
  ['statusMethodTemplate', '方法模板', '手法テンプレート', '방법 템플릿'],
  ['statusUserInput', '用户输入', 'ユーザー入力', '사용자 입력'],
  ['statusModelFraming', '模型框定', 'モデルによるフレーミング', '모델 프레이밍'],
  ['statusDraft', '草稿', '草案', '초안'],
  ['statusRequiresResearcherOperationalization', '需要研究人员转化为可执行定义', '研究者による操作的定義が必要', '연구자의 조작적 정의 필요'],
  ['statusResearcherDesignRequired', '需要研究人员设计', '研究者による設計が必要', '연구자 설계 필요'],
  ['statusTargetsUnavailable', '目标不可用', '目標値を利用できません', '목표를 사용할 수 없음'],
  ['statusPlanningEstimate', '规划估算', '計画上の推定', '계획 추정'],
  ['statusUnestimated', '未估算', '未推定', '추정되지 않음'],
  ['statusMonitorOnly', '仅监测', '監視のみ', '모니터링 전용'],
  ['statusNotApplicable', '不适用', '適用対象外', '해당 없음'],
  ['statusPopulationReferenceOnly', '仅作为总体参考', '母集団の参照のみ', '모집단 참고 전용'],
  ['statusFullDistribution', '完整分布', '全分布', '전체 분포'],
  ['statusTopTwoBox', '高分两档', '上位2区分', '상위 2개 응답'],
  ['statusInsufficientRuns', '运行次数不足', '実行回数が不足', '실행 횟수 부족'],
  ['statusNotComparable', '不可比较', '比較不可', '비교 불가'],
  ['statusComparable', '可比较', '比較可能', '비교 가능'],
  ['statusNone', '无', 'なし', '없음'],
  ['statusRakingIpf', '迭代比例拟合（IPF）', '反復比例調整（IPF）', '반복비례적합(IPF)'],
  ['statusPostStratification', '事后分层', '事後層化', '사후 층화'],
  ['consentRequired', '参与研究需要知情同意。', '調査への参加にはインフォームドコンセントが必要です。', '연구 참여에는 사전 동의가 필요합니다.'],
  ['recruitmentInstructionReview', '由真人研究人员审查研究工具并进行认知预测试。', '人である研究者が調査票を確認し、認知プレテストを行ってください。', '실제 연구자가 조사 도구를 검토하고 인지 사전 테스트를 수행하세요.'],
  ['recruitmentInstructionEthics', '完成适用的伦理、隐私、同意、无障碍和数据保护审查。', '該当する倫理、プライバシー、同意、アクセシビリティ、データ保護の審査を完了してください。', '해당 윤리, 개인정보 보호, 동의, 접근성 및 데이터 보호 검토를 완료하세요.'],
  ['recruitmentInstructionProviders', '使用完整筛选题和总体参考维度向服务提供方确认可行性；不要将合成细分人群标签作为可招募身份分享。', '正確なスクリーナーと母集団の参照次元を用いて調査会社に実現可能性を確認し、合成セグメントのラベルを募集対象の属性として共有しないでください。', '정확한 선별 질문과 모집단 참고 차원으로 제공업체에 실행 가능성을 확인하고 합성 세그먼트 레이블을 모집 가능한 정체성으로 공유하지 마세요.'],
  ['recruitmentInstructionSoftLaunch', '在全面实地执行前进行小规模试运行。', '本実査の前に小規模なソフトローンチを行ってください。', '전체 현장 조사 전에 소규모 사전 실행을 하세요.'],
  ['recruitmentInstructionFreezeRules', '在查看实质性结果前，冻结重复答卷、过快作答、直线作答、开放文本质量、排除和加权规则。', '実質的な結果を確認する前に、重複、早すぎる回答、同一選択、自由記述の品質、除外、重み付けのルールを確定してください。', '실질적 결과를 확인하기 전에 중복, 과속 응답, 동일 응답 반복, 주관식 품질, 제외 및 가중치 규칙을 확정하세요.'],
  ['recruitmentInstructionMonitor', '监测发生率、招募进度、中途退出、排除情况和参与者报酬。', '出現率、募集の進捗、中断、除外、参加者への謝礼を監視してください。', '발생률, 모집 진행 상황, 중도 이탈, 제외 및 응답자 보상을 모니터링하세요.'],
  ['missingHumanTranslation', '真人翻译与地区审校', '人による翻訳とロケールレビュー', '사람에 의한 번역 및 로케일 검토'],
  ['missingQuotaTargets', '可辩护的实际样本配额目标', '根拠のある実績サンプル割付目標', '근거 있는 실제 표본 할당 목표'],
  ['missingIncidence', '观察到的或服务提供方报价中的发生率', '観察値または調査会社の見積もりによる出現率', '관찰된 발생률 또는 제공업체 견적 발생률'],
  ['missingSurveyDuration', '认知预测试后的问卷时长', '認知プレテスト後の調査所要時間', '인지 사전 테스트 후 설문 소요 시간'],
  ['missingProviderFeasibility', '服务提供方的可行性、价格和时间', '調査会社の実現可能性、価格、時期', '제공업체 실행 가능성, 가격 및 일정'],
  ['missingMethodSampleDesign', '特定研究方法的样本量或定性停止规则设计', '調査手法別のサンプルサイズまたは定性調査の停止ルール設計', '연구 방법별 표본 크기 또는 정성 조사 중단 규칙 설계'],
  ['missingBrandMatrixDesign', '品牌熟悉度、“无”/“不确定”处理及中性矩阵顺序', 'ブランド認知度、「該当なし」・「不明」の扱い、中立的なマトリクス順序', '브랜드 인지도, 해당 없음/모름 처리 및 중립적인 매트릭스 순서'],
  ['missingPriceExposureDesign', '价格展示、分支、分配与呈现顺序方案', '価格提示、分岐、割付、提示順の計画', '가격 노출, 분기, 할당 및 제시 순서 계획'],
  ['missingObservedTaskProtocol', '如拟验证可用性，需要观察性任务方案', 'ユーザビリティ検証を行う場合の観察タスク・プロトコル', '사용성 검증을 의도한 경우의 관찰 과제 프로토콜'],
  ['missingSubgroupPower', '预注册的子群统计功效要求', '事前登録したサブグループの検出力要件', '사전 등록된 하위 집단 검정력 요구사항'],
  ['missingApprovals', '伦理、隐私和司法辖区审批状态', '倫理、プライバシー、管轄地域の承認状況', '윤리, 개인정보 보호 및 관할권 승인 상태'],
  ['localizationSettings', '本地化设置', 'ローカライズ設定', '현지화 설정'],
  ['localizationSettingsNote', '分别设置各项本地化维度。已启用的文案仍为机器起草，等待母语审校。', 'ローカライズの各項目を個別に設定します。有効な文面は機械起草であり、ネイティブレビュー待ちです。', '각 현지화 차원을 별도로 설정하세요. 활성화된 문구는 기계 초안이며 원어민 검토 대기 상태입니다.'],
  ['marketLocalizationNote', '设置总体框定和检索所用的地理范围；不会选择语言。', '母集団フレームと検索に使う地域を設定します。言語は選択しません。', '모집단 프레임 및 검색에 사용할 지역을 설정하며 언어를 선택하지는 않습니다.'],
  ['reportLanguageNote', '控制报告和模型输出的语言。', 'レポートとモデル出力の言語を指定します。', '보고서 및 모델 출력 언어를 제어합니다.'],
  ['sourceLanguageNote', '控制来源语言筛选；不会改变报告语言。', '情報源の言語フィルタを指定します。レポート言語は変更しません。', '출처 언어 필터를 제어하며 보고서 언어는 변경하지 않습니다.'],
  ['retrievalLanguage', '检索语言', '検索言語', '검색 언어'],
  ['retrievalLanguageNote', '选择检索时采用所选来源语言的严格程度。', '検索で選択した情報源言語をどの程度優先するかを選びます。', '검색에서 선택한 출처 언어를 얼마나 엄격하게 사용할지 선택합니다.'],
  ['retrievalPolicy', '检索策略', '検索方針', '검색 정책'],
  ['retrievalAny', '任何语言', 'すべての言語', '모든 언어'],
  ['retrievalPrefer', '优先所选语言', '選択した言語を優先', '선택한 언어 우선'],
  ['retrievalRequire', '要求提供方语言元数据与文字脚本检查通过', '提供元の言語情報と文字種チェックを必須にする', '제공자 언어 정보와 문자 체계 검사 필수'],
  ['retrievalLocaleRequired', '设为必须前，请先选择来源语言。', '必須にする前に情報源言語を選択してください。', '필수로 설정하기 전에 출처 언어를 선택하세요.'],
  ['instrumentLanguage', '研究工具语言', '調査票の言語', '조사 도구 언어'],
  ['instrumentLanguageNote', '控制面向参与者的草稿语言；仍需真人翻译审校。', '回答者向け草案の言語を指定します。人による翻訳レビューは引き続き必要です。', '응답자용 초안 언어를 제어하며 사람에 의한 번역 검토가 여전히 필요합니다.'],
  ['interfaceLanguageNote', '仅控制界面文案。', 'インターフェースの文面だけを変更します。', '인터페이스 문구만 제어합니다.'],
  ['localizationDimensionsIndependent', '界面、报告、来源与检索、研究工具语言彼此独立。', 'インターフェース、レポート、情報源と検索、調査票の各言語は独立しています。', '인터페이스, 보고서, 출처 및 검색, 조사 도구 언어는 서로 독립적입니다.'],
  ['localizationConfigurationError', '本地化设置需要处理（{code}）。', 'ローカライズ設定を確認してください（{code}）。', '현지화 설정을 확인해야 합니다({code}).'],
  ['studyRunError', '研究未能完成。请检查设置后重试。参考代码：{code}', '調査を完了できませんでした。設定を確認して再試行してください。参照：{code}', '연구를 완료하지 못했습니다. 설정을 확인한 후 다시 시도하세요. 참조: {code}'],
  ['unsupportedLocaleSelection', '已保存的语言不受支持：{locales}。请在运行前选择已启用的语言。', '保存済みの未対応ロケール：{locales}。実行前に有効なロケールを選択してください。', '지원되지 않는 저장 로케일: {locales}. 실행하기 전에 활성화된 로케일을 선택하세요.'],
  ['reportInstrumentMismatch', '报告与研究工具的语言不同；需要真人翻译审校。', 'レポートと調査票の言語が異なります。人による翻訳レビューが必要です。', '보고서와 조사 도구 언어가 다르므로 사람에 의한 번역 검토가 필요합니다.'],
  ['retrievalRequireWarning', '如果提供方声明的主要语言不匹配，或摘录未通过已登记的文字脚本检查，本次运行将失败。这不是语言识别。', '提供元が申告した主要言語が一致しない場合、または抜粋が登録済みの文字種チェックに合格しない場合、実行は失敗します。これは言語識別ではありません。', '제공자가 선언한 기본 언어가 일치하지 않거나 발췌문이 등록된 문자 체계 검사를 통과하지 못하면 실행이 실패합니다. 이는 언어 식별이 아닙니다.'],
  ['sourceLanguageFilter', '来源语言筛选', '情報源の言語フィルタ', '출처 언어 필터'],
  ['sourceLanguageFilterNote', '根据所选策略按来源语言限制检索。', '選択した方針に従い、情報源の言語で検索を制限します。', '선택한 정책에 따라 출처 언어로 검색을 제한합니다.'],
  ['sourceLanguagesNone', '不筛选来源语言', '情報源の言語フィルタなし', '출처 언어 필터 없음'],
  ['selectedLocaleCount', '已选择 {count} 种', '{count}件選択済み', '{count}개 선택됨'],
  ['addOrRemoveLanguages', '最多选择四种语言。', '最大4言語を選択できます。', '최대 4개 언어를 선택하세요.'],
  ['sameAsReport', '与报告相同', 'レポートと同じ', '보고서와 동일'],
  ['useSeparateInstrumentLanguage', '使用单独的语言', '別の言語を使用', '별도 언어 사용'],
  ['useInterfaceForStudy', '报告和研究工具使用界面语言', 'レポートと調査票にインターフェース言語を使用', '보고서 및 조사 도구에 인터페이스 언어 사용'],
  ['researchMaterialReadError', '无法添加 {file}。请确认文件符合支持的类型和大小限制。', '{file} を追加できませんでした。対応する種類とサイズの制限を満たしているか確認してください。', '{file}을(를) 추가할 수 없습니다. 지원되는 형식과 크기 제한을 충족하는지 확인하세요.'],
  ['researchMaterialPasteError', '无法添加粘贴的研究摘录。', '貼り付けた調査抜粋を追加できませんでした。', '붙여 넣은 연구 발췌문을 추가할 수 없습니다.'],
  ['normalizationNotApplicable', '不适用于此结果类型。', 'この結果形式には適用されません。', '이 결과 유형에는 적용되지 않습니다.'],
  ['normalizationPercentSum', '百分比已标准化为总和 100%。', '割合は合計100%になるよう正規化されています。', '백분율은 합계가 100%가 되도록 정규화됩니다.'],
  ['limitationWebSourcesUntrusted', '网页来源是未经信任的检索文本，并非独立验证。', 'ウェブ情報源は信頼性を確認していない取得テキストであり、独立した検証ではありません。', '웹 출처는 신뢰성이 확인되지 않은 검색 텍스트이며 독립적인 검증이 아닙니다.'],
  ['limitationNoExternalEvidence', '本次运行未使用从外部获取的来源证据。', 'この実行では外部から取得した情報源の根拠を使用していません。', '이 실행에서는 외부에서 확보한 출처 근거를 사용하지 않았습니다.'],
  ['limitationSyntheticPanel', '模拟面板并非真人样本。', '模擬パネルは人を対象としたサンプルではありません。', '시뮬레이션 패널은 실제 사람 표본이 아닙니다.'],
  ['limitationMethodResult', '此方法结果由模型生成，并非真人研究。', 'この手法の結果はモデル生成であり、人を対象とした調査ではありません。', '이 방법의 결과는 모델이 생성한 것이며 실제 사람 연구가 아닙니다.'],
  ['limitationNoObservedHuman', '不包含观察到的真人回答。', '観測された人の回答は含まれていません。', '관찰된 실제 사람 응답은 포함되지 않습니다.'],
  ['limitationSegmentsModelGenerated', '细分人群和合成原话均为模型生成的假设。', 'セグメントと合成回答例はモデル生成の仮説です。', '세그먼트와 합성 응답 예시는 모델이 생성한 가설입니다.'],
  ['evidencePackExportType', 'Likerts 证据包', 'Likerts 証拠パック', 'Likerts 근거 패키지'],
  ['associationLevelForAttribute', '{attribute}：{level}关联', '{attribute}：関連度{level}', '{attribute}: {level} 연관'],
  ['clientSuppliedContextNote', '无状态端点会检查内部一致性，但不会独立验证客户端提供的运行上下文。', 'ステートレスなエンドポイントは内部整合性を確認しますが、クライアント提供の実行コンテキストを独立して認証するものではありません。', '무상태 엔드포인트는 내부 일관성을 확인하지만 클라이언트가 제공한 실행 맥락을 독립적으로 인증하지는 않습니다.'],
  ['evidenceModePriorOnly', '仅先验知识证据', '事前知識のみの根拠', '사전 지식 전용 근거'],
  ['evidenceModeGateway', '通过网关检索的证据', 'ゲートウェイで取得した根拠', '게이트웨이 검색 근거'],
  ['evidenceModeModelOnly', '仅模型证据', 'モデルのみの根拠', '모델 전용 근거'],
  ['statusFailed', '失败', '失敗', '실패'],
  ['statusRunning', '运行中', '実行中', '실행 중'],
  ['statusPending', '待处理', '保留中', '대기 중'],
];

const cjkCompletionRows = Object.freeze([
  ...cjkPopulationAndStabilityRows,
  ...cjkMethodRows,
  ...cjkWorkflowRows,
  ...cjkStaticCallsiteRows,
]);

export const CJK_COMPLETION_TRANSLATIONS = Object.freeze(Object.fromEntries(CJK_UI_LOCALES.map((locale, localeIndex) => [
  locale,
  Object.freeze(Object.fromEntries(cjkCompletionRows.map(([key, ...values]) => [key, values[localeIndex]]))),
])));

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const placeholdersFor = (message) => [...String(message).matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
const isCjkUiLocale = (locale) => CJK_UI_LOCALES.includes(locale);

export class MissingUiVariableError extends Error {
  constructor(locale, key, missingVariables) {
    super(`Missing UI variables for ${locale} ${key}: ${missingVariables.join(', ')}`);
    this.name = 'MissingUiVariableError';
    this.locale = locale;
    this.key = key;
    this.missingVariables = Object.freeze([...missingVariables]);
  }
}

export function interpolateUiMessage(value, variables = {}, context = {}) {
  const replacements = variables && typeof variables === 'object' ? variables : {};
  const requiredVariables = [...new Set(placeholdersFor(value))];
  const missingVariables = requiredVariables.filter((key) => !own(replacements, key) || replacements[key] === null || replacements[key] === undefined);
  if (missingVariables.length) throw new MissingUiVariableError(context.locale || 'unknown', context.key || 'unknown', missingVariables);
  return Object.entries(replacements).reduce((text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)), String(value));
}

const localeSlice = (translations, locale) => translations[locale]
  || (isCjkUiLocale(locale) ? {} : translations['en-US'] || {});

function assembleUiCatalog(locale) {
  const cjk = isCjkUiLocale(locale);
  return {
    ...(dictionaries[locale] || (cjk ? {} : en)),
    ...(reportUiTranslations[locale] || {}),
    ...localeSlice(supplementalUiTranslations, locale),
    ...localeSlice(evidenceUiTranslations, locale),
    ...localeSlice(researchUiTranslations, locale),
    ...localeSlice(researchStatusTranslations, locale),
    ...localeSlice(syntheticMethodTranslations, locale),
    ...localeSlice(gatewayCostTranslations, locale),
    ...localeSlice(researchMethodUiTranslations, locale),
    ...localeSlice(purchaseMethodTranslations, locale),
    ...(segmentPerspectiveTranslations[locale] || {}),
    ...localeSlice(marketRoutingTranslations, locale),
    ...localeSlice(sampleLineageUiTranslations, locale),
    ...(cjk ? {} : uxUiTranslations['en-US'] || {}),
    ...(uxUiTranslations[locale] || {}),
    ...(CJK_COMPLETION_TRANSLATIONS[locale] || {}),
  };
}

export function uiCatalogCoverage(reference, candidate) {
  const referenceKeys = Object.keys(reference).sort();
  const candidateKeys = Object.keys(candidate).sort();
  const missing = referenceKeys.filter((key) => !own(candidate, key));
  const extra = candidateKeys.filter((key) => !own(reference, key));
  const placeholderMismatch = referenceKeys.filter((key) => own(candidate, key)
    && JSON.stringify(placeholdersFor(reference[key])) !== JSON.stringify(placeholdersFor(candidate[key])));
  const nonString = candidateKeys.filter((key) => typeof candidate[key] !== 'string');
  const englishIdentical = referenceKeys.filter((key) => own(candidate, key) && candidate[key] === reference[key]);
  const unintendedEnglishIdentical = englishIdentical.filter((key) => !CJK_UI_CANONICAL_TECHNICAL_KEYS.includes(key));
  return Object.freeze({
    exactKeySet: missing.length === 0 && extra.length === 0,
    placeholderParity: placeholderMismatch.length === 0,
    stringsOnly: nonString.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    placeholderMismatch: Object.freeze(placeholderMismatch),
    nonString: Object.freeze(nonString),
    englishIdentical: Object.freeze(englishIdentical),
    unintendedEnglishIdentical: Object.freeze(unintendedEnglishIdentical),
  });
}

export function assertExactUiCatalogCoverage(locale, reference, candidate) {
  const coverage = uiCatalogCoverage(reference, candidate);
  const problems = [
    coverage.missing.length ? `missing: ${coverage.missing.join(', ')}` : '',
    coverage.extra.length ? `extra: ${coverage.extra.join(', ')}` : '',
    coverage.placeholderMismatch.length ? `placeholder mismatch: ${coverage.placeholderMismatch.join(', ')}` : '',
    coverage.nonString.length ? `non-string: ${coverage.nonString.join(', ')}` : '',
    coverage.unintendedEnglishIdentical.length ? `identical to English: ${coverage.unintendedEnglishIdentical.join(', ')}` : '',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Incomplete ${locale} UI catalog (${problems.join('; ')})`);
  return coverage;
}

function assertEnabledUiCatalogCoverage(locale, reference, candidate) {
  const coverage = uiCatalogCoverage(reference, candidate);
  const problems = [
    coverage.missing.length ? `missing: ${coverage.missing.join(', ')}` : '',
    coverage.extra.length ? `extra: ${coverage.extra.join(', ')}` : '',
    coverage.placeholderMismatch.length ? `placeholder mismatch: ${coverage.placeholderMismatch.join(', ')}` : '',
    coverage.nonString.length ? `non-string: ${coverage.nonString.join(', ')}` : '',
    locale === 'en-US' || !coverage.unintendedEnglishIdentical.length ? '' : `identical to English: ${coverage.unintendedEnglishIdentical.join(', ')}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`Incomplete enabled ${locale} UI catalog (${problems.join('; ')})`);
  return coverage;
}

export const ENGLISH_UI_CATALOG = Object.freeze(assembleUiCatalog('en-US'));
export const UI_CATALOG_KEY_SET = Object.freeze(Object.keys(ENGLISH_UI_CATALOG).sort());
export const ENABLED_UI_LOCALE_IDS = Object.freeze(languageOptions.map(({ value: locale }) => locale));
const ENABLED_UI_LOCALE_SET = new Set(ENABLED_UI_LOCALE_IDS);
export const ENABLED_UI_CATALOGS = Object.freeze(Object.fromEntries(languageOptions.map(({ value: locale }) => {
  const catalog = Object.freeze(assembleUiCatalog(locale));
  assertEnabledUiCatalogCoverage(locale, ENGLISH_UI_CATALOG, catalog);
  return [locale, catalog];
})));
export const CJK_UI_CATALOGS = Object.freeze(Object.fromEntries(CJK_UI_LOCALES.map((locale) => [locale, ENABLED_UI_CATALOGS[locale]])));

for (const locale of CJK_UI_LOCALES) {
  for (const options of [
    languageOptions,
    reportLanguageOptions,
    sourceLanguageOptions,
    retrievalLanguageOptions,
    instrumentLanguageOptions,
  ]) {
    const option = options.find((entry) => entry.value === locale);
    if (!option || option.copyStatus !== CJK_UI_COPY_PROVENANCE[locale].copyStatus || option.nativeReviewStatus !== CJK_UI_COPY_PROVENANCE[locale].nativeReviewStatus) {
      throw new Error(`${locale} UI copy must match the shared localization registry release metadata.`);
    }
  }
}

export function createUiCatalog(locale) {
  assertSupportedUiLocale(locale);
  return ENABLED_UI_CATALOGS[locale];
}

export class UnsupportedUiLocaleError extends Error {
  constructor(locale) {
    super(`Unsupported UI locale: ${locale}`);
    this.name = 'UnsupportedUiLocaleError';
    this.locale = locale;
  }
}

export function assertSupportedUiLocale(locale) {
  if (!ENABLED_UI_LOCALE_SET.has(locale)) throw new UnsupportedUiLocaleError(locale);
  return locale;
}

export class MissingUiTranslationError extends Error {
  constructor(locale, key) {
    super(`Missing UI translation for ${locale}: ${key}`);
    this.name = 'MissingUiTranslationError';
    this.locale = locale;
    this.key = key;
  }
}

export function resolveUiMessage(catalog, key, variables, locale = 'en-US') {
  assertSupportedUiLocale(locale);
  if (own(catalog, key)) return interpolateUiMessage(catalog[key], variables, { locale, key });
  if (isCjkUiLocale(locale)) throw new MissingUiTranslationError(locale, key);
  return interpolateUiMessage(ENGLISH_UI_CATALOG[key] || key, variables, { locale, key });
}

export function getLanguageName(locale, displayLocale) {
  const configured = [
    languageOptions,
    reportLanguageOptions,
    sourceLanguageOptions,
    retrievalLanguageOptions,
    instrumentLanguageOptions,
  ].flat().find((item) => item.value === locale);
  const languageTag = configured?.value || (typeof locale === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale.trim()) ? locale.trim() : null);
  if (displayLocale && languageTag) {
    try {
      return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(languageTag) || configured?.nativeLabel || locale;
    } catch {
      // Keep the configured native presentation label when an environment
      // cannot render the requested display locale.
    }
  }
  return configured?.nativeLabel || locale;
}
