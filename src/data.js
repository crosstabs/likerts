export const responseScale = [
  { label: 'Very unlikely', shortLabel: 'Very unlikely', tone: 'negative-strong' },
  { label: 'Unlikely', shortLabel: 'Unlikely', tone: 'negative' },
  { label: 'Not sure', shortLabel: 'Not sure', tone: 'neutral' },
  { label: 'Likely', shortLabel: 'Likely', tone: 'positive' },
  { label: 'Very likely', shortLabel: 'Very likely', tone: 'positive-strong' },
];

export const markets = [
  { value: 'Global', region: null, searchCountry: 'US', searchLocation: '' },
  { value: 'United States', region: 'US', searchCountry: 'US', searchLocation: 'United States' },
  { value: 'United Kingdom', region: 'GB', searchCountry: 'GB', searchLocation: 'United Kingdom' },
  { value: 'Canada', region: 'CA', searchCountry: 'CA', searchLocation: 'Canada' },
  { value: 'Brazil', region: 'BR', searchCountry: 'BR', searchLocation: 'Brazil' },
  { value: 'Mexico', region: 'MX', searchCountry: 'MX', searchLocation: 'Mexico' },
  { value: 'France', region: 'FR', searchCountry: 'FR', searchLocation: 'France' },
  { value: 'Germany', region: 'DE', searchCountry: 'DE', searchLocation: 'Germany' },
  { value: 'India', region: 'IN', searchCountry: 'IN', searchLocation: 'India' },
  { value: 'China', region: 'CN', searchCountry: 'CN', searchLocation: 'China' },
  { value: 'Japan', region: 'JP', searchCountry: 'JP', searchLocation: 'Japan' },
  { value: 'South Korea', region: 'KR', searchCountry: 'KR', searchLocation: 'South Korea' },
  { value: 'Singapore', region: 'SG', searchCountry: 'SG', searchLocation: 'Singapore' },
  { value: 'Australia', region: 'AU', searchCountry: 'AU', searchLocation: 'Australia' },
  { value: 'United Arab Emirates', region: 'AE', searchCountry: 'AE', searchLocation: 'United Arab Emirates' },
  { value: 'South Africa', region: 'ZA', searchCountry: 'ZA', searchLocation: 'South Africa' },
];

export const runStages = [
  {
    id: 'frame',
    shortLabel: 'Frame',
    label: 'Brief parsed',
    description: 'Turn the objective into a testable Likert item.',
  },
  {
    id: 'ground',
    shortLabel: 'Search',
    label: 'Evidence checked',
    description: 'Separate supplied sources, assumptions, and model inference.',
  },
  {
    id: 'simulate',
    shortLabel: 'Simulate',
    label: 'Panel simulated',
    description: 'Generate disagreement across model-constructed respondents.',
  },
  {
    id: 'review',
    shortLabel: 'Review',
    label: 'Independent review',
    description: 'Challenge unsupported claims and calibrate the final read.',
  },
];

export const initialStudy = {
  prompt: 'How likely are you to adopt a four-day workweek if salary and output expectations remain unchanged?',
  audience: 'Knowledge workers in organisations with 50–1,000 employees · Ages 25–54',
  market: 'Global',
  outputLocale: 'en-US',
  sourceLanguages: [],
  panelSize: 200,
  sources: [],
  assumptions: 'Salary remains unchanged; employers keep clear output expectations; the working day does not become materially longer.',
  distribution: [7, 11, 14, 32, 36],
};

export const segmentRows = [
  { label: 'Ages 25–34', sample: 86, values: [5, 9, 12, 34, 40] },
  { label: 'Ages 35–54', sample: 114, values: [8, 13, 16, 31, 32] },
  { label: 'Remote-first', sample: 92, values: [4, 8, 12, 34, 42] },
  { label: 'Office-first', sample: 108, values: [10, 14, 16, 30, 30] },
];

export const syntheticResponses = [
  {
    score: 5,
    profile: 'Remote-first product manager · 31',
    quote: 'A shorter week would be compelling if priorities were clearer and the same workload was not compressed into longer days.',
  },
  {
    score: 4,
    profile: 'Hybrid operations lead · 43',
    quote: 'I would support a trial if customer coverage and handoffs had a credible plan.',
  },
  {
    score: 3,
    profile: 'Finance specialist · 36',
    quote: 'The idea is attractive, but month-end workload makes the practical effect hard to judge.',
  },
  {
    score: 2,
    profile: 'Client services director · 51',
    quote: 'I would worry that the fifth day simply becomes unofficial availability without reducing expectations.',
  },
];

export const initialResult = {
  title: 'Likelihood to adopt',
  summary: 'A majority of this audience responded positively to the idea in your research question.',
  takeaway: 'The illustrative panel suggests a positive directional signal. Use human follow-up research to test operational trade-offs and whether the preference persists under realistic constraints.',
  distribution: initialStudy.distribution,
  confidence: 'Low',
  confidenceNote: 'Illustrative seed data shown before the first model-generated study.',
  audienceSummary: {
    audienceLabel: 'Knowledge workers',
    contextLabel: 'Global · Ages 25–54',
    attributes: [
      { label: 'Gender model', value: 'Female 52% · Male 48%' },
      { label: 'Age (mean)', value: '36' },
      { label: 'Work context', value: 'Illustrative global mix' },
    ],
  },
  segments: segmentRows,
  responses: syntheticResponses,
  cautions: [
    'Illustrative data is not a human-panel estimate.',
    'Validate decisions with human research.',
  ],
  evidence: [
    {
      id: 'seed-distribution',
      claim: '63% likely',
      evidenceClass: 'Model inference',
      trace: 'Brief → illustrative panel → normalized distribution',
      risk: 'Not representative',
      sourceTitle: '',
      sourceUrl: '',
    },
    {
      id: 'seed-segment',
      claim: 'Daily commuters show stronger interest',
      evidenceClass: 'Model inference',
      trace: 'Audience frame → model-constructed segment',
      risk: 'Segment not sampled',
      sourceTitle: '',
      sourceUrl: '',
    },
    {
      id: 'seed-theme',
      claim: 'Savings clarity may drive intent',
      evidenceClass: 'Synthetic verbatim theme',
      trace: 'Generated explanations with scores 4–5',
      risk: 'Not customer testimony',
      sourceTitle: '',
      sourceUrl: '',
    },
  ],
  credibility: {
    evidenceCoverage: 0,
    populationFit: 'Unspecified',
    modelAgreement: null,
    status: 'Model-only',
    assumptionCount: 2,
  },
  methodology: {
    promptVersion: 'likerts.seed.v1',
    schemaVersion: '1.0',
    normalization: 'Percentages are normalized to sum to 100.',
    knownLimits: [
      'No observed human responses are included.',
      'Segments and verbatims are model-generated hypotheses.',
    ],
  },
  meta: {
    source: 'Illustrative demo',
    model: 'Seed dataset',
    runId: 'demo_seed',
    generatedAt: 'Illustrative seed',
    persistence: 'session',
    market: 'Global',
    outputLocale: 'en-US',
    lineage: [
      { role: 'Framing', model: 'Not run', provider: '—' },
      { role: 'Panel', model: 'Not run', provider: '—' },
      { role: 'Review', model: 'Not run', provider: '—' },
    ],
  },
};
