import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAMPLE_STUDY_SCHEMA_VERSION, sampleStudies, validateSampleStudyRegistry } from '../content/sample-studies.mjs';
import { CJK_LOCALE_IDS, LOCALIZATION_REGISTRY_VERSION, requireLocaleCapability } from '../shared/localization.mjs';
import { normalizeLocalizationRequest } from '../server/localization-request.js';
import { ATTITUDINAL_ACCURACY_DISCLAIMER, buildPopulationFrame, populationFrameSchema } from '../server/population-frame.js';
import { buildResearchDesign } from '../server/research-methods.js';
import { SAMPLE_AUTOMATED_QA_SCOPE, canonicalSampleLineageForSample } from '../server/sample-lineage.js';
import { resolveInputHashLineage } from '../src/lib/inputHashLineage.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultCaptureDirectory = resolve(root, 'content/sample-study-captures');
const publicDirectory = resolve(root, 'public');
const defaultOutputDirectory = publicDirectory;
const siteOrigin = 'https://likerts.com';
const socialCardVersion = 'v1';
const socialCardDirectory = 'social';
const socialCardManifestFilename = `social-card-manifest-${socialCardVersion}.json`;
const socialBrandAssetBaseName = `brand-line-en-${socialCardVersion}`;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let atomicWriteSequence = 0;

async function atomicWriteFile(file, contents) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${atomicWriteSequence += 1}`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
const secretKey = /(api[-_]?key|authorization|cookie|secret|password|clientrunid)/i;
const modelPerspectiveDisclosure = 'Model-generated perspective—not a participant quotation.';
const cjkStaticLocales = new Set(CJK_LOCALE_IDS);
const acquisitionLocales = Object.freeze(['en-US', 'zh-CN', 'ja-JP', 'ko-KR']);
const brandLineByLocale = Object.freeze({
  'en-US': 'Likerts — Free Synthetic Research',
  'es-ES': 'Likerts — Investigación sintética gratuita',
  'pt-BR': 'Likerts — Pesquisa sintética gratuita',
  'fr-FR': 'Likerts — Recherche synthétique gratuite',
  'de-DE': 'Likerts — Kostenlose synthetische Forschung',
  'zh-CN': 'Likerts — 免费合成研究',
  'ja-JP': 'Likerts — 無料の合成リサーチ',
  'ko-KR': 'Likerts — 무료 합성 리서치',
  'ar-SA': 'Likerts — بحث تركيبي مجاني',
  'hi-IN': 'Likerts — निःशुल्क संश्लेषित शोध',
});
const modelCaveatByLocale = Object.freeze({
  'en-US': 'Model-generated—not human participant evidence',
  'es-ES': 'Generado por modelos; no es evidencia de participantes humanos',
  'pt-BR': 'Gerado por modelo; não é evidência de participantes humanos',
  'fr-FR': 'Généré par modèle ; ce n’est pas une preuve de participants humains',
  'de-DE': 'Modellgeneriert – keine Evidenz von menschlichen Teilnehmenden',
  'zh-CN': '由模型生成，不是人类参与者证据',
  'ja-JP': 'モデル生成であり、人の参加者による証拠ではありません',
  'ko-KR': '모델 생성이며 사람 참여자 증거가 아닙니다',
  'ar-SA': 'مولّد بالنموذج وليس دليلاً من مشاركين بشريين',
  'hi-IN': 'मॉडल-जनित; मानव प्रतिभागियों का साक्ष्य नहीं',
});
const localizedLandingCopy = Object.freeze({
  'en-US': {
    eyebrow: 'Synthetic research for planning',
    title: 'Explore a market-research question before you field it.',
    socialTitle: 'Explore your question. Then field it with people.',
    socialDescription: 'Turn a focused question into a plan for human validation.',
    description: 'Likerts helps researchers turn a defined audience, decision, and assumptions into directional synthetic hypotheses—then prepare the human research needed to test them.',
    disclosure: 'Synthetic output is model-generated, not a survey of people. It is not representative, deterministic, causal evidence, or a substitute for human validation.',
    primary: 'Open Likerts',
    examples: 'Browse sample studies',
    methodTitle: 'A bounded starting point',
    method: ['Frame a decision and audience.', 'Inspect the disclosed assumptions, source context, and uncertainty.', 'Use the output to plan interviews, surveys, or experiments with people.'],
  },
  'zh-CN': {
    eyebrow: '用于研究规划的合成研究',
    title: '在实地研究前，先探索一个市场研究问题。',
    socialDescription: '围绕明确的受众、决策和假设形成合成研究假设。',
    description: 'Likerts 帮助研究人员围绕明确的受众、决策和假设，形成方向性的合成假设，并为后续人工研究做好准备。',
    disclosure: '合成输出由模型生成，不是对人的调查。它不具代表性、不可确定复现、不能证明因果，也不能替代人工验证。',
    primary: '打开 Likerts',
    examples: '浏览示例研究',
    methodTitle: '有边界的起点',
    method: ['明确决策和受众。', '检查已披露的假设、来源背景和不确定性。', '用输出规划与真实人群进行的访谈、问卷或实验。'],
  },
  'ja-JP': {
    eyebrow: '調査設計のための合成リサーチ',
    title: '実査の前に、市場調査の問いを探索する。',
    socialDescription: '対象者、意思決定、前提を明確にして検証計画を整えます。',
    description: 'Likerts は、明確な対象者・意思決定・前提から方向性のある合成仮説を整理し、その後に人で検証する調査の準備を支援します。',
    disclosure: '合成出力はモデルが生成したもので、人への調査ではありません。代表性、決定論性、因果の証拠を提供せず、人による検証の代わりにもなりません。',
    primary: 'Likertsを開く',
    examples: 'サンプル研究を見る',
    methodTitle: '境界を明示した出発点',
    method: ['意思決定と対象者を明確にする。', '開示された前提、情報源の文脈、不確実性を確認する。', '出力を使って、人へのインタビュー、調査、実験を設計する。'],
  },
  'ko-KR': {
    eyebrow: '리서치 계획을 위한 합성 리서치',
    title: '현장 조사 전에 시장조사 질문을 탐색하세요.',
    socialDescription: '대상, 의사결정, 가정을 바탕으로 검증 계획을 준비합니다.',
    description: 'Likerts는 명확한 대상, 의사결정, 가정을 바탕으로 방향성 있는 합성 가설을 정리하고, 이후 사람을 대상으로 검증할 연구를 준비하도록 돕습니다.',
    disclosure: '합성 결과는 모델이 생성한 것이며 사람을 대상으로 한 설문이 아닙니다. 대표성, 결정론성, 인과 증거를 제공하지 않으며 사람 검증을 대체하지 않습니다.',
    primary: 'Likerts 열기',
    examples: '샘플 연구 보기',
    methodTitle: '경계를 지킨 출발점',
    method: ['의사결정과 대상을 명확히 합니다.', '공개된 가정, 출처 맥락, 불확실성을 검토합니다.', '결과를 사용해 사람 대상 인터뷰, 설문 또는 실험을 설계합니다.'],
  },
});
const cjkEnglishDocumentCopy = Object.freeze({
  'zh-CN': { accessible: '英文页面' },
  'ja-JP': { accessible: '英語ページ' },
  'ko-KR': { accessible: '영어 페이지' },
});
const cjkQaScopeCopy = Object.freeze({
  'zh-CN': { label: '检查范围', boundary: '仅检查示例简报合同；不涵盖本次运行、生成结果或人工验证。' },
  'ja-JP': { label: '確認範囲', boundary: 'サンプルのブリーフ契約のみを確認し、この実行、生成結果、人による検証は対象外です。' },
  'ko-KR': { label: '검사 범위', boundary: '샘플 브리프 계약만 검사하며 이 실행, 생성 결과 또는 사람 검증은 포함하지 않습니다.' },
});
const cjkJsonSafetyCopy = Object.freeze({
  'zh-CN': {
    segmentBoundary: '这是模型构建的分析分群，不是观察到的参与者群体。',
    modelPerspectiveDisclosure: '模型生成的观点，不是参与者引语。',
    methodDisclosure: '特定方法的输出是模型生成的方向性结果，不是人类测量。',
    methodCaution: '这个兼容旧版的方法是一般性的方向性 Likert 探索，不是专门的研究设计。',
    modelCardDisclosure: '人口匹配并不能证明态度准确性。在用真实人群验证前，合成结果仍只是模型生成的假设。',
    provenanceDisclaimer: '模型生成不是确定性的；此记录支持审计和比较，不支持精确重放或确定性结论。',
    stabilityInterpretation: '这些稳定性指标只描述模型生成单元之间的一致性，不衡量人类确定性。',
    verificationNote: '这是同一管线中的独立模型阶段，不是独立的外部验证。',
  },
  'ja-JP': {
    segmentBoundary: 'これはモデルが構築した分析セグメントであり、観測された参加者集団ではありません。',
    modelPerspectiveDisclosure: 'モデルが生成した視点であり、参加者の発言ではありません。',
    methodDisclosure: 'この方法固有の出力は、モデルが生成した方向性であり、人による測定ではありません。',
    methodCaution: 'このレガシー互換の方法は、一般的な方向性の Likert 探索であり、専門的な調査設計ではありません。',
    modelCardDisclosure: '人口統計上の適合は態度の正確性を証明しません。実際の人で検証されるまで、合成結果はモデル生成の仮説です。',
    provenanceDisclaimer: 'モデル生成は決定論的ではありません。この記録は監査と比較を支援しますが、正確な再現や確実性を支えるものではありません。',
    stabilityInterpretation: 'この安定性指標は、モデル生成セル間の一致度だけを示し、人の確実性を測るものではありません。',
    verificationNote: 'これは同一パイプライン内の別のモデル段階であり、独立した外部検証ではありません。',
  },
  'ko-KR': {
    segmentBoundary: '이는 모델이 구성한 분석 세그먼트이며 관찰된 참여자 집단이 아닙니다.',
    modelPerspectiveDisclosure: '모델이 생성한 관점이며 참여자 인용이 아닙니다.',
    methodDisclosure: '방법별 출력은 모델이 생성한 방향성 결과이며 사람 측정이 아닙니다.',
    methodCaution: '이 레거시 호환 방법은 일반적인 방향성 Likert 탐색이며 특화된 연구 설계가 아닙니다.',
    modelCardDisclosure: '인구통계적 적합성은 태도 정확성을 증명하지 않습니다. 실제 사람으로 검증되기 전까지 합성 결과는 모델 생성 가설입니다.',
    provenanceDisclaimer: '모델 생성은 결정론적이지 않습니다. 이 기록은 감사와 비교를 지원하지만 정확한 재현이나 확실성을 뒷받침하지 않습니다.',
    stabilityInterpretation: '이 안정성 지표는 모델 생성 셀 간의 일치도만 설명하며 사람의 확실성을 측정하지 않습니다.',
    verificationNote: '이는 하나의 파이프라인 안에서 분리된 모델 단계이며 독립적인 외부 검증이 아닙니다.',
  },
});
const hasSecretShapedKey = (value) => {
  if (Array.isArray(value)) return value.some(hasSecretShapedKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) => secretKey.test(key) || hasSecretShapedKey(child));
};
const scaleLabels = ['Strongly unlikely', 'Unlikely', 'Not sure', 'Likely', 'Strongly likely'];
const scaleClasses = ['strongly-unlikely', 'unlikely', 'neutral', 'likely', 'strongly-likely'];
const industryNames = Object.freeze({
  'workplace-ai': 'Workplace AI',
  'electric-mobility': 'Electric mobility',
  'consumer-products': 'Consumer products',
  travel: 'Travel',
  housing: 'Home energy',
  'financial-services': 'Financial services',
  media: 'Media',
  education: 'Education',
  agriculture: 'Agriculture',
});
const presentationNames = Object.freeze({
  'zh-CN': {
    locales: { 'en-US': '英语（美国）', 'es-ES': '西班牙语（西班牙）', 'pt-BR': '葡萄牙语（巴西）', 'fr-FR': '法语（法国）', 'de-DE': '德语（德国）', 'zh-CN': '中文（中国）', 'ja-JP': '日语（日本）', 'ko-KR': '韩语（韩国）', 'ar-SA': '阿拉伯语（沙特阿拉伯）', 'hi-IN': '印地语（印度）' },
    industries: { 'workplace-ai': '职场 AI', 'electric-mobility': '电动出行', 'consumer-products': '消费品', travel: '旅行', housing: '家庭能源', 'financial-services': '金融服务', media: '媒体', education: '教育', agriculture: '农业' },
    markets: { 'United States': '美国', Spain: '西班牙', Brazil: '巴西', France: '法国', Germany: '德国', China: '中国', Japan: '日本', 'South Korea': '韩国', 'Saudi Arabia': '沙特阿拉伯', India: '印度' },
  },
  'ja-JP': {
    locales: { 'en-US': '英語（米国）', 'es-ES': 'スペイン語（スペイン）', 'pt-BR': 'ポルトガル語（ブラジル）', 'fr-FR': 'フランス語（フランス）', 'de-DE': 'ドイツ語（ドイツ）', 'zh-CN': '中国語（中国）', 'ja-JP': '日本語（日本）', 'ko-KR': '韓国語（韓国）', 'ar-SA': 'アラビア語（サウジアラビア）', 'hi-IN': 'ヒンディー語（インド）' },
    industries: { 'workplace-ai': '職場向け AI', 'electric-mobility': '電動モビリティ', 'consumer-products': '消費財', travel: '旅行', housing: '住宅エネルギー', 'financial-services': '金融サービス', media: 'メディア', education: '教育', agriculture: '農業' },
    markets: { 'United States': 'アメリカ合衆国', Spain: 'スペイン', Brazil: 'ブラジル', France: 'フランス', Germany: 'ドイツ', China: '中国', Japan: '日本', 'South Korea': '韓国', 'Saudi Arabia': 'サウジアラビア', India: 'インド' },
  },
  'ko-KR': {
    locales: { 'en-US': '영어(미국)', 'es-ES': '스페인어(스페인)', 'pt-BR': '포르투갈어(브라질)', 'fr-FR': '프랑스어(프랑스)', 'de-DE': '독일어(독일)', 'zh-CN': '중국어(중국)', 'ja-JP': '일본어(일본)', 'ko-KR': '한국어(대한민국)', 'ar-SA': '아랍어(사우디아라비아)', 'hi-IN': '힌디어(인도)' },
    industries: { 'workplace-ai': '업무용 AI', 'electric-mobility': '전기 모빌리티', 'consumer-products': '소비재', travel: '여행', housing: '주택 에너지', 'financial-services': '금융 서비스', media: '미디어', education: '교육', agriculture: '농업' },
    markets: { 'United States': '미국', Spain: '스페인', Brazil: '브라질', France: '프랑스', Germany: '독일', China: '중국', Japan: '일본', 'South Korea': '대한민국', 'Saudi Arabia': '사우디아라비아', India: '인도' },
  },
});
const requireSampleLocale = (locale) => requireLocaleCapability(locale, 'sample');
// Preserve locale-specific presentation wording (notably the shorter zh-CN
// self-label) while using the registry as the canonical metadata fallback.
const sampleLocaleName = (locale) => presentationNames[locale]?.locales?.[locale] || requireSampleLocale(locale).nativeLabel;
const localizedLocaleName = (locale, presentationLocale = 'en-US') => presentationNames[presentationLocale]?.locales?.[locale] || sampleLocaleName(locale);
const localizedIndustryName = (industry, presentationLocale = 'en-US') => presentationNames[presentationLocale]?.industries?.[industry] || industryNames[industry] || industry;
const localizedMarketName = (market, presentationLocale = 'en-US') => presentationNames[presentationLocale]?.markets?.[market] || market;

// UI copy is deliberately separate from study data. Brief titles, questions, and
// evidence notes are editorial content; this dictionary localizes the surrounding
// interface without changing the catalog schema or the frozen study records.
const localeUi = Object.freeze({
  'en-US': {
    nav: { home: 'Likerts home', open: 'Open Likerts', studies: 'Sample studies', methodology: 'Methodology', standards: 'Research standards', limitations: 'Limitations', newStudy: 'New study', primary: 'Primary' },
    footer: { label: 'Likerts — Free Synthetic Research', aria: 'Footer', studies: 'Sample studies', how: 'How it works', methodology: 'Methodology', limitations: 'Limitations', llms: 'llms.txt' },
    hub: { eyebrow: 'Sample studies', title: 'Synthetic Market Research Examples', description: 'Browse free, frozen synthetic market research examples with disclosed sources, model disagreement, cost, uncertainty, and human-validation next steps.', boundaryLabel: 'Synthetic examples only.', boundary: 'These are model-generated examples. No people were surveyed. They are not representative and are not deterministic.', run: 'Run your own study', review: 'How samples are reviewed', breadcrumb: 'Sample studies', hub: 'Hub', hubsAria: 'Study hubs', industry: 'Browse by industry', language: 'Studies by language', industryNote: 'Industry pages stay unpublished until an industry has enough original studies and guidance to avoid thin content.', llm: 'LLM discovery file' },
    table: { aria: 'Sample synthetic studies', study: 'Study', locale: 'Locale', industry: 'Industry', status: 'Status', direction: 'Direction', provenance: 'Provenance', cost: 'Cost', data: 'Data', action: 'Open study', published: 'Automated QA passed', pending: 'Capture pending', source: 'source', sources: 'sources', modelCells: 'model cells', noCost: 'n/a', json: 'JSON' },
    method: { title: 'What every published sample must disclose', steps: [['Frozen brief', 'The question, audience, language, market, and assumptions are visible.'], ['Source ledger', 'Public evidence is listed as context, not as independent validation.'], ['Model disagreement', 'Deep-mode cohorts disclose cell count and stability metrics.'], ['Human next step', 'Every page says what to validate with real participants before decisions.']] },
    detail: { breadcrumb: 'Breadcrumb', boundaryLabel: 'Synthetic sample', boundarySuffix: 'No people were surveyed; this is not representative or deterministic.', run: 'Run your own version', json: 'Machine-readable study JSON', browse: 'Browse all studies', meta: { audience: 'Audience', market: 'Market', language: 'Language', industry: 'Industry' }, distribution: 'Likert distribution', distributionNote: 'Five-point directional distribution from the frozen synthetic run.', model: 'Model disagreement', modelNote: 'not human certainty', mean: 'Mean JSD', spread: 'Max spread', modelPending: 'Capture not published', cell: 'Cell', recorded: 'recorded', segment: 'Segment hypotheses', segmentNote: 'Directional hypotheses generated by the model cohort, not sampled demographic claims.', units: 'synthetic simulation units', perspectives: 'Synthetic perspectives', perspectivesNote: 'These are generated perspectives for research planning. Do not quote them as customer testimony.', score: 'synthetic score', validation: 'Human-validation next steps', validationItems: ['Interview real participants', 'Quantify with a sampled survey', 'Check accessibility and privacy'], validationNotes: ['Use the synthetic output to prepare interviews with the intended audience before decisions.', 'Use the synthetic output to design a human survey if the decision needs a population estimate.', 'Review the concept with affected users and domain experts before shipping.'], evidence: 'Evidence/source ledger', source: 'Source', host: 'Host', mode: 'Mode', excerpt: 'Excerpt', noLedger: 'No source ledger has been published for this sample yet.', lineage: 'Run lineage', related: 'Related studies', receiptAria: 'Study receipt', receipt: 'Run receipt', status: 'Status', stableId: 'Stable study ID', runId: 'Run ID', runtime: 'Runtime', captured: 'Captured', evidenceHash: 'Evidence hash', gateway: 'Gateway cost', inputs: 'Inputs', unitsLabel: 'Simulation units', evidenceLabel: 'Evidence', sourcesLabel: 'Sources', outputLocale: 'Output locale', curated: 'Curated source guide', curatedNote: 'Official links selected before the run. They are context candidates, not proof that the runtime retrieved or verified them.', curatedType: 'Curated official context candidate', limitations: 'Known limitations', limitationsLink: 'Read limitations', pending: 'pending', noUrl: 'No URL', brief: 'Brief', cohort: 'Cohort', critic: 'Critic', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'Pending capture' }
  },
  'es-ES': {
    nav: { home: 'Inicio de Likerts', open: 'Abrir Likerts', studies: 'Estudios de muestra', methodology: 'Metodología', standards: 'Estándares de investigación', limitations: 'Limitaciones', newStudy: 'Nuevo estudio', primary: 'Principal' },
    footer: { label: 'Likerts — Investigación sintética gratuita', aria: 'Pie de página', studies: 'Estudios de muestra', how: 'Cómo funciona', methodology: 'Metodología', limitations: 'Limitaciones', llms: 'llms.txt' },
    hub: { eyebrow: 'Estudios de muestra', title: 'Estudios sintéticos de investigación', description: 'Ejemplos completos y congelados con fuentes declaradas, desacuerdo entre modelos, coste, incertidumbre y próximos pasos de validación humana.', boundaryLabel: 'Solo ejemplos sintéticos.', boundary: 'Son ejemplos generados por modelos. No se encuestó a ninguna persona. No son representativos y no son deterministas.', run: 'Crea tu propio estudio', review: 'Cómo se revisan las muestras', breadcrumb: 'Estudios de muestra', hub: 'Centro', hubsAria: 'Centros de estudios', industry: 'Explorar por sector', language: 'Estudios por idioma', industryNote: 'Las páginas por sector no se publican hasta tener suficientes estudios y orientación originales.', llm: 'Archivo de descubrimiento LLM' },
    table: { aria: 'Estudios sintéticos de muestra', study: 'Estudio', locale: 'Idioma', industry: 'Sector', status: 'Estado', direction: 'Dirección', provenance: 'Procedencia', cost: 'Coste', data: 'Datos', action: 'Abrir estudio', published: 'QA automatizado superado', pending: 'Captura pendiente', source: 'fuente', sources: 'fuentes', modelCells: 'celdas de modelo', noCost: 'n/d', json: 'JSON' },
    method: { title: 'Lo que debe declarar cada muestra publicada', steps: [['Brief congelado', 'La pregunta, audiencia, idioma, mercado y supuestos son visibles.'], ['Registro de fuentes', 'La evidencia pública aparece como contexto, no como validación independiente.'], ['Desacuerdo entre modelos', 'Las cohortes Deep declaran celdas y métricas de estabilidad.'], ['Siguiente paso humano', 'Cada página indica qué validar con participantes reales antes de decidir.']] },
    detail: { breadcrumb: 'Ruta de navegación', boundaryLabel: 'Muestra sintética', boundarySuffix: 'No se encuestó a ninguna persona; no es representativa ni determinista.', run: 'Crea tu propia versión', json: 'JSON del estudio legible por máquinas', browse: 'Ver todos los estudios', meta: { audience: 'Audiencia', market: 'Mercado', language: 'Idioma', industry: 'Sector' }, distribution: 'Distribución Likert', distributionNote: 'Distribución direccional de cinco puntos de la ejecución sintética congelada.', model: 'Desacuerdo entre modelos', modelNote: 'no certeza humana', mean: 'JSD medio', spread: 'Dispersión máxima', modelPending: 'Captura no publicada', cell: 'Celda', recorded: 'registrada', segment: 'Hipótesis por segmento', segmentNote: 'Hipótesis direccionales del grupo de modelos, no afirmaciones demográficas muestreadas.', units: 'unidades de simulación sintética', perspectives: 'Perspectivas sintéticas', perspectivesNote: 'Perspectivas generadas para planificar investigación. No las cites como testimonios de clientes.', score: 'puntuación sintética', validation: 'Siguientes pasos de validación humana', validationItems: ['Entrevistar a personas reales', 'Cuantificar con una encuesta muestreada', 'Comprobar accesibilidad y privacidad'], validationNotes: ['Usa el resultado sintético para preparar entrevistas con la audiencia antes de decidir.', 'Usa el resultado para diseñar una encuesta humana si necesitas una estimación poblacional.', 'Revisa el concepto con usuarios afectados y especialistas antes de publicarlo.'], evidence: 'Registro de evidencia y fuentes', source: 'Fuente', host: 'Host', mode: 'Modo', excerpt: 'Extracto', noLedger: 'Todavía no se ha publicado un registro de fuentes para esta muestra.', lineage: 'Linaje de la ejecución', related: 'Estudios relacionados', receiptAria: 'Recibo del estudio', receipt: 'Recibo de ejecución', status: 'Estado', stableId: 'ID estable del estudio', runId: 'ID de ejecución', runtime: 'Entorno', captured: 'Capturado', evidenceHash: 'Hash de evidencia', gateway: 'Coste de Gateway', inputs: 'Entradas', unitsLabel: 'Unidades de simulación', evidenceLabel: 'Evidencia', sourcesLabel: 'Fuentes', outputLocale: 'Idioma de salida', curated: 'Guía de fuentes seleccionadas', curatedNote: 'Enlaces oficiales elegidos antes de la ejecución. Son contexto, no prueba de recuperación o verificación.', curatedType: 'Candidato de contexto oficial seleccionado', limitations: 'Limitaciones conocidas', limitationsLink: 'Leer limitaciones', pending: 'pendiente', noUrl: 'Sin URL', brief: 'Brief', cohort: 'Cohorte', critic: 'Crítica', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'Captura pendiente' }
  },
  'pt-BR': {
    nav: { home: 'Início do Likerts', open: 'Abrir Likerts', studies: 'Estudos de amostra', methodology: 'Metodologia', standards: 'Padrões de pesquisa', limitations: 'Limitações', newStudy: 'Novo estudo', primary: 'Principal' },
    footer: { label: 'Likerts — Pesquisa sintética gratuita', aria: 'Rodapé', studies: 'Estudos de amostra', how: 'Como funciona', methodology: 'Metodologia', limitations: 'Limitações', llms: 'llms.txt' },
    hub: { eyebrow: 'Estudos de amostra', title: 'Estudos sintéticos de pesquisa', description: 'Exemplos completos e congelados com fontes declaradas, discordância entre modelos, custo, incerteza e próximos passos de validação humana.', boundaryLabel: 'Somente exemplos sintéticos.', boundary: 'São exemplos gerados por modelos. Nenhuma pessoa foi pesquisada. Não são representativos e não são determinísticos.', run: 'Crie seu próprio estudo', review: 'Como as amostras são revisadas', breadcrumb: 'Estudos de amostra', hub: 'Central', hubsAria: 'Centrais de estudos', industry: 'Navegar por setor', language: 'Estudos por idioma', industryNote: 'Páginas por setor só são publicadas quando há estudos e orientação originais suficientes.', llm: 'Arquivo de descoberta LLM' },
    table: { aria: 'Estudos sintéticos de amostra', study: 'Estudo', locale: 'Idioma', industry: 'Setor', status: 'Status', direction: 'Direção', provenance: 'Procedência', cost: 'Custo', data: 'Dados', action: 'Abrir estudo', published: 'QA automatizado aprovado', pending: 'Captura pendente', source: 'fonte', sources: 'fontes', modelCells: 'células de modelo', noCost: 'n/d', json: 'JSON' },
    method: { title: 'O que toda amostra publicada deve informar', steps: [['Brief congelado', 'A pergunta, o público, o idioma, o mercado e as premissas são visíveis.'], ['Registro de fontes', 'A evidência pública é contexto, não validação independente.'], ['Discordância entre modelos', 'As coortes Deep informam células e métricas de estabilidade.'], ['Próximo passo humano', 'Cada página diz o que validar com participantes reais antes de decidir.']] },
    detail: { breadcrumb: 'Navegação estrutural', boundaryLabel: 'Amostra sintética', boundarySuffix: 'Nenhuma pessoa foi pesquisada; não é representativa nem determinística.', run: 'Crie sua própria versão', json: 'JSON do estudo legível por máquina', browse: 'Ver todos os estudos', meta: { audience: 'Público', market: 'Mercado', language: 'Idioma', industry: 'Setor' }, distribution: 'Distribuição Likert', distributionNote: 'Distribuição direcional de cinco pontos da execução sintética congelada.', model: 'Discordância entre modelos', modelNote: 'não é certeza humana', mean: 'JSD médio', spread: 'Maior dispersão', modelPending: 'Captura não publicada', cell: 'Célula', recorded: 'registrada', segment: 'Hipóteses por segmento', segmentNote: 'Hipóteses direcionais da coorte de modelos, não afirmações demográficas amostradas.', units: 'unidades de simulação sintética', perspectives: 'Perspectivas sintéticas', perspectivesNote: 'Perspectivas geradas para planejar pesquisas. Não as cite como depoimentos de clientes.', score: 'pontuação sintética', validation: 'Próximos passos de validação humana', validationItems: ['Entrevistar pessoas reais', 'Quantificar com uma pesquisa amostrada', 'Verificar acessibilidade e privacidade'], validationNotes: ['Use o resultado sintético para preparar entrevistas com o público antes de decidir.', 'Use o resultado para desenhar uma pesquisa humana quando precisar de estimativa populacional.', 'Revise o conceito com usuários afetados e especialistas antes de lançar.'], evidence: 'Registro de evidências e fontes', source: 'Fonte', host: 'Host', mode: 'Modo', excerpt: 'Trecho', noLedger: 'Ainda não há registro de fontes publicado para esta amostra.', lineage: 'Linhagem da execução', related: 'Estudos relacionados', receiptAria: 'Recibo do estudo', receipt: 'Recibo da execução', status: 'Status', stableId: 'ID estável do estudo', runId: 'ID da execução', runtime: 'Ambiente', captured: 'Capturado', evidenceHash: 'Hash da evidência', gateway: 'Custo do Gateway', inputs: 'Entradas', unitsLabel: 'Unidades de simulação', evidenceLabel: 'Evidência', sourcesLabel: 'Fontes', outputLocale: 'Idioma de saída', curated: 'Guia de fontes selecionadas', curatedNote: 'Links oficiais escolhidos antes da execução. São contexto, não prova de recuperação ou verificação.', curatedType: 'Candidato de contexto oficial selecionado', limitations: 'Limitações conhecidas', limitationsLink: 'Ler limitações', pending: 'pendente', noUrl: 'Sem URL', brief: 'Brief', cohort: 'Coorte', critic: 'Crítica', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'Captura pendente' }
  },
  'fr-FR': {
    nav: { home: 'Accueil Likerts', open: 'Ouvrir Likerts', studies: 'Études exemples', methodology: 'Méthodologie', standards: 'Standards de recherche', limitations: 'Limites', newStudy: 'Nouvelle étude', primary: 'Principal' },
    footer: { label: 'Likerts — Recherche synthétique gratuite', aria: 'Pied de page', studies: 'Études exemples', how: 'Fonctionnement', methodology: 'Méthodologie', limitations: 'Limites', llms: 'llms.txt' },
    hub: { eyebrow: 'Études exemples', title: 'Études de recherche synthétiques', description: 'Exemples complets et figés avec sources déclarées, désaccord entre modèles, coût, incertitude et prochaines étapes de validation humaine.', boundaryLabel: 'Exemples synthétiques uniquement.', boundary: 'Ce sont des exemples générés par des modèles. Aucune personne n’a été interrogée. Ils ne sont pas représentatifs et ne sont pas déterministes.', run: 'Créer votre étude', review: 'Comment les exemples sont examinés', breadcrumb: 'Études exemples', hub: 'Centre', hubsAria: 'Centres d’études', industry: 'Parcourir par secteur', language: 'Études par langue', industryNote: 'Les pages par secteur restent non publiées tant qu’elles ne disposent pas de suffisamment d’études et de conseils originaux.', llm: 'Fichier de découverte LLM' },
    table: { aria: 'Études de recherche synthétiques', study: 'Étude', locale: 'Langue', industry: 'Secteur', status: 'Statut', direction: 'Direction', provenance: 'Provenance', cost: 'Coût', data: 'Données', action: 'Ouvrir l’étude', published: 'QA automatisée réussie', pending: 'Capture en attente', source: 'source', sources: 'sources', modelCells: 'cellules de modèle', noCost: 'n/d', json: 'JSON' },
    method: { title: 'Ce que chaque exemple publié doit déclarer', steps: [['Brief figé', 'Question, audience, langue, marché et hypothèses sont visibles.'], ['Registre des sources', 'Les preuves publiques sont du contexte, pas une validation indépendante.'], ['Désaccord des modèles', 'Les cohortes Deep déclarent le nombre de cellules et la stabilité.'], ['Prochaine étape humaine', 'Chaque page indique quoi valider avec de vraies personnes avant de décider.']] },
    detail: { breadcrumb: 'Fil d’Ariane', boundaryLabel: 'Exemple synthétique', boundarySuffix: 'Aucune personne n’a été interrogée ; ce résultat n’est ni représentatif ni déterministe.', run: 'Créer votre propre version', json: 'JSON de l’étude lisible par machine', browse: 'Voir toutes les études', meta: { audience: 'Audience', market: 'Marché', language: 'Langue', industry: 'Secteur' }, distribution: 'Distribution Likert', distributionNote: 'Distribution directionnelle à cinq points issue de l’exécution synthétique figée.', model: 'Désaccord entre modèles', modelNote: 'pas une certitude humaine', mean: 'JSD moyen', spread: 'Écart maximal', modelPending: 'Capture non publiée', cell: 'Cellule', recorded: 'enregistrée', segment: 'Hypothèses par segment', segmentNote: 'Hypothèses directionnelles de la cohorte de modèles, pas des affirmations démographiques échantillonnées.', units: 'unités de simulation synthétique', perspectives: 'Perspectives synthétiques', perspectivesNote: 'Perspectives générées pour préparer la recherche. Ne les citez pas comme témoignages clients.', score: 'score synthétique', validation: 'Prochaines étapes de validation humaine', validationItems: ['Interroger de vraies personnes', 'Quantifier avec une enquête échantillonnée', 'Vérifier accessibilité et confidentialité'], validationNotes: ['Utilisez ce résultat pour préparer des entretiens avec l’audience avant de décider.', 'Utilisez-le pour concevoir une enquête humaine si une estimation de population est nécessaire.', 'Faites relire le concept par les personnes concernées et des spécialistes avant lancement.'], evidence: 'Registre des preuves et sources', source: 'Source', host: 'Hôte', mode: 'Mode', excerpt: 'Extrait', noLedger: 'Aucun registre de sources n’est publié pour cet exemple.', lineage: 'Lignée d’exécution', related: 'Études similaires', receiptAria: 'Reçu de l’étude', receipt: 'Reçu d’exécution', status: 'Statut', stableId: 'ID stable de l’étude', runId: 'ID d’exécution', runtime: 'Version d’exécution', captured: 'Capturé', evidenceHash: 'Hash des preuves', gateway: 'Coût Gateway', inputs: 'Entrées', unitsLabel: 'Unités de simulation', evidenceLabel: 'Preuves', sourcesLabel: 'Sources', outputLocale: 'Langue de sortie', curated: 'Guide des sources sélectionnées', curatedNote: 'Liens officiels choisis avant l’exécution. Ils fournissent du contexte, pas la preuve d’une récupération ou vérification.', curatedType: 'Candidat de contexte officiel sélectionné', limitations: 'Limites connues', limitationsLink: 'Lire les limites', pending: 'en attente', noUrl: 'Sans URL', brief: 'Brief', cohort: 'Cohorte', critic: 'Critique', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'Capture en attente' }
  },
  'de-DE': {
    nav: { home: 'Likerts-Startseite', open: 'Likerts öffnen', studies: 'Beispielstudien', methodology: 'Methodik', standards: 'Forschungsstandards', limitations: 'Einschränkungen', newStudy: 'Neue Studie', primary: 'Hauptnavigation' },
    footer: { label: 'Likerts — Kostenlose synthetische Forschung', aria: 'Fußzeile', studies: 'Beispielstudien', how: 'So funktioniert es', methodology: 'Methodik', limitations: 'Einschränkungen', llms: 'llms.txt' },
    hub: { eyebrow: 'Beispielstudien', title: 'Synthetische Forschungsbeispiele', description: 'Vollständige, eingefrorene Beispiele mit offengelegten Quellen, Modellabweichung, Kosten, Unsicherheit und nächsten Schritten zur Validierung mit Menschen.', boundaryLabel: 'Nur synthetische Beispiele.', boundary: 'Dies sind modellgenerierte Beispiele. Es wurden keine Menschen befragt. Sie sind nicht repräsentativ und nicht deterministisch.', run: 'Eigene Studie erstellen', review: 'So werden Beispiele geprüft', breadcrumb: 'Beispielstudien', hub: 'Übersicht', hubsAria: 'Studienübersichten', industry: 'Nach Branche durchsuchen', language: 'Studien nach Sprache', industryNote: 'Branchenseiten bleiben unveröffentlicht, bis ausreichend eigene Studien und Orientierung verfügbar sind.', llm: 'LLM-Entdeckungsdatei' },
    table: { aria: 'Synthetische Beispielstudien', study: 'Studie', locale: 'Sprache', industry: 'Branche', status: 'Status', direction: 'Richtung', provenance: 'Herkunft', cost: 'Kosten', data: 'Daten', action: 'Studie öffnen', published: 'Automatisierte QA bestanden', pending: 'Erfassung ausstehend', source: 'Quelle', sources: 'Quellen', modelCells: 'Modellzellen', noCost: 'k. A.', json: 'JSON' },
    method: { title: 'Was jedes veröffentlichte Beispiel offenlegen muss', steps: [['Eingefrorenes Briefing', 'Frage, Zielgruppe, Sprache, Markt und Annahmen sind sichtbar.'], ['Quellenregister', 'Öffentliche Belege sind Kontext, keine unabhängige Validierung.'], ['Modellabweichung', 'Deep-Kohorten legen Zellzahl und Stabilitätsmetriken offen.'], ['Nächster Schritt mit Menschen', 'Jede Seite sagt, was vor Entscheidungen mit echten Personen zu validieren ist.']] },
    detail: { breadcrumb: 'Brotkrümelnavigation', boundaryLabel: 'Synthetisches Beispiel', boundarySuffix: 'Es wurden keine Menschen befragt; es ist nicht repräsentativ und nicht deterministisch.', run: 'Eigene Version erstellen', json: 'Maschinenlesbares Studien-JSON', browse: 'Alle Studien durchsuchen', meta: { audience: 'Zielgruppe', market: 'Markt', language: 'Sprache', industry: 'Branche' }, distribution: 'Likert-Verteilung', distributionNote: 'Fünfstufige richtungsweisende Verteilung aus dem eingefrorenen synthetischen Lauf.', model: 'Modellabweichung', modelNote: 'keine menschliche Gewissheit', mean: 'Mittlere JSD', spread: 'Maximale Streuung', modelPending: 'Erfassung nicht veröffentlicht', cell: 'Zelle', recorded: 'erfasst', segment: 'Segmenthypothesen', segmentNote: 'Richtungsweisende Hypothesen der Modellkohorte, keine Aussagen aus einer demografischen Stichprobe.', units: 'synthetische Simulationseinheiten', perspectives: 'Synthetische Perspektiven', perspectivesNote: 'Generierte Perspektiven zur Forschungsplanung. Nicht als Kundenstimmen zitieren.', score: 'synthetischer Score', validation: 'Nächste Schritte zur Validierung mit Menschen', validationItems: ['Echte Personen befragen', 'Mit einer Stichprobenerhebung quantifizieren', 'Barrierefreiheit und Datenschutz prüfen'], validationNotes: ['Nutzen Sie das Ergebnis zur Vorbereitung von Interviews mit der Zielgruppe vor Entscheidungen.', 'Nutzen Sie es für eine menschliche Befragung, wenn eine Populationsschätzung nötig ist.', 'Lassen Sie das Konzept vor dem Einsatz von Betroffenen und Fachleuten prüfen.'], evidence: 'Evidenz- und Quellenregister', source: 'Quelle', host: 'Host', mode: 'Modus', excerpt: 'Auszug', noLedger: 'Für dieses Beispiel wurde noch kein Quellenregister veröffentlicht.', lineage: 'Laufverlauf', related: 'Verwandte Studien', receiptAria: 'Studienbeleg', receipt: 'Laufbeleg', status: 'Status', stableId: 'Stabile Studien-ID', runId: 'Lauf-ID', runtime: 'Laufzeit', captured: 'Erfasst', evidenceHash: 'Evidenz-Hash', gateway: 'Gateway-Kosten', inputs: 'Eingaben', unitsLabel: 'Simulationseinheiten', evidenceLabel: 'Evidenz', sourcesLabel: 'Quellen', outputLocale: 'Ausgabesprache', curated: 'Ausgewählte Quellen', curatedNote: 'Vor dem Lauf ausgewählte offizielle Links. Sie sind Kontext, kein Nachweis für Abruf oder Prüfung.', curatedType: 'Ausgewählter offizieller Kontextkandidat', limitations: 'Bekannte Einschränkungen', limitationsLink: 'Einschränkungen lesen', pending: 'ausstehend', noUrl: 'Keine URL', brief: 'Briefing', cohort: 'Kohorte', critic: 'Kritik', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'Erfassung ausstehend' }
  },
  'zh-CN': {
    nav: { home: 'Likerts 首页', open: '打开 Likerts', studies: '示例研究', methodology: '方法论', standards: '研究标准', limitations: '局限性', newStudy: '新建研究', primary: '主导航' },
    footer: { label: 'Likerts — 免费合成研究', aria: '页脚', studies: '示例研究', how: '工作原理', methodology: '方法论', limitations: '局限性', llms: 'llms.txt' },
    hub: { eyebrow: '示例研究', title: '合成研究示例', description: '完整、冻结的示例，公开来源、模型分歧、成本、不确定性以及下一步人工验证建议。', boundaryLabel: '仅限合成示例。', boundary: '这些是模型生成的示例。没有对任何人进行调查。它们不具代表性，也不是确定性的。', run: '运行自己的研究', review: '示例如何审核', breadcrumb: '示例研究', hub: '中心', hubsAria: '研究中心', industry: '按行业浏览', language: '按语言查看研究', industryNote: '行业页面只有在拥有足够原创研究和指导、避免薄内容后才会发布。', llm: 'LLM 发现文件' },
    table: { aria: '合成研究示例', study: '研究', locale: '语言', industry: '行业', status: '状态', direction: '方向', provenance: '来源信息', cost: '成本', data: '数据', action: '打开研究', published: '自动化 QA 已通过', pending: '等待采集', source: '个来源', sources: '个来源', modelCells: '个模型单元', noCost: '无', json: 'JSON' },
    method: { title: '每个已发布示例必须披露的内容', steps: [['冻结的研究简报', '问题、受众、语言、市场和假设均清晰可见。'], ['来源登记表', '公开证据仅作为背景，不是独立验证。'], ['模型分歧', 'Deep 模式队列披露单元数量和稳定性指标。'], ['人工验证下一步', '每个页面说明在做决定前应与真实参与者验证什么。']] },
    detail: { breadcrumb: '面包屑导航', boundaryLabel: '合成示例', boundarySuffix: '没有对任何人进行调查；它不具代表性，也不是确定性的。', run: '运行自己的版本', json: '机器可读的研究 JSON', browse: '浏览所有研究', meta: { audience: '受众', market: '市场', language: '语言', industry: '行业' }, distribution: 'Likert 分布', distributionNote: '冻结合成运行的五点方向性分布。', model: '模型分歧', modelNote: '不是人类确定性', mean: '平均 JSD', spread: '最大差距', modelPending: '尚未发布采集结果', cell: '单元', recorded: '已记录', segment: '分群假设', segmentNote: '模型队列生成的方向性假设，不是抽样人口声明。', units: '个合成模拟单元', perspectives: '合成观点', perspectivesNote: '为研究规划生成的观点。不要将其引用为客户证言。', score: '合成分数', validation: '人工验证下一步', validationItems: ['访谈真实参与者', '使用抽样调查进行量化', '检查无障碍和隐私'], validationNotes: ['在做决定前，用此结果准备与目标受众的访谈。', '如果需要总体估计，用此结果设计人工调查。', '上线前请受影响用户和领域专家审阅概念。'], evidence: '证据/来源登记表', source: '来源', host: '主机', mode: '模式', excerpt: '摘录', sourceLanguage: '来源语言', noLedger: '此示例尚未发布来源登记表。', lineage: '运行谱系', related: '相关研究', receiptAria: '研究收据', receipt: '运行收据', status: '状态', stableId: '稳定研究 ID', runId: '运行 ID', runtime: '运行时', captured: '采集时间', evidenceHash: '证据哈希', gateway: 'Gateway 成本', inputs: '输入', unitsLabel: '模拟单元', evidenceLabel: '证据', sourcesLabel: '来源', outputLocale: '输出语言', curated: '精选来源指南', curatedNote: '运行前选出的官方链接。它们是背景，不证明运行时已检索或核实。', curatedType: '精选官方背景候选', limitations: '已知局限', limitationsLink: '阅读局限', pending: '等待中', noUrl: '无 URL', brief: '简报', cohort: '队列', critic: '批评审查', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: '等待采集' }
  },
  'ja-JP': {
    nav: { home: 'Likerts ホーム', open: 'Likertsを開く', studies: 'サンプル研究', methodology: '方法論', standards: '研究基準', limitations: '制限事項', newStudy: '新しい研究', primary: 'メイン' },
    footer: { label: 'Likerts — 無料の合成リサーチ', aria: 'フッター', studies: 'サンプル研究', how: '仕組み', methodology: '方法論', limitations: '制限事項', llms: 'llms.txt' },
    hub: { eyebrow: 'サンプル研究', title: '合成リサーチのサンプル', description: '出典、モデル間の相違、コスト、不確実性、次に人で検証すべきことを開示した、完全な固定例です。', boundaryLabel: '合成例のみ。', boundary: 'モデルが生成した例です。人を対象にした調査は行っていません。代表的な推定ではなく、決定論的でもありません。', run: '自分の研究を実行', review: 'サンプルのレビュー方法', breadcrumb: 'サンプル研究', hub: 'ハブ', hubsAria: '研究ハブ', industry: '業界から探す', language: '言語から探す', industryNote: '薄いコンテンツを避けるため、独自の研究とガイダンスが十分になるまで業界ページは公開しません。', llm: 'LLM 検出ファイル' },
    table: { aria: '合成サンプル研究', study: '研究', locale: '言語', industry: '業界', status: 'ステータス', direction: '方向', provenance: '来歴', cost: 'コスト', data: 'データ', action: '研究を開く', published: '自動 QA 合格', pending: '取得待ち', source: '出典', sources: '出典', modelCells: 'モデルセル', noCost: '該当なし', json: 'JSON' },
    method: { title: '公開するサンプルが必ず開示するもの', steps: [['固定したブリーフ', '質問、対象、言語、地域、前提を表示します。'], ['出典台帳', '公開情報は文脈として示し、独立検証とは扱いません。'], ['モデル間の相違', 'Deep のコホートはセル数と安定性指標を開示します。'], ['人での次の検証', '意思決定前に実際の参加者で何を検証するかを示します。']] },
    detail: { breadcrumb: 'パンくずリスト', boundaryLabel: '合成サンプル', boundarySuffix: '人を対象にした調査は行っておらず、代表的でも決定論的でもありません。', run: '自分のバージョンを実行', json: '機械可読な研究 JSON', browse: 'すべての研究を見る', meta: { audience: '対象', market: '市場', language: '言語', industry: '業界' }, distribution: 'Likert 分布', distributionNote: '固定した合成実行による 5 段階の方向性分布です。', model: 'モデル間の相違', modelNote: '人間の確実性ではありません', mean: '平均 JSD', spread: '最大幅', modelPending: '取得結果は未公開', cell: 'セル', recorded: '記録済み', segment: 'セグメント仮説', segmentNote: 'モデルコホートによる方向性の仮説であり、サンプル人口の主張ではありません。', units: '合成シミュレーション単位', perspectives: '合成された視点', perspectivesNote: '研究計画のために生成された視点です。顧客の証言として引用しないでください。', score: '合成スコア', validation: '人で次に検証すること', validationItems: ['実際の参加者にインタビューする', '標本調査で定量化する', 'アクセシビリティとプライバシーを確認する'], validationNotes: ['意思決定前に、対象者へのインタビュー準備にこの結果を使います。', '母集団推定が必要なら、人による調査の設計に使います。', '公開前に、影響を受ける利用者と専門家に概念を確認します。'], evidence: '証拠・出典台帳', source: '出典', host: 'ホスト', mode: 'モード', excerpt: '抜粋', sourceLanguage: '出典の言語', noLedger: 'このサンプルの出典台帳はまだ公開されていません。', lineage: '実行の系譜', related: '関連する研究', receiptAria: '研究レシート', receipt: '実行レシート', status: 'ステータス', stableId: '安定した研究 ID', runId: '実行 ID', runtime: 'ランタイム', captured: '取得日時', evidenceHash: '証拠ハッシュ', gateway: 'Gateway コスト', inputs: '入力', unitsLabel: 'シミュレーション単位', evidenceLabel: '証拠', sourcesLabel: '出典', outputLocale: '出力言語', curated: '選定出典ガイド', curatedNote: '実行前に選んだ公式リンクです。ランタイムが取得・検証した証明ではありません。', curatedType: '選定した公式文脈候補', limitations: '既知の制限', limitationsLink: '制限を読む', pending: '保留', noUrl: 'URL なし', brief: 'ブリーフ', cohort: 'コホート', critic: '批評', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: '取得待ち' }
  },
  'ko-KR': {
    nav: { home: 'Likerts 홈', open: 'Likerts 열기', studies: '샘플 연구', methodology: '방법론', standards: '연구 기준', limitations: '제한사항', newStudy: '새 연구', primary: '주 메뉴' },
    footer: { label: 'Likerts — 무료 합성 리서치', aria: '푸터', studies: '샘플 연구', how: '작동 방식', methodology: '방법론', limitations: '제한사항', llms: 'llms.txt' },
    hub: { eyebrow: '샘플 연구', title: '합성 리서치 샘플 연구', description: '출처, 모델 간 불일치, 비용, 불확실성, 다음 인간 검증 단계를 공개하는 완전한 고정 예시입니다.', boundaryLabel: '합성 예시만 제공됩니다.', boundary: '모델이 생성한 예시입니다. 사람을 대상으로 설문하지 않았습니다. 대표성이 없으며 결정론적이지 않습니다.', run: '내 연구 실행', review: '샘플 검토 방식', breadcrumb: '샘플 연구', hub: '허브', hubsAria: '연구 허브', industry: '산업별 찾아보기', language: '언어별 연구', industryNote: '얇은 콘텐츠를 피하기 위해 충분한 독창적 연구와 안내가 생길 때까지 산업 페이지를 공개하지 않습니다.', llm: 'LLM 검색 파일' },
    table: { aria: '합성 샘플 연구', study: '연구', locale: '언어', industry: '산업', status: '상태', direction: '방향', provenance: '출처 정보', cost: '비용', data: '데이터', action: '연구 열기', published: '자동 QA 통과', pending: '캡처 대기', source: '출처', sources: '출처', modelCells: '모델 셀', noCost: '해당 없음', json: 'JSON' },
    method: { title: '게시되는 모든 샘플의 공개 항목', steps: [['고정 브리프', '질문, 대상, 언어, 시장, 가정이 표시됩니다.'], ['출처 장부', '공개 근거는 독립 검증이 아니라 맥락으로 제시됩니다.'], ['모델 불일치', 'Deep 코호트가 셀 수와 안정성 지표를 공개합니다.'], ['인간 검증 다음 단계', '결정 전에 실제 참여자와 검증할 내용을 모든 페이지에서 안내합니다.']] },
    detail: { breadcrumb: '이동 경로', boundaryLabel: '합성 샘플', boundarySuffix: '사람을 대상으로 설문하지 않았으며 대표성이 없고 결정론적이지 않습니다.', run: '내 버전 실행', json: '기계 판독용 연구 JSON', browse: '모든 연구 보기', meta: { audience: '대상', market: '시장', language: '언어', industry: '산업' }, distribution: 'Likert 분포', distributionNote: '고정된 합성 실행의 5점 방향성 분포입니다.', model: '모델 불일치', modelNote: '사람의 확실성이 아님', mean: '평균 JSD', spread: '최대 범위', modelPending: '캡처가 게시되지 않음', cell: '셀', recorded: '기록됨', segment: '세그먼트 가설', segmentNote: '모델 코호트가 만든 방향성 가설이며 표본 인구 주장이 아닙니다.', units: '합성 시뮬레이션 단위', perspectives: '합성 관점', perspectivesNote: '연구 계획을 위한 생성 관점입니다. 고객 증언으로 인용하지 마세요.', score: '합성 점수', validation: '인간 검증 다음 단계', validationItems: ['실제 참여자 인터뷰', '표본 조사로 정량화', '접근성과 개인정보 보호 확인'], validationNotes: ['결정 전에 대상자 인터뷰를 준비하는 데 이 결과를 사용하세요.', '모집단 추정이 필요하면 인간 조사를 설계하는 데 사용하세요.', '출시 전에 영향을 받는 사용자와 전문가가 개념을 검토하게 하세요.'], evidence: '근거/출처 장부', source: '출처', host: '호스트', mode: '모드', excerpt: '발췌', sourceLanguage: '출처 언어', noLedger: '이 샘플의 출처 장부는 아직 게시되지 않았습니다.', lineage: '실행 계보', related: '관련 연구', receiptAria: '연구 영수증', receipt: '실행 영수증', status: '상태', stableId: '안정적 연구 ID', runId: '실행 ID', runtime: '런타임', captured: '캡처됨', evidenceHash: '근거 해시', gateway: 'Gateway 비용', inputs: '입력', unitsLabel: '시뮬레이션 단위', evidenceLabel: '근거', sourcesLabel: '출처', outputLocale: '출력 언어', curated: '선정 출처 안내', curatedNote: '실행 전에 선정한 공식 링크입니다. 런타임 검색이나 검증의 증거가 아닙니다.', curatedType: '선정된 공식 맥락 후보', limitations: '알려진 제한사항', limitationsLink: '제한사항 읽기', pending: '대기 중', noUrl: 'URL 없음', brief: '브리프', cohort: '코호트', critic: '비평', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: '캡처 대기' }
  },
  'ar-SA': {
    nav: { home: 'الصفحة الرئيسية لـ Likerts', open: 'فتح Likerts', studies: 'دراسات نموذجية', methodology: 'المنهجية', standards: 'معايير البحث', limitations: 'القيود', newStudy: 'دراسة جديدة', primary: 'الرئيسية' },
    footer: { label: 'Likerts — بحث تركيبي مجاني', aria: 'تذييل الصفحة', studies: 'دراسات نموذجية', how: 'كيف يعمل', methodology: 'المنهجية', limitations: 'القيود', llms: 'llms.txt' },
    hub: { eyebrow: 'دراسات نموذجية', title: 'دراسات بحثية تركيبية نموذجية', description: 'أمثلة كاملة ومجمّدة تفصح عن المصادر واختلاف النماذج والتكلفة وعدم اليقين وخطوات التحقق البشري التالية.', boundaryLabel: 'أمثلة تركيبية فقط.', boundary: 'هذه أمثلة مولّدة بالنماذج. لم يُستطلع أي شخص. وهي غير ممثلة للسكان وليست حتمية.', run: 'شغّل دراستك', review: 'كيف نراجع العينات', breadcrumb: 'دراسات نموذجية', hub: 'المركز', hubsAria: 'مراكز الدراسات', industry: 'تصفح حسب المجال', language: 'الدراسات حسب اللغة', industryNote: 'لا تُنشر صفحات المجالات حتى تتوفر دراسات وإرشادات أصلية كافية لتجنب المحتوى السطحي.', llm: 'ملف اكتشاف LLM' },
    table: { aria: 'دراسات بحثية تركيبية نموذجية', study: 'الدراسة', locale: 'اللغة', industry: 'المجال', status: 'الحالة', direction: 'الاتجاه', provenance: 'المصدر', cost: 'التكلفة', data: 'البيانات', action: 'فتح الدراسة', published: 'اجتاز ضمان الجودة الآلي', pending: 'بانتظار الالتقاط', source: 'مصدر', sources: 'مصادر', modelCells: 'خلايا نموذجية', noCost: 'غير متاح', json: 'JSON' },
    method: { title: 'ما يجب أن تفصح عنه كل عينة منشورة', steps: [['ملخص مجمّد', 'السؤال والجمهور واللغة والسوق والافتراضات ظاهرة.'], ['سجل المصادر', 'تُعرض الأدلة العامة كسياق لا كتحقق مستقل.'], ['اختلاف النماذج', 'تفصح مجموعات Deep عن عدد الخلايا ومقاييس الاستقرار.'], ['الخطوة البشرية التالية', 'توضح كل صفحة ما يجب التحقق منه مع مشاركين حقيقيين قبل القرارات.']] },
    detail: { breadcrumb: 'مسار التنقل', boundaryLabel: 'عينة تركيبية', boundarySuffix: 'لم يُستطلع أي شخص؛ وليست هذه النتيجة ممثلة للسكان أو حتمية.', run: 'شغّل نسختك', json: 'ملف JSON للدراسة قابل للقراءة آلياً', browse: 'تصفح كل الدراسات', meta: { audience: 'الجمهور', market: 'السوق', language: 'اللغة', industry: 'المجال' }, distribution: 'توزيع ليكرت', distributionNote: 'توزيع اتجاهي من خمس نقاط من التشغيل التركيبي المجمّد.', model: 'اختلاف النماذج', modelNote: 'ليس يقيناً بشرياً', mean: 'متوسط JSD', spread: 'أقصى اتساع', modelPending: 'لم تُنشر العينة', cell: 'خلية', recorded: 'مسجلة', segment: 'فرضيات الشرائح', segmentNote: 'فرضيات اتجاهية من مجموعة النماذج وليست ادعاءات سكانية مستندة إلى عينة.', units: 'وحدات محاكاة تركيبية', perspectives: 'وجهات نظر تركيبية', perspectivesNote: 'وجهات نظر مولّدة لتخطيط البحث. لا تقتبسها كشهادة عميل.', score: 'درجة تركيبية', validation: 'خطوات التحقق البشري التالية', validationItems: ['إجراء مقابلات مع أشخاص حقيقيين', 'القياس باستطلاع قائم على عينة', 'التحقق من إمكانية الوصول والخصوصية'], validationNotes: ['استخدم النتيجة لإعداد مقابلات مع الجمهور المستهدف قبل القرارات.', 'استخدمها لتصميم استطلاع بشري إذا احتجت تقديراً سكانياً.', 'اطلب مراجعة الفكرة من المستخدمين المتأثرين والخبراء قبل الإطلاق.'], evidence: 'سجل الأدلة والمصادر', source: 'المصدر', host: 'المضيف', mode: 'الوضع', excerpt: 'مقتطف', noLedger: 'لم يُنشر سجل مصادر لهذه العينة بعد.', lineage: 'تسلسل التشغيل', related: 'دراسات ذات صلة', receiptAria: 'إيصال الدراسة', receipt: 'إيصال التشغيل', status: 'الحالة', stableId: 'المعرّف الثابت للدراسة', runId: 'معرّف التشغيل', runtime: 'وقت التشغيل', captured: 'وقت الالتقاط', evidenceHash: 'تجزئة الدليل', gateway: 'تكلفة Gateway', inputs: 'المدخلات', unitsLabel: 'وحدات المحاكاة', evidenceLabel: 'الدليل', sourcesLabel: 'المصادر', outputLocale: 'لغة الإخراج', curated: 'دليل المصادر المختارة', curatedNote: 'روابط رسمية اختيرت قبل التشغيل. هي سياق وليست دليلاً على استرجاعها أو التحقق منها.', curatedType: 'مرشح سياق رسمي مختار', limitations: 'القيود المعروفة', limitationsLink: 'اقرأ القيود', pending: 'قيد الانتظار', noUrl: 'لا يوجد رابط', brief: 'الملخص', cohort: 'المجموعة', critic: 'النقد', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'بانتظار الالتقاط' }
  },
  'hi-IN': {
    nav: { home: 'Likerts होम', open: 'Likerts खोलें', studies: 'नमूना अध्ययन', methodology: 'कार्यप्रणाली', standards: 'शोध मानक', limitations: 'सीमाएँ', newStudy: 'नया अध्ययन', primary: 'मुख्य' },
    footer: { label: 'Likerts — निःशुल्क सिंथेटिक रिसर्च', aria: 'पाद लेख', studies: 'नमूना अध्ययन', how: 'यह कैसे काम करता है', methodology: 'कार्यप्रणाली', limitations: 'सीमाएँ', llms: 'llms.txt' },
    hub: { eyebrow: 'नमूना अध्ययन', title: 'संश्लेषित शोध के नमूना अध्ययन', description: 'स्रोत, मॉडल असहमति, लागत, अनिश्चितता और अगले मानव-सत्यापन चरणों के साथ पूर्ण, स्थिर उदाहरण।', boundaryLabel: 'केवल संश्लेषित उदाहरण।', boundary: 'ये मॉडल-जनित उदाहरण हैं। किसी व्यक्ति का सर्वेक्षण नहीं किया गया। ये प्रतिनिधि नहीं हैं और नियतात्मक नहीं हैं।', run: 'अपना अध्ययन चलाएँ', review: 'नमूनों की समीक्षा कैसे होती है', breadcrumb: 'नमूना अध्ययन', hub: 'केंद्र', hubsAria: 'अध्ययन केंद्र', industry: 'उद्योग के अनुसार देखें', language: 'भाषा के अनुसार अध्ययन', industryNote: 'पतली सामग्री से बचने के लिए पर्याप्त मौलिक अध्ययन और मार्गदर्शन होने तक उद्योग पृष्ठ प्रकाशित नहीं होंगे।', llm: 'LLM खोज फ़ाइल' },
    table: { aria: 'संश्लेषित नमूना अध्ययन', study: 'अध्ययन', locale: 'भाषा', industry: 'उद्योग', status: 'स्थिति', direction: 'दिशा', provenance: 'उत्पत्ति', cost: 'लागत', data: 'डेटा', action: 'अध्ययन खोलें', published: 'स्वचालित QA पास', pending: 'कैप्चर लंबित', source: 'स्रोत', sources: 'स्रोत', modelCells: 'मॉडल सेल', noCost: 'उपलब्ध नहीं', json: 'JSON' },
    method: { title: 'प्रकाशित हर नमूने को क्या बताना चाहिए', steps: [['स्थिर ब्रीफ़', 'प्रश्न, दर्शक, भाषा, बाज़ार और मान्यताएँ दिखाई देती हैं।'], ['स्रोत रजिस्टर', 'सार्वजनिक प्रमाण संदर्भ हैं, स्वतंत्र सत्यापन नहीं।'], ['मॉडल असहमति', 'Deep कोहोर्ट सेल संख्या और स्थिरता मेट्रिक्स बताता है।'], ['अगला मानव चरण', 'हर पृष्ठ निर्णय से पहले वास्तविक प्रतिभागियों के साथ जाँच बताता है।']] },
    detail: { breadcrumb: 'ब्रेडक्रंब', boundaryLabel: 'संश्लेषित नमूना', boundarySuffix: 'किसी व्यक्ति का सर्वेक्षण नहीं किया गया; यह प्रतिनिधि या नियतात्मक नहीं है।', run: 'अपना संस्करण चलाएँ', json: 'मशीन-पठनीय अध्ययन JSON', browse: 'सभी अध्ययन देखें', meta: { audience: 'दर्शक', market: 'बाज़ार', language: 'भाषा', industry: 'उद्योग' }, distribution: 'Likert वितरण', distributionNote: 'स्थिर संश्लेषित रन से पाँच-बिंदु दिशात्मक वितरण।', model: 'मॉडल असहमति', modelNote: 'मानव निश्चितता नहीं', mean: 'औसत JSD', spread: 'अधिकतम फैलाव', modelPending: 'कैप्चर प्रकाशित नहीं', cell: 'सेल', recorded: 'दर्ज', segment: 'सेगमेंट परिकल्पनाएँ', segmentNote: 'मॉडल समूह से बनी दिशात्मक परिकल्पनाएँ, नमूना जनसांख्यिकीय दावे नहीं।', units: 'संश्लेषित सिमुलेशन इकाइयाँ', perspectives: 'संश्लेषित दृष्टिकोण', perspectivesNote: 'शोध योजना के लिए बनाए गए दृष्टिकोण। इन्हें ग्राहक के कथन के रूप में उद्धृत न करें।', score: 'संश्लेषित स्कोर', validation: 'मानव-सत्यापन के अगले चरण', validationItems: ['वास्तविक प्रतिभागियों से बात करें', 'नमूना सर्वेक्षण से मात्रा आँकें', 'पहुँच और गोपनीयता जाँचें'], validationNotes: ['निर्णय से पहले लक्षित दर्शकों के साक्षात्कार तैयार करने में परिणाम का उपयोग करें।', 'यदि जनसंख्या अनुमान चाहिए तो मानव सर्वेक्षण तैयार करने में इसका उपयोग करें।', 'लॉन्च से पहले प्रभावित उपयोगकर्ताओं और विशेषज्ञों से अवधारणा की समीक्षा कराएँ।'], evidence: 'प्रमाण/स्रोत रजिस्टर', source: 'स्रोत', host: 'होस्ट', mode: 'मोड', excerpt: 'अंश', noLedger: 'इस नमूने के लिए स्रोत रजिस्टर अभी प्रकाशित नहीं हुआ है।', lineage: 'रन वंशावली', related: 'संबंधित अध्ययन', receiptAria: 'अध्ययन रसीद', receipt: 'रन रसीद', status: 'स्थिति', stableId: 'स्थिर अध्ययन ID', runId: 'रन ID', runtime: 'रनटाइम', captured: 'कैप्चर', evidenceHash: 'प्रमाण हैश', gateway: 'Gateway लागत', inputs: 'इनपुट', unitsLabel: 'सिमुलेशन इकाइयाँ', evidenceLabel: 'प्रमाण', sourcesLabel: 'स्रोत', outputLocale: 'आउटपुट भाषा', curated: 'चयनित स्रोत मार्गदर्शिका', curatedNote: 'रन से पहले चुने गए आधिकारिक लिंक। ये संदर्भ हैं, रनटाइम द्वारा प्राप्त या सत्यापित होने का प्रमाण नहीं।', curatedType: 'चयनित आधिकारिक संदर्भ उम्मीदवार', limitations: 'ज्ञात सीमाएँ', limitationsLink: 'सीमाएँ पढ़ें', pending: 'लंबित', noUrl: 'URL नहीं', brief: 'ब्रीफ़', cohort: 'कोहोर्ट', critic: 'समीक्षा', statusPublished: 'Automated QA passed · human editorial review pending', statusPending: 'कैप्चर लंबित' }
  }
});

const cjkPresentationCopy = Object.freeze({
  'zh-CN': {
    metadata: { ogImageAlt: 'Likerts：方向性合成研究，不是人类样本证据' },
    detail: {
      perspectiveDisclosure: '模型生成的观点，不是参与者引语。',
      stabilityExplanation: '这些稳定性指标只描述模型生成单元之间的一致性，不衡量人类确定性。',
      flaggedBoundaryLabel: '审查边界',
      flaggedBoundary: '批评审查已标记此运行。不会将模型生成的结论作为结果摘要展示；请仅将其用于规划人工验证。',
      criticEvidence: '批评审查证据',
      criticEvidenceNote: '以下内容来自管线内的批评模型，用于说明标记原因；它不是结果摘要，也不是独立外部验证。',
      criticSummary: '批评摘要',
      weakClaims: '标记的主张',
      biasSignals: '偏差提示',
      criticStatusFlagged: '已标记，不能作为结论摘要',
      criticStatusAccepted: '已记录',
    },
  },
  'ja-JP': {
    metadata: { ogImageAlt: 'Likerts：方向性を示す合成リサーチ。人を対象にしたパネルの証拠ではありません。' },
    detail: {
      perspectiveDisclosure: 'モデルが生成した視点であり、参加者の発言ではありません。',
      stabilityExplanation: 'この安定性指標は、モデル生成セル間の一致度だけを示し、人の確実性を測るものではありません。',
      flaggedBoundaryLabel: 'レビュー上の境界',
      flaggedBoundary: '批評レビューでこの実行はフラグされました。モデル生成の結論を結果要約として表示せず、人による検証計画にだけ使用してください。',
      criticEvidence: '批評レビューの根拠',
      criticEvidenceNote: '以下はパイプライン内の批評モデルによる指摘で、フラグの理由を示すものです。結果要約でも独立した外部検証でもありません。',
      criticSummary: '批評の要約',
      weakClaims: '指摘された主張',
      biasSignals: 'バイアスの兆候',
      criticStatusFlagged: 'フラグ済み：結論要約には使用不可',
      criticStatusAccepted: '記録済み',
    },
  },
  'ko-KR': {
    metadata: { ogImageAlt: 'Likerts: 방향성 합성 연구이며 사람 패널의 증거가 아닙니다.' },
    detail: {
      perspectiveDisclosure: '모델이 생성한 관점이며 참여자 인용이 아닙니다.',
      stabilityExplanation: '이 안정성 지표는 모델 생성 셀 간의 일치도만 설명하며 사람의 확실성을 측정하지 않습니다.',
      flaggedBoundaryLabel: '검토 경계',
      flaggedBoundary: '비평 검토에서 이 실행이 플래그되었습니다. 모델 생성 결론을 결과 요약으로 표시하지 않으며, 사람 검증을 계획하는 데에만 사용해야 합니다.',
      criticEvidence: '비평 검토 근거',
      criticEvidenceNote: '아래 내용은 플래그 사유를 설명하는 파이프라인 내 비평 모델의 지적입니다. 결과 요약이나 독립된 외부 검증이 아닙니다.',
      criticSummary: '비평 요약',
      weakClaims: '지적된 주장',
      biasSignals: '편향 신호',
      criticStatusFlagged: '플래그됨: 결론 요약으로 사용할 수 없음',
      criticStatusAccepted: '기록됨',
    },
  },
});

const uiFor = (locale) => {
  const base = localeUi[locale] || localeUi['en-US'];
  const additions = cjkPresentationCopy[locale];
  return additions ? { ...base, ...additions, detail: { ...base.detail, ...additions.detail } } : base;
};
const supportedUiLocales = Object.freeze(Object.keys(localeUi));
const staticSampleCopy = Object.freeze({
  'en-US': { automatedQa: 'Automated QA', nativeReview: 'Native review', localizationRegistry: 'Localization registry', qualityStatus: { passed: 'passed', pending: 'pending', 'review-pending': 'review pending', 'native-reviewed': 'native-language reviewed', unresolved: 'unresolved' } },
  'es-ES': { automatedQa: 'Control de calidad automatizado', nativeReview: 'Revisión por hablante nativo', localizationRegistry: 'Registro de localización', qualityStatus: { passed: 'aprobado', pending: 'pendiente', 'review-pending': 'revisión pendiente', 'native-reviewed': 'revisado por hablante nativo', unresolved: 'sin resolver' } },
  'pt-BR': { automatedQa: 'Controle de qualidade automatizado', nativeReview: 'Revisão por falante nativo', localizationRegistry: 'Registro de localização', qualityStatus: { passed: 'aprovado', pending: 'pendente', 'review-pending': 'revisão pendente', 'native-reviewed': 'revisado por falante nativo', unresolved: 'não resolvido' } },
  'fr-FR': { automatedQa: 'Assurance qualité automatisée', nativeReview: 'Révision par locuteur natif', localizationRegistry: 'Registre de localisation', qualityStatus: { passed: 'réussie', pending: 'en attente', 'review-pending': 'révision en attente', 'native-reviewed': 'révisé par un locuteur natif', unresolved: 'non résolue' } },
  'de-DE': { automatedQa: 'Automatisierte Qualitätssicherung', nativeReview: 'Muttersprachliche Prüfung', localizationRegistry: 'Lokalisierungsregister', qualityStatus: { passed: 'bestanden', pending: 'ausstehend', 'review-pending': 'Prüfung ausstehend', 'native-reviewed': 'muttersprachlich geprüft', unresolved: 'nicht aufgelöst' } },
  'zh-CN': { automatedQa: '自动质量检查', nativeReview: '母语审核', localizationRegistry: '本地化登记', qualityStatus: { passed: '已通过', pending: '待处理', 'review-pending': '审核待定', 'native-reviewed': '已由母语人士审核', unresolved: '未解决' } },
  'ja-JP': { automatedQa: '自動品質確認', nativeReview: 'ネイティブレビュー', localizationRegistry: 'ローカリゼーション登録簿', qualityStatus: { passed: '合格', pending: '保留', 'review-pending': 'レビュー待ち', 'native-reviewed': 'ネイティブによるレビュー済み', unresolved: '未解決' } },
  'ko-KR': { automatedQa: '자동 품질 검사', nativeReview: '원어민 검토', localizationRegistry: '현지화 레지스트리', qualityStatus: { passed: '통과', pending: '대기 중', 'review-pending': '검토 대기', 'native-reviewed': '원어민 검토 완료', unresolved: '미해결' } },
  'ar-SA': { automatedQa: 'فحص الجودة الآلي', nativeReview: 'مراجعة متحدث أصلي', localizationRegistry: 'سجل الترجمة المحلية', qualityStatus: { passed: 'تم الاجتياز', pending: 'قيد الانتظار', 'review-pending': 'المراجعة معلقة', 'native-reviewed': 'تمت المراجعة بواسطة متحدث أصلي', unresolved: 'غير محلول' } },
  'hi-IN': { automatedQa: 'स्वचालित गुणवत्ता जांच', nativeReview: 'मूल-भाषी समीक्षा', localizationRegistry: 'स्थानीयकरण रजिस्ट्री', qualityStatus: { passed: 'उत्तीर्ण', pending: 'लंबित', 'review-pending': 'समीक्षा लंबित', 'native-reviewed': 'मूल-भाषी द्वारा समीक्षित', unresolved: 'अनसुलझा' } },
});
const staticSampleCopyKeys = Object.freeze(['automatedQa', 'nativeReview', 'localizationRegistry']);
const qualityStatusKeys = Object.freeze(['passed', 'pending', 'review-pending', 'native-reviewed', 'unresolved']);

function nonEmptyCopy(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function staticSampleCopyFor(locale) {
  const copy = staticSampleCopy[locale];
  const missingLabel = staticSampleCopyKeys.find((key) => !nonEmptyCopy(copy?.[key]));
  const missingStatus = qualityStatusKeys.find((status) => !nonEmptyCopy(copy?.qualityStatus?.[status]));
  if (missingLabel || missingStatus) {
    const missing = missingLabel || `quality status ${missingStatus}`;
    throw new TypeError(`Missing static sample localization copy for ${locale}: ${missing}.`);
  }
  return copy;
}

export function assertStaticSampleLocalizationCopy(locales = supportedUiLocales) {
  if (!Array.isArray(locales)) throw new TypeError('Static sample localization locales must be an array.');
  for (const locale of new Set(locales)) {
    if (!localeUi[locale]) throw new TypeError(`Missing static sample UI catalog for ${locale}.`);
    staticSampleCopyFor(locale);
  }
}

export function resolveStaticSampleQualityStatus(locale, status) {
  const value = staticSampleCopyFor(locale).qualityStatus[status];
  if (!nonEmptyCopy(value)) throw new TypeError(`Missing static sample localization copy for ${locale}: quality status ${status}.`);
  return value;
}

const scaleLabelsByLocale = Object.freeze({
  'en-US': scaleLabels,
  'es-ES': ['Muy improbable', 'Improbable', 'No estoy seguro', 'Probable', 'Muy probable'],
  'pt-BR': ['Muito improvável', 'Improvável', 'Não sei', 'Provável', 'Muito provável'],
  'fr-FR': ['Très improbable', 'Improbable', 'Incertain', 'Probable', 'Très probable'],
  'de-DE': ['Sehr unwahrscheinlich', 'Unwahrscheinlich', 'Unklar', 'Wahrscheinlich', 'Sehr wahrscheinlich'],
  'zh-CN': ['非常不可能', '不太可能', '不确定', '可能', '非常可能'],
  'ja-JP': ['非常に低い', '低い', 'どちらともいえない', '高い', '非常に高い'],
  'ko-KR': ['매우 낮음', '낮음', '확실하지 않음', '높음', '매우 높음'],
  'ar-SA': ['غير مرجح جداً', 'غير مرجح', 'غير متأكد', 'مرجح', 'مرجح جداً'],
  'hi-IN': ['बहुत कम संभावना', 'कम संभावना', 'निश्चित नहीं', 'संभावित', 'बहुत संभावित'],
});
const distributionUnavailableByLocale = Object.freeze({
  'en-US': 'Distribution is unavailable until the sample capture is published.',
  'es-ES': 'La distribución no está disponible hasta publicar la captura de la muestra.',
  'pt-BR': 'A distribuição ficará disponível quando a captura da amostra for publicada.',
  'fr-FR': 'La distribution sera disponible après la publication de la capture.',
  'de-DE': 'Die Verteilung ist verfügbar, sobald die Erfassung veröffentlicht wurde.',
  'zh-CN': '示例采集结果发布后才能查看分布。',
  'ja-JP': 'サンプルの取得結果が公開されるまで分布は利用できません。',
  'ko-KR': '샘플 캡처가 게시될 때까지 분포를 사용할 수 없습니다.',
  'ar-SA': 'لا يتوفر التوزيع حتى نشر التقاط العينة.',
  'hi-IN': 'नमूना कैप्चर प्रकाशित होने तक वितरण उपलब्ध नहीं है।',
});

const cleanText = (value, maximum = 2_000) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};
const safeNumber = (value) => Number.isFinite(value) ? value : null;
const escapeHtml = (value) => cleanText(String(value ?? ''), 8_000)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const absolute = (path) => `${siteOrigin}${path}`;
const localePath = (locale) => `/${locale.toLowerCase()}/studies/`;
const studyPath = (locale, slug) => `${localePath(locale)}${slug}/`;
const landingPath = (locale) => `/${locale.toLowerCase()}/`;
const staticLibraryPath = (locale) => localeUi[locale] ? localePath(locale) : '/studies/';
const openGraphLocale = (locale) => cleanText(locale || 'en-US', 16).replace('-', '_');
const socialCardBaseName = (locale, study = null) => `${study ? `study-${study.slug}` : `likerts-${locale.toLowerCase()}`}-${socialCardVersion}`;
const socialCardPath = (locale, study = null) => `/${socialCardDirectory}/${socialCardBaseName(locale, study)}.png`;
const socialCardSourcePath = (locale, study = null) => `/${socialCardDirectory}/${socialCardBaseName(locale, study)}.svg`;
const socialCardAlt = ({ locale = 'en-US', title = 'Likerts' } = {}) => {
  const brand = brandLineByLocale[locale] || brandLineByLocale['en-US'];
  const caveat = modelCaveatByLocale[locale] || modelCaveatByLocale['en-US'];
  return `${title} — ${brand}. ${caveat}.`;
};
function appEntryUrl(locale, sampleSlug = null) {
  const params = new URLSearchParams();
  if (sampleSlug) params.set('sample', sampleSlug);
  if (cjkStaticLocales.has(locale)) params.set('uiLocale', locale);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}
function englishDocumentLink(href, label, locale, className = '') {
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
  if (locale === 'en-US') return `<a${classAttribute} href="${href}">${escapeHtml(label)}</a>`;
  const destination = 'English (US)';
  const copy = cjkEnglishDocumentCopy[locale];
  const accessible = copy ? `${label} (${copy.accessible}; ${destination})` : `${label} (${destination})`;
  return `<a${classAttribute} href="${href}" hreflang="en-US" aria-label="${escapeHtml(accessible)}">${escapeHtml(label)} <span lang="en-US">${destination}</span></a>`;
}
const jsonScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const cjkSourceLanguageNames = Object.freeze({
  'zh-CN': { en: '英语', zh: '中文', ja: '日语', ko: '韩语', es: '西班牙语', pt: '葡萄牙语', fr: '法语', de: '德语', ar: '阿拉伯语', hi: '印地语' },
  'ja-JP': { en: '英語', zh: '中国語', ja: '日本語', ko: '韓国語', es: 'スペイン語', pt: 'ポルトガル語', fr: 'フランス語', de: 'ドイツ語', ar: 'アラビア語', hi: 'ヒンディー語' },
  'ko-KR': { en: '영어', zh: '중국어', ja: '일본어', ko: '한국어', es: '스페인어', pt: '포르투갈어', fr: '프랑스어', de: '독일어', ar: '아랍어', hi: '힌디어' },
});
const safeSourceLanguageTag = (value) => ['en', 'zh', 'ja', 'ko', 'es', 'pt', 'fr', 'de', 'ar', 'hi'].includes(value) ? value : null;
function sourceLanguageTagForText(value) {
  const text = cleanText(value);
  if (/[ぁ-ゟ゠-ヿ]/u.test(text)) return 'ja';
  if (/[가-힣]/u.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar';
  if (/[\u0900-\u097f]/u.test(text)) return 'hi';
  if (/[\u3400-\u9fff]/u.test(text)) return 'zh';
  return /[A-Za-z]/.test(text) ? 'en' : null;
}
function explicitSourceLanguageTag(source) {
  const explicit = cleanText(source?.originalLanguage, 32).toLowerCase();
  const aliases = { english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', spanish: 'es', portuguese: 'pt', french: 'fr', german: 'de', arabic: 'ar', hindi: 'hi' };
  if (safeSourceLanguageTag(explicit)) return explicit;
  return aliases[explicit] || null;
}
function localizedSourceLanguageName(language, locale) {
  return cjkSourceLanguageNames[locale]?.[language] || language;
}
function jsonSafetyFor(locale) {
  return cjkJsonSafetyCopy[locale] || null;
}
const safeDistribution = (value, label = 'distribution') => {
  if (!Array.isArray(value) || value.length !== 5 || value.some((item) => !Number.isInteger(item) || item < 0 || item > 100) || value.reduce((sum, item) => sum + item, 0) !== 100) throw new TypeError(`${label} must contain five whole percentages totaling 100.`);
  return [...value];
};
const select = (value, fields) => Object.fromEntries(fields.flatMap((field) => value?.[field] === undefined ? [] : [[field, value[field]]]));
const cleanModelLineage = (lineage) => Array.isArray(lineage) ? lineage.map((item) => ({
  ...select(item, ['stage', 'role', 'cellId', 'cellIndex', 'status', 'requestedModel', 'fallbackModels', 'modelRoute', 'resolvedModel', 'promptVersion', 'schemaVersion', 'promptHash']),
  fallbackModels: Array.isArray(item?.fallbackModels) ? item.fallbackModels.filter((model) => typeof model === 'string').slice(0, 4) : undefined,
})).filter((item) => typeof item.stage === 'string' && (typeof item.requestedModel === 'string' || typeof item.resolvedModel === 'string')) : [];
const cleanLedger = (ledger) => Array.isArray(ledger) ? ledger.map((entry) => {
  const title = cleanText(entry?.title, 180) || 'Untitled source';
  const excerpt = cleanText(entry?.excerpt);
  const explicitLanguage = explicitSourceLanguageTag(entry);
  const titleLanguage = explicitLanguage || sourceLanguageTagForText(title);
  const excerptLanguage = explicitLanguage || sourceLanguageTagForText(excerpt);
  return {
    title,
    url: /^https:\/\//.test(entry?.url || '') ? entry.url : null,
    excerpt,
    acquisition: cleanText(entry?.acquisition, 64) || null,
    originalLanguage: cleanText(entry?.originalLanguage, 32) || null,
    sourceLanguage: explicitLanguage || excerptLanguage || titleLanguage,
    titleLanguage,
    excerptLanguage,
    contentHash: /^[a-f0-9]{64}$/i.test(entry?.contentHash || '') ? entry.contentHash : null,
  };
}).filter((entry) => entry.excerpt).slice(0, 4) : [];

function localizationReceiptForBrief(brief) {
  const localization = brief?.localization || brief?.request?.localization;
  if (!localization) throw new TypeError('Sample studies require a canonical localization request.');
  const receipt = normalizeLocalizationRequest({
    localization,
    market: brief.request?.market,
    outputLocale: brief.request?.outputLocale,
    sourceLanguages: brief.request?.sourceLanguages,
    searchCountry: brief.request?.searchCountry,
    searchLocation: brief.request?.searchLocation,
  });
  if (receipt.registryVersion !== LOCALIZATION_REGISTRY_VERSION) {
    throw new TypeError('Sample-study localization must resolve against the current registry version.');
  }
  return receipt;
}

function sameLocalizationReceipt(left, right) {
  if (!left || typeof left !== 'object') return false;
  const receipt = left.market && left.report && left.source && left.retrieval && left.instrument
    ? left
    : (() => {
      try { return normalizeLocalizationRequest({ localization: left }); } catch { return null; }
    })();
  return receipt?.schemaVersion === right.schemaVersion
    && receipt.registryVersion === right.registryVersion
    && receipt.market?.id === right.market.id
    && receipt.market?.countryCode === right.market.countryCode
    && receipt.report?.locale === right.report.locale
    && JSON.stringify(receipt.source?.locales) === JSON.stringify(right.source.locales)
    && receipt.retrieval?.policy === right.retrieval.policy
    && JSON.stringify(receipt.retrieval?.locales) === JSON.stringify(right.retrieval.locales)
    && receipt.instrument?.locale === right.instrument.locale;
}

function nativeReviewForBrief(brief) {
  const review = canonicalSampleLineageForSample(brief).nativeReview;
  return {
    status: review.status,
    reviewer: null,
    reviewedAt: null,
    glossaryVersion: null,
    copyStatus: review.copyStatus,
    authority: review.authority,
    releaseEligible: review.releaseEligible,
  };
}

function qualityForBrief(brief, capture) {
  return {
    automatedQa: {
      // Sanitization and static-artifact generation are the machine QA gate;
      // copy or native-review release metadata never turns this into a pass.
      status: capture ? 'passed' : 'pending',
      scope: SAMPLE_AUTOMATED_QA_SCOPE,
      checkedAt: capture?.capturedAt || null,
    },
    nativeReview: nativeReviewForBrief(brief),
  };
}

function sanitizeStudy(study, locale = 'en-US') {
  if (!isPlainObject(study)) throw new TypeError('Captured result must include a study object.');
  const safety = jsonSafetyFor(locale);
  const segmentBoundary = safety?.segmentBoundary || 'This is a model-constructed analytical segment, not an observed participant group.';
  const perspectiveDisclosure = safety?.modelPerspectiveDisclosure || modelPerspectiveDisclosure;
  const segments = Array.isArray(study.segments) ? study.segments.map((segment, index) => ({ id: cleanText(segment?.id, 100) || `segment-${index + 1}`, kind: 'MODEL_CONSTRUCTED', label: cleanText(segment?.label, 48), values: safeDistribution(segment?.values, 'segment distribution'), boundary: segmentBoundary, boundaryCode: 'MODEL_CONSTRUCTED_ANALYTICAL_SEGMENT' })).filter((segment) => segment.label) : [];
  const responses = Array.isArray(study.responses) ? study.responses.map((response) => ({ score: Number.isInteger(response?.score) && response.score >= 1 && response.score <= 5 ? response.score : null, profile: cleanText(response?.profile, 90), quote: cleanText(response?.quote, 260), disclosure: perspectiveDisclosure, disclosureCode: 'MODEL_GENERATED_PERSPECTIVE_NOT_PARTICIPANT_QUOTATION' })).filter((response) => response.score && response.profile && response.quote) : [];
  return {
    title: cleanText(study.title, 72),
    summary: cleanText(study.summary, 240),
    takeaway: cleanText(study.takeaway, 360),
    distribution: safeDistribution(study.distribution),
    confidence: ['Low', 'Moderate'].includes(study.confidence) ? study.confidence : 'Low',
    confidenceNote: cleanText(study.confidenceNote, 180),
    audienceSummary: {
      audienceLabel: cleanText(study.audienceSummary?.audienceLabel, 80),
      contextLabel: cleanText(study.audienceSummary?.contextLabel, 100),
      attributes: Array.isArray(study.audienceSummary?.attributes) ? study.audienceSummary.attributes.map((attribute) => ({ label: cleanText(attribute?.label, 32), value: cleanText(attribute?.value, 72) })).filter((attribute) => attribute.label && attribute.value).slice(0, 3) : [],
    },
    segments,
    responses,
    cautions: Array.isArray(study.cautions) ? study.cautions.map((item) => cleanText(item, 140)).filter(Boolean).slice(0, 4) : [],
  };
}

export function sanitizeCapturedStudy(brief, result) {
  if (!brief?.slug) throw new TypeError('A registered sample-study brief is required.');
  const localization = localizationReceiptForBrief(brief);
  const meta = result?.meta || {};
  const run = result?.run || {};
  const suppliedLocalization = meta.localization || run.localization;
  if (suppliedLocalization && !sameLocalizationReceipt(suppliedLocalization, localization)) {
    throw new TypeError('Captured study localization does not match the registered sample brief.');
  }
  const provenanceInput = meta.provenance || meta.reproducibility || run.reproducibility || {};
  const economics = meta.economics || run.economics || {};
  const modelLineage = cleanModelLineage(meta.modelLineage || run.modelLineage);
  if (!modelLineage.length) throw new TypeError('Captured studies require model lineage.');
  const inputHash = provenanceInput.inputHash || run.inputHash;
  const evidenceHash = provenanceInput.evidenceHash || run.evidence?.evidenceHash;
  if (!/^[a-f0-9]{64}$/i.test(inputHash || '') || !/^[a-f0-9]{64}$/i.test(evidenceHash || '')) throw new TypeError('Captured studies require SHA-256 input and evidence hashes.');
  const inputHashLineage = resolveInputHashLineage({
    hash: inputHash,
    version: provenanceInput.inputHashVersion || provenanceInput.inputHashLineage?.version || null,
  });
  const generatedAt = meta.generatedAt || run.completedAt || run.createdAt;
  if (Number.isNaN(Date.parse(generatedAt || ''))) throw new TypeError('Captured studies require an ISO generated timestamp.');
  const evidenceMode = cleanText(meta.evidenceMode || run.evidence?.mode, 32) || 'PRIOR_ONLY';
  const parsedPopulationFrame = populationFrameSchema.safeParse(result?.populationFrame || run.populationFrame || meta.populationFrame);
  const populationFrame = parsedPopulationFrame.success ? parsedPopulationFrame.data : buildPopulationFrame(brief.request);
  const sourceModelCard = result?.modelCard || run.modelCard || meta.modelCard || {};
  const safety = jsonSafetyFor(brief.locale);
  const sanitizedStudy = sanitizeStudy(result?.study, brief.locale);
  const rawResearchDesign = result?.researchDesign || run.researchDesign || meta.researchDesign || buildResearchDesign({ researchMethod: 'GENERAL_LIKERT' }, sanitizedStudy);
  const researchDesign = safety
    ? { ...rawResearchDesign, cautions: [safety.methodCaution], disclosure: safety.methodDisclosure, disclosureCode: 'METHOD_OUTPUT_MODEL_GENERATED_DIRECTION' }
    : rawResearchDesign;
  const ledger = cleanLedger(run.evidence?.ledger);
  const ensemble = meta.ensemble || run.cohort || {};
  const stability = meta.stability || run.stability || {};
  const completedCells = Number.isInteger(ensemble.completedCells) ? ensemble.completedCells : stability.cellCount;
  const gatewaySearchCompleted = Array.isArray(run.evidence?.external?.events) && run.evidence.external.events.some((event) => event?.provider === 'vercel-ai-gateway' && event?.operation === 'exa-search' && event?.outcome === 'completed');
  if (!gatewaySearchCompleted || !ledger.length) throw new TypeError('Published sample studies require a completed Gateway Exa search and at least one public evidence-ledger source.');
  if (!Number.isInteger(completedCells) || completedCells < 2) throw new TypeError('Published DEEP sample studies require at least two completed cohort cells.');
  const capture = {
    schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION,
    briefSlug: brief.slug,
    stableId: brief.stableId,
    sampleLineage: canonicalSampleLineageForSample(brief),
    studyId: cleanText(meta.studyId || run.studyId, 128) || null,
    runId: cleanText(meta.runId || run.runId, 128) || null,
    capturedAt: new Date(generatedAt).toISOString(),
    localization,
    quality: {
      automatedQa: { status: 'passed', scope: SAMPLE_AUTOMATED_QA_SCOPE, checkedAt: new Date(generatedAt).toISOString() },
      nativeReview: nativeReviewForBrief(brief),
    },
    study: sanitizedStudy,
    populationFrame,
    researchDesign,
    modelCard: {
      cardVersion: cleanText(sourceModelCard.cardVersion, 80) || 'likerts-model-card-v1',
      purpose: cleanText(sourceModelCard.purpose, 360) || 'Directional synthetic research for hypothesis generation and research planning.',
      permittedUse: cleanText(sourceModelCard.permittedUse, 360) || 'Explore model-generated hypotheses before validation with real people.',
      populationGrounding: cleanText(sourceModelCard.populationGrounding, 40) || 'NONE',
      populationFrameHash: /^[a-f0-9]{64}$/i.test(sourceModelCard.populationFrameHash || '') ? sourceModelCard.populationFrameHash : null,
      researchMethod: cleanText(sourceModelCard.researchMethod, 40) || researchDesign.methodId,
      researchMethodVersion: cleanText(sourceModelCard.researchMethodVersion, 80) || researchDesign.methodVersion,
      researchMethodChart: cleanText(sourceModelCard.researchMethodChart, 80) || researchDesign.chartId,
      attitudinalValidation: 'NOT_VALIDATED',
      disclosure: safety?.modelCardDisclosure || ATTITUDINAL_ACCURACY_DISCLAIMER,
      disclosureCode: 'SYNTHETIC_RESULTS_REQUIRE_HUMAN_VALIDATION',
    },
    provenance: {
      runtimeVersion: cleanText(meta.runtimeVersion || provenanceInput.runtimeVersion, 100) || null,
      researchMode: cleanText(meta.researchMode || run.researchMode || provenanceInput.researchMode, 16) || null,
      localizationRegistryVersion: localization.registryVersion,
      inputHash,
      inputHashVersion: inputHashLineage.version,
      inputHashLineage,
      evidenceHash,
      promptVersions: isPlainObject(provenanceInput.promptVersions) ? Object.fromEntries(Object.entries(provenanceInput.promptVersions).filter(([key, value]) => !secretKey.test(key) && typeof value === 'string').map(([key, value]) => [key, cleanText(value, 80)])) : {},
      schemaVersions: isPlainObject(provenanceInput.schemaVersions) ? Object.fromEntries(Object.entries(provenanceInput.schemaVersions).filter(([key, value]) => !secretKey.test(key) && typeof value === 'string').map(([key, value]) => [key, cleanText(value, 80)])) : {},
      disclaimer: safety?.provenanceDisclaimer || cleanText(provenanceInput.disclaimer, 360) || 'Model generation is non-deterministic; this record supports audit and comparison, not exact replay or certainty.',
      disclaimerCode: 'MODEL_GENERATION_NON_DETERMINISTIC',
    },
    cost: {
      currency: cleanText(economics.currency, 8) || 'USD',
      gatewayCost: { ...select(economics.gatewayCost || {}, ['exactTotalUsd', 'reporting', 'reportedCallCount', 'eligibleCallCount', 'note']) },
      tokenUsage: Object.fromEntries(Object.entries(economics.tokenUsage || {}).filter(([key, value]) => ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens'].includes(key) && safeNumber(value) !== null)),
    },
    modelLineage,
    evidence: { mode: evidenceMode, gatewaySearchCompleted, ledger },
    ensemble: { plannedCells: Number.isInteger(ensemble.plannedCells) ? ensemble.plannedCells : null, completedCells, failedCells: Number.isInteger(ensemble.failedCells) ? ensemble.failedCells : null, aggregation: cleanText(ensemble.aggregation, 80) || null, distribution: Array.isArray(ensemble.distribution) ? safeDistribution(ensemble.distribution, 'ensemble distribution') : null },
    stability: { metricVersion: cleanText(stability.metricVersion, 40) || null, cellCount: Number.isInteger(stability.cellCount) ? stability.cellCount : completedCells, meanJensenShannonDivergence: safeNumber(stability.meanJensenShannonDivergence), maxPercentagePointSpread: safeNumber(stability.maxPercentagePointSpread), interpretation: safety?.stabilityInterpretation || cleanText(stability.interpretation, 240) || null, interpretationCode: safety ? 'MODEL_CELL_AGREEMENT_NOT_HUMAN_CERTAINTY' : undefined },
    verification: { ...select(meta.verification || run.verification || {}, ['status', 'role', 'separateModelCall', 'independentReview', 'decision', 'evidenceAlignment']), weakClaims: Array.isArray((meta.verification || run.verification || {}).weakClaims) ? (meta.verification || run.verification || {}).weakClaims.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 4) : [], biasSignals: Array.isArray((meta.verification || run.verification || {}).biasSignals) ? (meta.verification || run.verification || {}).biasSignals.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 4) : [], critiqueSummary: cleanText((meta.verification || run.verification || {}).critiqueSummary, 360) || null, note: safety?.verificationNote || cleanText((meta.verification || run.verification || {}).note, 360) || null, noteCode: safety ? 'INTERNAL_PIPELINE_MODEL_STAGE_NOT_EXTERNAL_VERIFICATION' : undefined },
  };
  if (hasSecretShapedKey(capture)) throw new TypeError('Captured study contains a secret-shaped field.');
  return freeze(capture);
}

function normalizeCapturedStudy(brief, candidate) {
  if (!candidate?.study || !candidate?.provenance) return sanitizeCapturedStudy(brief, candidate);
  const gatewaySearchCompleted = candidate.evidence?.gatewaySearchCompleted === true;
  return sanitizeCapturedStudy(brief, {
    study: candidate.study,
    populationFrame: candidate.populationFrame,
    modelCard: candidate.modelCard,
      researchDesign: candidate.researchDesign,
      localization: candidate.localization,
      meta: {
      studyId: candidate.studyId,
      runId: candidate.runId,
      generatedAt: candidate.capturedAt,
      runtimeVersion: candidate.provenance.runtimeVersion,
      researchMode: candidate.provenance.researchMode,
      evidenceMode: candidate.evidence?.mode,
      modelLineage: candidate.modelLineage,
      economics: candidate.cost,
      ensemble: candidate.ensemble,
      stability: candidate.stability,
      provenance: candidate.provenance,
      verification: candidate.verification,
      localization: candidate.localization,
      localizationRegistryVersion: candidate.provenance?.localizationRegistryVersion,
    },
    run: {
      studyId: candidate.studyId,
      runId: candidate.runId,
      localization: candidate.localization,
      evidence: {
        mode: candidate.evidence?.mode,
        ledger: candidate.evidence?.ledger,
        external: {
          events: gatewaySearchCompleted
            ? [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'completed' }]
            : [],
        },
      },
    },
  });
}

function catalogEntry(brief, capture) {
  const localization = capture?.localization || localizationReceiptForBrief(brief);
  return {
    slug: brief.slug,
    stableId: brief.stableId,
    locale: brief.locale,
    localeName: sampleLocaleName(brief.locale),
    industry: brief.industry,
    industryName: industryNames[brief.industry] || brief.industry,
    title: brief.title,
    description: brief.description,
    researchIntent: brief.researchIntent,
    evidenceBoundary: brief.evidenceBoundary,
    question: brief.request.prompt,
    audience: brief.request.audience,
    disclosure: brief.disclosure,
    humanValidation: brief.humanValidation,
    canonicalUrl: absolute(studyPath(brief.locale, brief.slug)),
    detailUrl: studyPath(brief.locale, brief.slug),
    dataUrl: `${studyPath(brief.locale, brief.slug)}study.json`,
    runYourOwnUrl: appEntryUrl(brief.locale, brief.slug),
    localization,
    localizationRegistryVersion: localization.registryVersion,
    sampleLineage: canonicalSampleLineageForSample(brief),
    quality: qualityForBrief(brief, capture),
    rerun: { allowed: true, block: null },
    status: capture ? 'automated-qa-passed' : 'pending-editorial-capture',
    capturedAt: capture?.capturedAt || null,
    evidenceMode: capture?.evidence.mode || null,
    sourceCount: capture?.evidence.ledger.length || 0,
    modelCellCount: capture?.stability.cellCount || null,
    gatewayCostUsd: capture?.cost.gatewayCost.exactTotalUsd || null,
    distribution: capture?.study.distribution || null,
    confidence: capture?.study.confidence || null,
  };
}

function header(active = 'studies', locale = 'en-US', currentNavPath = null) {
  const text = uiFor(locale);
  const nav = [
    [appEntryUrl(locale), text.nav.open, 'app', false],
    [staticLibraryPath(locale), text.nav.studies, 'studies', false],
    ['/methodology/', text.nav.methodology, 'methodology', true],
    ['/research-standards/', text.nav.standards, 'standards', true],
    ['/limitations/', text.nav.limitations, 'limitations', true],
  ].map(([href, label, key, englishOnly]) => {
    if (englishOnly) return englishDocumentLink(href, label, locale);
    const current = active === key ? 'page' : active === `${key}-location` ? 'location' : null;
    return `<a href="${current === 'page' && currentNavPath ? currentNavPath : href}"${current ? ` aria-current="${current}"` : ''}>${escapeHtml(label)}</a>`;
  }).join('');
  return `<a class="skip-link" href="#content">${escapeHtml(text.nav.open)}</a><header class="site-header"><div class="header-inner"><a class="brand" href="${appEntryUrl(locale)}" aria-label="${escapeHtml(text.nav.home)}"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Likerts</a><nav class="site-nav" aria-label="${escapeHtml(text.nav.primary)}">${nav}</nav><a class="header-cta" href="${appEntryUrl(locale)}">${escapeHtml(text.nav.newStudy)}</a></div></header>`;
}

function footer(locale = 'en-US') {
  const ui = uiFor(locale);
  const text = ui.footer;
  const brandLine = brandLineByLocale[locale] || brandLineByLocale['en-US'];
  return `<footer class="site-footer"><div class="footer-inner"><span>${escapeHtml(brandLine)}</span><nav class="footer-nav" aria-label="${escapeHtml(text.aria)}"><a href="${staticLibraryPath(locale)}">${escapeHtml(text.studies)}</a>${englishDocumentLink('/how-it-works/', text.how, locale)}${englishDocumentLink('/methodology/', text.methodology, locale)}${englishDocumentLink('/research-standards/', ui.nav.standards, locale)}${englishDocumentLink('/limitations/', text.limitations, locale)}<a href="/llms.txt">${escapeHtml(text.llms)}</a></nav></div></footer>`;
}

function wrapSocialText(value, maximumCharacters) {
  const text = cleanText(value, 180);
  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text)) {
    const characters = Array.from(text);
    return Array.from({ length: Math.ceil(characters.length / maximumCharacters) }, (_, index) => characters.slice(index * maximumCharacters, (index + 1) * maximumCharacters).join(''));
  }
  const words = text.split(' ').filter(Boolean);
  if (words.length > 1) {
    const lines = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (Array.from(candidate).length > maximumCharacters && current) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    return lines;
  }
  const characters = Array.from(text);
  return Array.from({ length: Math.ceil(characters.length / maximumCharacters) }, (_, index) => characters.slice(index * maximumCharacters, (index + 1) * maximumCharacters).join(''));
}

function socialCardSvg({ locale, title, description, eyebrow = 'LIKERTS · SYNTHETIC RESEARCH', brandDataUri }) {
  // Keep all critical copy in the central 600px: square and center-crop social
  // previews retain x=300..900 of this 1200×630 source image.
  const cjkTitle = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(title);
  const titleLines = wrapSocialText(title, cjkTitle ? 12 : 20);
  const titleTruncated = titleLines.length > 3;
  const lines = (titleTruncated
    ? [...titleLines.slice(0, 2), `${titleLines[2]}…`]
    : titleLines).slice(0, 3) || ['Likerts'];
  const cjkDescription = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(description);
  const candidateDescriptionLines = wrapSocialText(description, cjkDescription ? 28 : 34);
  // Never show a sentence fragment: descriptions that cannot fit completely in
  // two lines are omitted rather than cut after a conjunction or preposition.
  const descriptionLines = candidateDescriptionLines.length <= 2 ? candidateDescriptionLines : [];
  const titleMarkup = lines.map((line, index) => `<text x="300" y="${236 + (index * 52)}" fill="#f8fbff" font-family="Inter, Arial, 'Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif" font-size="42" font-weight="700">${escapeHtml(line)}</text>`).join('');
  const descriptionMarkup = descriptionLines.map((line, index) => `<text x="300" y="${442 + (index * 27)}" fill="#c6d7eb" font-family="Inter, Arial, 'Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif" font-size="20">${escapeHtml(line)}</text>`).join('');
  const localeLabel = requireSampleLocale(locale).nativeLabel;
  if (!brandDataUri?.startsWith('data:image/png;base64,')) throw new TypeError('Social card brand strip must be an embedded PNG data URI.');
  const brandMarkup = `<image href="${brandDataUri}" x="300" y="516" width="340" height="29" preserveAspectRatio="xMinYMid meet"/>`;
  const caveat = modelCaveatByLocale[locale] || modelCaveatByLocale['en-US'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeHtml(socialCardAlt({ locale, title }))}">
  <rect width="1200" height="630" fill="#021a38"/>
  <path d="M0 530C250 424 430 612 668 474C880 351 988 442 1200 312V630H0Z" fill="#073b68"/>
  <circle cx="1054" cy="118" r="152" fill="#0d5c91" opacity=".48"/><circle cx="1110" cy="82" r="74" fill="#14b8a6" opacity=".55"/>
  <text x="300" y="104" fill="#7ee8df" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="1">${escapeHtml(eyebrow)}</text>
  <rect x="300" y="132" width="92" height="8" rx="4" fill="#14b8a6"/>
  ${titleMarkup}
${descriptionMarkup ? `  ${descriptionMarkup}\n` : ''}  ${brandMarkup}
  <text x="300" y="568" fill="#d3dfed" font-family="Inter, Arial, 'Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif" font-size="16">${escapeHtml(caveat)}</text>
  <text x="300" y="597" fill="#b7c8dc" font-family="Inter, Arial, 'Noto Sans CJK SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif" font-size="15">${escapeHtml(localeLabel)}</text>
</svg>\n`;
}

function faviconLinks() {
  return `<link rel="icon" href="/favicon.svg" type="image/svg+xml" /><link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="any" /><link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" /><link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16" /><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" /><link rel="manifest" href="/site.webmanifest" />`;
}

function pageShell({ path, title, description, body, lang = 'en', dir = 'ltr', jsonLd = [], active = 'studies', currentNavPath = null, extraHead = '', locale = 'en-US', alternates = [], socialCard = null }) {
  const pageTitle = `${title} | Likerts`;
  const canonical = absolute(path);
  const structured = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  const imagePath = socialCard || socialCardPath(locale);
  const alternateLinks = alternates.map(({ locale: alternateLocale, path: alternatePath }) => `<link rel="alternate" hreflang="${escapeHtml(alternateLocale)}" href="${absolute(alternatePath)}" />`).join('');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">
  <head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="theme-color" content="#021a38" />
    <meta name="description" content="${escapeHtml(description)}" /><meta name="robots" content="index,follow" />
    <meta name="google-adsense-account" content="ca-pub-2113803057950021" />
    ${faviconLinks()}
    <link rel="canonical" href="${canonical}" />${alternateLinks}
    <meta property="og:type" content="website" /><meta property="og:site_name" content="Likerts" /><meta property="og:locale" content="${escapeHtml(openGraphLocale(locale))}" /><meta property="og:title" content="${escapeHtml(pageTitle)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${canonical}" /><meta property="og:image" content="${absolute(imagePath)}" /><meta property="og:image:secure_url" content="${absolute(imagePath)}" /><meta property="og:image:type" content="image/png" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="${escapeHtml(socialCardAlt({ locale, title }))}" />
    <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(pageTitle)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${absolute(imagePath)}" /><meta name="twitter:image:alt" content="${escapeHtml(socialCardAlt({ locale, title }))}" />
    <link rel="stylesheet" href="/static-site.css" /><link rel="stylesheet" href="/study-library.css" />${extraHead}
    ${structured.map((item) => `<script type="application/ld+json">${jsonScript(item)}</script>`).join('')}
    <title>${escapeHtml(pageTitle)}</title>
  </head>
  <body class="study-library-page">
    ${header(active, locale, currentNavPath)}
    <main id="content">${body}</main>
    ${footer(locale)}
  </body>
</html>
`;
}

function distributionChart(distribution, { compact = false, locale = 'en-US' } = {}) {
  if (!distribution) return `<p class="section-note">${escapeHtml(distributionUnavailableByLocale[locale] || distributionUnavailableByLocale['en-US'])}</p>`;
  const labelsForLocale = scaleLabelsByLocale[locale] || scaleLabels;
  const segments = distribution.map((value, index) => `<span class="distribution-segment distribution-${scaleClasses[index]}" style="--segment:${value}%"><span class="visually-hidden">${escapeHtml(labelsForLocale[index])}: ${value}%</span></span>`).join('');
  const labels = distribution.map((value, index) => `<span><b>${escapeHtml(labelsForLocale[index])}</b><strong>${value}%</strong></span>`).join('');
  return `<div class="distribution-${compact ? 'compact' : 'figure'}"><div class="distribution-chart" role="img" aria-label="${distribution.map((value, index) => `${labelsForLocale[index]} ${value}%`).join(', ')}">${segments}</div>${compact ? '' : `<div class="distribution-labels" aria-hidden="true">${labels}</div>`}</div>`;
}

function libraryHero({ title, description, scoped = false, locale = 'en-US' }) {
  const text = uiFor(locale).hub;
  return `<section class="library-hero"><div class="study-library-shell"><p class="library-eyebrow">${escapeHtml(text.eyebrow)}</p>${scoped ? `<nav class="study-breadcrumbs" aria-label="${escapeHtml(uiFor(locale).detail.breadcrumb)}"><a href="${staticLibraryPath(locale)}">${escapeHtml(text.breadcrumb)}</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(text.hub)}</span></nav>` : ''}<h1>${escapeHtml(title)}</h1><p class="library-lede">${escapeHtml(description)}</p><div class="library-boundary" role="note"><span class="library-boundary-icon" aria-hidden="true">i</span><p><strong>${escapeHtml(text.boundaryLabel)}</strong> ${escapeHtml(text.boundary)}</p></div><div class="library-actions"><a class="sl-button sl-button-primary" href="${appEntryUrl(locale)}">${escapeHtml(text.run)}</a>${englishDocumentLink('/methodology/', text.review, locale, 'sl-text-action')}</div></div></section>`;
}

function qualityBadges(entry, locale = entry.renderLocale || entry.locale || 'en-US') {
  const automatedQa = entry.quality?.automatedQa || { status: 'pending' };
  const nativeReview = entry.quality?.nativeReview || { status: 'review-pending' };
  const copy = staticSampleCopyFor(locale);
  const automatedQaStatus = String(automatedQa.status);
  const nativeReviewStatus = String(nativeReview.status);
  const nativeReviewAuthority = String(nativeReview.authority || 'registry-declared');
  const nativeReviewReleaseEligible = nativeReview.releaseEligible === true ? 'true' : 'false';
  const scope = cjkQaScopeCopy[locale];
  const automatedQaScope = automatedQa.scope === SAMPLE_AUTOMATED_QA_SCOPE ? automatedQa.scope : null;
  const scopeBadge = scope && automatedQaScope
    ? `<span class="study-quality-badge study-quality-badge-scope" data-automated-qa-scope="${escapeHtml(automatedQaScope)}">${escapeHtml(scope.label)}: <code>${escapeHtml(automatedQaScope)}</code> — ${escapeHtml(scope.boundary)}</span>`
    : '';
  return `<span class="study-quality-badges" data-automated-qa-status="${escapeHtml(automatedQaStatus)}" data-native-review-status="${escapeHtml(nativeReviewStatus)}" data-native-review-authority="${escapeHtml(nativeReviewAuthority)}" data-native-review-release-eligible="${nativeReviewReleaseEligible}">${scopeBadge}<span class="study-quality-badge study-quality-badge-automated">${escapeHtml(copy.automatedQa)}: ${escapeHtml(resolveStaticSampleQualityStatus(locale, automatedQaStatus))}</span><span class="study-quality-badge study-quality-badge-native">${escapeHtml(copy.nativeReview)}: ${escapeHtml(resolveStaticSampleQualityStatus(locale, nativeReviewStatus))}</span></span>`;
}

function studyRow(entry) {
  const renderLocale = entry.renderLocale || 'en-US';
  const text = uiFor(renderLocale).table;
  const localeName = localizedLocaleName(entry.locale, renderLocale);
  const industryName = localizedIndustryName(entry.industry, renderLocale);
  const published = entry.quality?.automatedQa?.status === 'passed';
  const provenance = published
    ? `${entry.evidenceMode}; ${entry.sourceCount} ${entry.sourceCount === 1 ? text.source : text.sources}; ${entry.modelCellCount || '?'} ${text.modelCells}`
    : text.pending;
  return `<tr class="study-table-row" data-study-row data-locale="${escapeHtml(entry.locale)}" data-industry="${escapeHtml(entry.industry)}" data-status="${escapeHtml(entry.status)}" data-search="${escapeHtml(`${entry.title} ${entry.description} ${entry.question} ${entry.audience} ${industryName} ${localeName}`.toLowerCase())}">
    <td class="study-cell-primary" data-label="${escapeHtml(text.study)}"><a class="study-title-link" data-study-link href="${entry.detailUrl}"><span class="study-title">${escapeHtml(entry.title)}</span><span class="study-question">${escapeHtml(entry.question)}</span></a></td>
    <td data-label="${escapeHtml(text.locale)}">${escapeHtml(localeName)}</td>
    <td data-label="${escapeHtml(text.industry)}">${escapeHtml(industryName)}</td>
    <td data-label="${escapeHtml(text.status)}">${qualityBadges(entry, renderLocale)}</td>
    <td class="study-cell-direction" data-label="${escapeHtml(text.direction)}">${distributionChart(entry.distribution, { compact: true, locale: renderLocale })}</td>
    <td data-label="${escapeHtml(text.provenance)}" class="study-provenance">${escapeHtml(provenance)}</td>
    <td data-label="${escapeHtml(text.cost)}">${entry.gatewayCostUsd ? `$${escapeHtml(entry.gatewayCostUsd)}` : escapeHtml(text.noCost)}</td>
    <td data-label="${escapeHtml(text.data)}"><a class="detail-link" href="${entry.dataUrl}">${escapeHtml(text.json)}</a></td>
    <td data-label="${escapeHtml(text.action)}" class="study-cell-action"><a class="study-row-arrow" href="${entry.detailUrl}" aria-label="${escapeHtml(`${text.action}: ${entry.title}`)}">→</a></td>
  </tr>`;
}

function filters(entries) {
  const locales = [...new Set(entries.map((entry) => entry.locale))].sort();
  const industries = [...new Set(entries.map((entry) => entry.industry))].sort();
  return `<form class="study-filters" data-study-filters>
    <div class="study-filter-field"><label for="locale-filter">Language</label><select id="locale-filter" name="locale" data-study-filter="locale"><option value="">All languages</option>${locales.map((locale) => `<option value="${escapeHtml(locale)}">${escapeHtml(sampleLocaleName(locale))}</option>`).join('')}</select></div>
    <div class="study-filter-field"><label for="industry-filter">Industry</label><select id="industry-filter" name="industry" data-study-filter="industry"><option value="">All industries</option>${industries.map((industry) => `<option value="${escapeHtml(industry)}">${escapeHtml(industryNames[industry] || industry)}</option>`).join('')}</select></div>
    <div class="study-filter-field"><label for="status-filter">Status</label><select id="status-filter" name="status" data-study-filter="status"><option value="">Any status</option><option value="automated-qa-passed">Automated QA passed</option><option value="pending-editorial-capture">Pending capture</option></select></div>
    <div class="study-filter-field"><label for="source-filter">Evidence</label><select id="source-filter" name="evidence"><option value="">All evidence modes</option><option value="EXA_GATEWAY">EXA Gateway</option></select></div>
    <div class="study-filter-field study-filter-search"><label for="study-search">Search</label><input id="study-search" type="search" name="q" autocomplete="off" data-study-filter="search" placeholder="Question, market, industry" /></div>
  </form>`;
}

function hubLinks(entries) {
  const byIndustry = [...new Map(entries.map((entry) => [entry.industry, entry])).values()].sort((a, b) => a.industryName.localeCompare(b.industryName));
  const byLocale = [...new Map(entries.map((entry) => [entry.locale, entry])).values()].sort((a, b) => a.localeName.localeCompare(b.localeName));
  return `<section class="study-hub-grid" aria-label="Study hubs"><div><h2>Browse by industry</h2>${byIndustry.map((entry) => `<div class="hub-link-row"><strong>${escapeHtml(entry.industryName)}</strong><span>${entries.filter((item) => item.industry === entry.industry).length} study</span></div>`).join('')}<p class="section-note">Industry pages stay unpublished until an industry has enough original studies and guidance to avoid thin content.</p></div><div><h2>Studies by language</h2><div class="language-link-grid">${byLocale.map((entry) => `<a href="${localePath(entry.locale)}">${escapeHtml(entry.localeName)}</a>`).join('')}</div><a class="hub-link" href="/llms.txt">LLM discovery file</a></div></section>`;
}

function filterScript() {
  return `<script>
(() => {
  const form = document.querySelector('[data-study-filters]');
  if (!form) return;
  const rows = [...document.querySelectorAll('[data-study-row]')];
  const apply = () => {
    const locale = form.querySelector('[data-study-filter="locale"]').value;
    const industry = form.querySelector('[data-study-filter="industry"]').value;
    const status = form.querySelector('[data-study-filter="status"]').value;
    const query = form.querySelector('[data-study-filter="search"]').value.trim().toLowerCase();
    for (const row of rows) row.hidden = !((!locale || row.dataset.locale === locale) && (!industry || row.dataset.industry === industry) && (!status || row.dataset.status === status) && (!query || row.dataset.search.includes(query)));
  };
  form.addEventListener('input', apply);
  form.addEventListener('submit', (event) => event.preventDefault());
})();
</script>`;
}

function renderStudyTable(entries, locale = 'en-US') {
  const text = uiFor(locale).table;
  const rows = entries.map((entry) => studyRow({ ...entry, renderLocale: locale }));
  return `<div class="study-table-wrap"><table class="study-table" aria-label="${escapeHtml(text.aria)}">
    <thead><tr class="study-table-header"><th scope="col">${escapeHtml(text.study)}</th><th scope="col">${escapeHtml(text.locale)}</th><th scope="col">${escapeHtml(text.industry)}</th><th scope="col">${escapeHtml(text.status)}</th><th scope="col">${escapeHtml(text.direction)}</th><th scope="col">${escapeHtml(text.provenance)}</th><th scope="col">${escapeHtml(text.cost)}</th><th scope="col">${escapeHtml(text.data)}</th><th scope="col"><span class="visually-hidden">${escapeHtml(text.action)}</span></th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

function renderMethodStrip(locale = 'en-US') {
  const text = uiFor(locale).method;
  return `<section class="study-method-strip" aria-labelledby="method-strip"><h2 id="method-strip">${escapeHtml(text.title)}</h2><div class="method-steps">
    ${text.steps.map(([title, description], index) => `<article class="method-step"><span class="method-step-icon" aria-hidden="true">${index + 1}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></article>`).join('')}
  </div></section>`;
}

function renderIndexPage(catalog) {
  const text = uiFor('en-US');
  const entries = catalog.studies;
  const captured = entries.filter((entry) => entry.quality?.automatedQa?.status === 'passed');
  const featured = captured[0] || entries[0];
  const body = `${libraryHero({ title: text.hub.title, description: text.hub.description, locale: 'en-US' })}
  <section class="study-library-shell" aria-labelledby="library-table">
    ${filters(entries)}
    <article class="featured-study">
      <div class="featured-study-body"><p class="study-kicker">Featured sample</p><h2>${escapeHtml(featured.title)}</h2><p class="study-summary">${escapeHtml(featured.description)}</p><p class="study-summary"><strong>Question:</strong> ${escapeHtml(featured.question)}</p><dl class="study-meta"><div><dt>${escapeHtml(text.detail.meta.language)}</dt><dd>${escapeHtml(featured.localeName)}</dd></div><div><dt>${escapeHtml(text.detail.meta.industry)}</dt><dd>${escapeHtml(featured.industryName)}</dd></div><div><dt class="visually-hidden">${escapeHtml(text.table.status)}</dt><dd>${qualityBadges(featured, 'en-US')}</dd></div></dl></div>
      <div class="featured-study-distribution"><p class="distribution-heading">${escapeHtml(text.detail.distribution)}</p>${distributionChart(featured.distribution, { locale: 'en-US' })}</div>
      <div class="featured-study-footer"><span>${escapeHtml(featured.disclosure)}</span><a class="sl-button sl-button-primary" href="${featured.runYourOwnUrl}">${escapeHtml(text.detail.run)}</a><a class="study-row-link" href="${featured.detailUrl}">${escapeHtml(text.table.action)}</a></div>
    </article>
    <h2 id="library-table" class="visually-hidden">Study catalog</h2>
    ${renderStudyTable(entries, 'en-US')}
    ${hubLinks(entries)}
    ${renderMethodStrip('en-US')}
  </section>${filterScript()}`;
  return pageShell({
    path: '/studies/',
    title: 'Synthetic Market Research Examples',
    description: 'Browse free, frozen synthetic market research examples with disclosed sources, model disagreement, cost, uncertainty, and human-validation next steps.',
    body,
    currentNavPath: '/studies/',
    extraHead: '<link rel="alternate" type="application/json" href="/studies/index.json" />',
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Synthetic Market Research Examples',
      url: absolute('/studies/'),
      description: 'Free, frozen synthetic market research examples from Likerts with disclosed sources, uncertainty, and human-validation guidance.',
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'Likerts', url: `${siteOrigin}/` },
      hasPart: entries.map((entry) => ({ '@type': 'Article', name: entry.title, url: entry.canonicalUrl, inLanguage: entry.locale })),
    }],
  });
}

function acquisitionAlternates() {
  return [
    ...acquisitionLocales.map((locale) => ({ locale, path: landingPath(locale) })),
    { locale: 'x-default', path: landingPath('en-US') },
  ];
}

function renderLocalizedLanding(locale) {
  const copy = localizedLandingCopy[locale];
  const metadata = requireSampleLocale(locale);
  if (!copy) throw new TypeError(`Missing acquisition landing copy for ${locale}.`);
  const body = `<section class="hero"><div class="hero-inner"><p class="eyebrow">${escapeHtml(copy.eyebrow)}</p><h1>${escapeHtml(copy.title)}</h1><p class="hero-copy">${escapeHtml(copy.description)}</p><div class="boundary" role="note"><strong>Research boundary:</strong> ${escapeHtml(copy.disclosure)}</div><div class="hero-actions"><a class="button" href="${appEntryUrl(locale)}">${escapeHtml(copy.primary)}</a><a class="button secondary" href="${localePath(locale)}">${escapeHtml(copy.examples)}</a></div></div></section>
  <div class="content"><section class="section" aria-labelledby="landing-method"><h2 id="landing-method">${escapeHtml(copy.methodTitle)}</h2><ol class="steps">${copy.method.map((item, index) => `<li class="step"><div class="step-index">0${index + 1}</div><div><p>${escapeHtml(item)}</p></div></li>`).join('')}</ol></section></div>`;
  return pageShell({
    path: landingPath(locale),
    title: copy.title,
    description: copy.description,
    body,
    lang: metadata.htmlLang,
    dir: metadata.dir,
    locale,
    active: null,
    alternates: acquisitionAlternates(),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: copy.title,
      url: absolute(landingPath(locale)),
      description: copy.description,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Likerts', url: `${siteOrigin}/` },
    },
  });
}

function renderScopedHub(catalog, { value }) {
  const localeMetadata = requireSampleLocale(value);
  const locale = localeUi[value] ? value : 'en-US';
  const text = uiFor(locale);
  const entries = catalog.studies.filter((entry) => entry.locale === value);
  const label = localizedLocaleName(value, locale);
  const path = localePath(value);
  const title = locale === 'en-US' ? `${label} sample synthetic studies` : text.hub.title;
  const description = locale === 'en-US' ? `Frozen Likerts sample studies written for ${label}, with disclosed synthetic boundaries and evidence ledgers.` : text.hub.description;
  return pageShell({
    path,
    title,
    description,
    lang: localeMetadata.htmlLang,
    dir: localeMetadata.dir,
    body: `${libraryHero({ title, description, scoped: true, locale })}<section class="study-library-shell">${renderStudyTable(entries, locale)}${renderMethodStrip(locale)}</section>`,
    locale,
    currentNavPath: path,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      url: absolute(path),
      description,
      inLanguage: value,
      isPartOf: { '@type': 'WebSite', name: 'Likerts', url: `${siteOrigin}/` },
      hasPart: entries.map((entry) => ({ '@type': 'Article', name: entry.title, url: entry.canonicalUrl, inLanguage: entry.locale })),
    }],
  });
}

function validationItems(brief) {
  const text = uiFor(brief.locale).detail;
  return [
    [text.validationItems[0], brief.humanValidation],
    [text.validationItems[1], text.validationNotes[1]],
    [text.validationItems[2], text.validationNotes[2]],
  ];
}

function captureHasReviewFlag(capture) {
  return capture?.verification?.decision === 'flagged' || capture?.verification?.status === 'flagged';
}

function renderSourceText(value, language) {
  const safeLanguage = safeSourceLanguageTag(language);
  const text = escapeHtml(value);
  return safeLanguage ? `<span lang="${safeLanguage}" dir="auto">${text}</span>` : text;
}

function renderReceiptTime(value, locale, pending) {
  if (!value || Number.isNaN(Date.parse(value))) return escapeHtml(pending);
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(`${formatted} UTC`)}</time>`;
}

function verificationStatusLabel(locale, capture) {
  const detail = uiFor(locale).detail;
  if (!capture?.verification) return detail.pending;
  return captureHasReviewFlag(capture)
    ? detail.criticStatusFlagged || 'Flagged — not a result summary'
    : detail.criticStatusAccepted || 'Recorded';
}

function renderDetailPage(brief, capture, relatedEntries) {
  const localeMetadata = requireSampleLocale(brief.locale);
  const entry = catalogEntry(brief, capture);
  const text = uiFor(brief.locale);
  const detailText = text.detail;
  const staticCopy = staticSampleCopyFor(brief.locale);
  const lang = localeMetadata.htmlLang;
  const dir = localeMetadata.dir;
  const study = capture?.study;
  const reviewFlagged = captureHasReviewFlag(capture);
  const localeName = localizedLocaleName(brief.locale, brief.locale);
  const industryName = localizedIndustryName(brief.industry, brief.locale);
  const marketName = localizedMarketName(brief.request.market, brief.locale);
  const evidenceRows = capture?.evidence.ledger.map((source) => {
    const sourceLanguage = safeSourceLanguageTag(source.sourceLanguage);
    const sourceLanguageLabel = sourceLanguage && detailText.sourceLanguage
      ? `<small class="source-language" data-source-language="${sourceLanguage}">${escapeHtml(detailText.sourceLanguage)}: ${escapeHtml(localizedSourceLanguageName(sourceLanguage, brief.locale))}</small>`
      : '';
    return `<tr><td data-label="${escapeHtml(detailText.source)}">${renderSourceText(source.title, source.titleLanguage || sourceLanguage)}${sourceLanguageLabel}</td><td data-label="${escapeHtml(detailText.host)}">${source.url ? `<a href="${escapeHtml(source.url)}" rel="nofollow noopener">${escapeHtml(new URL(source.url).hostname)}</a>` : escapeHtml(detailText.noUrl)}</td><td data-label="${escapeHtml(detailText.mode)}">${escapeHtml(source.acquisition || detailText.evidenceLabel)}</td><td data-label="${escapeHtml(detailText.excerpt)}">${renderSourceText(source.excerpt, source.excerptLanguage || sourceLanguage)}</td></tr>`;
  }).join('') || `<tr><td colspan="4">${escapeHtml(detailText.noLedger)}</td></tr>`;
  const curatedSources = brief.curatedContextUrls.map((url) => `<article class="source-card"><header><strong>${escapeHtml(new URL(url).hostname)}</strong><span class="source-type">${escapeHtml(detailText.curatedType)}</span></header><a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url)}</a></article>`).join('');
  const modelCells = capture?.modelLineage.slice(0, 4).map((item, index) => `<div class="model-cell"><strong>${escapeHtml(detailText.cell)} ${index + 1}</strong><span>${escapeHtml(item.resolvedModel || item.requestedModel || detailText.model)}</span><span>${escapeHtml(item.status === 'completed' ? detailText.recorded : (item.status || detailText.recorded))}</span></div>`).join('') || `<div class="model-cell"><strong>${escapeHtml(detailText.pending)}</strong><span>${escapeHtml(detailText.modelPending)}</span></div>`;
  const segments = study?.segments.length ? study.segments.map((segment) => `<div class="segment-row"><span class="segment-label">${escapeHtml(segment.label)}</span>${distributionChart(segment.values, { compact: true, locale: brief.locale })}<span class="segment-result">${segment.values[3] + segment.values[4]}%</span></div>`).join('') : `<p class="section-note">${escapeHtml(detailText.segmentNote)}</p>`;
  const perspectives = study?.responses.length ? study.responses.map((response) => `<article class="perspective"><span class="perspective-mark" aria-hidden="true">"</span><small>${escapeHtml(detailText.perspectiveDisclosure || response.disclosure)}</small><blockquote>${escapeHtml(response.quote)}</blockquote><cite>${escapeHtml(response.profile)} · ${escapeHtml(detailText.score)} ${response.score}</cite></article>`).join('') : `<p class="section-note">${escapeHtml(detailText.perspectivesNote)}</p>`;
  const cautions = (study?.cautions.length ? study.cautions : [detailText.perspectivesNote, detailText.validationNotes[0]]).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const lineage = [
    [detailText.brief, `${capture?.provenance.inputHash?.slice(0, 10) || detailText.pending}`],
    [detailText.evidenceLabel, `${capture?.evidence.mode || detailText.pending}; ${capture?.provenance.evidenceHash?.slice(0, 10) || detailText.pending}`],
    [detailText.cohort, `${capture?.ensemble.completedCells || detailText.pending} ${text.table.modelCells}`],
    [detailText.critic, verificationStatusLabel(brief.locale, capture)],
  ].map(([name, text], index) => `<article class="lineage-step" data-step="${index + 1}"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(text)}</p></article>`).join('');
  const criticEvidence = reviewFlagged ? `<section class="critic-evidence"><h2>${escapeHtml(detailText.criticEvidence || 'Critic evidence')}</h2><p class="section-note">${escapeHtml(detailText.criticEvidenceNote || 'This pipeline critic explains the review flag. It is not a result summary or independent external verification.')}</p>${capture?.verification?.critiqueSummary ? `<h3>${escapeHtml(detailText.criticSummary || 'Critic summary')}</h3><p>${escapeHtml(capture.verification.critiqueSummary)}</p>` : ''}${capture?.verification?.weakClaims?.length ? `<h3>${escapeHtml(detailText.weakClaims || 'Flagged claims')}</h3><ul>${capture.verification.weakClaims.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${capture?.verification?.biasSignals?.length ? `<h3>${escapeHtml(detailText.biasSignals || 'Bias signals')}</h3><ul>${capture.verification.biasSignals.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>` : '';
  const takeaway = reviewFlagged
    ? `<div class="study-review-boundary" role="note"><strong>${escapeHtml(detailText.flaggedBoundaryLabel || 'Review boundary')}:</strong> ${escapeHtml(detailText.flaggedBoundary || 'This run was flagged by the pipeline critic. Its model-generated takeaway is not shown as a result summary; use it only to plan human validation.')}</div>`
    : `<p class="distribution-summary">${escapeHtml(study?.takeaway || detailText.validationNotes[0])}</p>`;
  const body = `<section class="study-detail-heading"><div class="study-library-shell"><nav class="study-breadcrumbs" aria-label="${escapeHtml(detailText.breadcrumb)}"><a href="${staticLibraryPath(brief.locale)}">${escapeHtml(text.hub.breadcrumb)}</a><span aria-hidden="true">/</span><a href="${localePath(brief.locale)}">${escapeHtml(localeName)}</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(entry.title)}</span></nav><h1>${escapeHtml(entry.title)}</h1><p class="study-question">${escapeHtml(brief.request.prompt)}</p><dl class="study-meta"><div><dt>${escapeHtml(detailText.meta.audience)}</dt><dd>${escapeHtml(brief.request.audience)}</dd></div><div><dt>${escapeHtml(detailText.meta.market)}</dt><dd>${escapeHtml(marketName)}</dd></div><div><dt>${escapeHtml(detailText.meta.language)}</dt><dd>${escapeHtml(localeName)}</dd></div><div><dt>${escapeHtml(detailText.meta.industry)}</dt><dd>${escapeHtml(industryName)}</dd></div></dl><div class="study-detail-disclosure" data-boundary><strong>${escapeHtml(detailText.boundaryLabel)}:</strong> ${escapeHtml(entry.disclosure)} ${escapeHtml(detailText.boundarySuffix)}</div>${qualityBadges(entry, brief.locale)}<div class="study-detail-actions">${entry.rerun?.allowed ? `<a class="sl-button sl-button-primary" href="${entry.runYourOwnUrl}">${escapeHtml(detailText.run)}</a>` : `<span class="sl-button sl-button-primary" aria-disabled="true" data-rerun-block-code="${escapeHtml(entry.rerun?.block?.code || 'LOCALIZATION_UNRESOLVED')}">${escapeHtml(detailText.run)}</span>`}<a class="sl-button sl-button-secondary" href="${entry.dataUrl}">${escapeHtml(detailText.json)}</a><a class="sl-text-action" href="${localePath(brief.locale)}#library-table">${escapeHtml(detailText.browse)}</a></div></div></section>
  <div class="study-library-shell study-detail-layout"><div class="study-detail-main">
    <section><h2>${escapeHtml(detailText.distribution)}</h2><p class="section-note">${escapeHtml(detailText.distributionNote)}</p>${distributionChart(study?.distribution, { locale: brief.locale })}${takeaway}</section>
    <section class="model-disagreement"><h2>${escapeHtml(detailText.model)} <small>${escapeHtml(detailText.modelNote)}</small></h2><div class="model-grid">${modelCells}</div><div class="model-metrics"><div class="model-metric"><span>${escapeHtml(detailText.mean)}</span><strong>${escapeHtml(capture?.stability.meanJensenShannonDivergence ?? detailText.pending)}</strong></div><div class="model-metric"><span>${escapeHtml(detailText.spread)}</span><strong>${escapeHtml(capture?.stability.maxPercentagePointSpread ?? detailText.pending)}</strong></div></div><p class="section-note">${escapeHtml(capture?.stability.interpretation ? (detailText.stabilityExplanation || capture.stability.interpretation) : detailText.modelPending)}</p></section>
${criticEvidence}
    <section class="segment-hypotheses"><h2>${escapeHtml(detailText.segment)}</h2><p class="section-note">${escapeHtml(detailText.segmentNote)}</p>${segments}</section>
    <section class="synthetic-perspectives"><h2>${escapeHtml(detailText.perspectives)}</h2><p class="section-note">${escapeHtml(detailText.perspectivesNote)}</p><div class="perspective-list">${perspectives}</div></section>
    <section class="validation-plan"><h2>${escapeHtml(detailText.validation)}</h2><ol class="validation-list">${validationItems(brief).map(([title, validationText]) => `<li class="validation-item"><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(validationText)}</p></div></li>`).join('')}</ol></section>
    <section class="evidence-ledger"><h2>${escapeHtml(detailText.evidence)}</h2><table><thead><tr><th>${escapeHtml(detailText.source)}</th><th>${escapeHtml(detailText.host)}</th><th>${escapeHtml(detailText.mode)}</th><th>${escapeHtml(detailText.excerpt)}</th></tr></thead><tbody>${evidenceRows}</tbody></table></section>
    <section class="model-lineage"><h2>${escapeHtml(detailText.lineage)}</h2><div class="lineage-steps">${lineage}</div></section>
    <section class="related-studies"><h2>${escapeHtml(detailText.related)}</h2><table><tbody>${relatedEntries.map((related) => { const relatedLocale = localizedLocaleName(related.locale, brief.locale); return `<tr><td data-label="${escapeHtml(text.table.study)}"><a class="related-study-link" href="${related.detailUrl}" lang="${escapeHtml(requireSampleLocale(related.locale).htmlLang)}" hreflang="${escapeHtml(related.locale)}" aria-label="${escapeHtml(`${related.title} (${relatedLocale})`)}">${escapeHtml(related.title)}</a></td><td data-label="${escapeHtml(text.table.locale)}">${escapeHtml(relatedLocale)}</td><td data-label="${escapeHtml(text.table.industry)}">${escapeHtml(localizedIndustryName(related.industry, brief.locale))}</td></tr>`; }).join('')}</tbody></table></section>
  </div><aside class="study-detail-rail" aria-label="${escapeHtml(detailText.receiptAria)}">
    <section><h2>${escapeHtml(detailText.receipt)}</h2><dl class="rail-list"><div><dt>${escapeHtml(detailText.status)}</dt><dd>${qualityBadges(entry, brief.locale)}</dd></div><div><dt>${escapeHtml(detailText.stableId)}</dt><dd>${escapeHtml(brief.stableId)}</dd></div><div><dt>${escapeHtml(staticCopy.localizationRegistry)}</dt><dd>${escapeHtml(entry.localizationRegistryVersion)}</dd></div><div><dt>${escapeHtml(detailText.runId)}</dt><dd>${escapeHtml(capture?.runId || detailText.pending)}</dd></div><div><dt>${escapeHtml(detailText.runtime)}</dt><dd>${escapeHtml(capture?.provenance.runtimeVersion || detailText.pending)}</dd></div><div><dt>${escapeHtml(detailText.mode)}</dt><dd>${escapeHtml(capture?.provenance.researchMode || brief.request.researchMode)}</dd></div><div><dt>${escapeHtml(detailText.captured)}</dt><dd>${renderReceiptTime(capture?.capturedAt, brief.locale, detailText.pending)}</dd></div><div><dt>${escapeHtml(detailText.evidenceHash)}</dt><dd>${escapeHtml(capture?.provenance.evidenceHash?.slice(0, 16) || detailText.pending)}</dd></div><div><dt>${escapeHtml(detailText.gateway)}</dt><dd>${entry.gatewayCostUsd ? `$${escapeHtml(entry.gatewayCostUsd)}` : escapeHtml(detailText.noCost || detailText.pending)}</dd></div></dl></section>
    <section class="source-ledger"><h2>${escapeHtml(detailText.curated)}</h2><p class="section-note">${escapeHtml(detailText.curatedNote)}</p><div class="source-list">${curatedSources}</div></section>
    <section><h2>${escapeHtml(detailText.inputs)}</h2><dl class="rail-list"><div><dt>${escapeHtml(detailText.unitsLabel)}</dt><dd>${brief.request.panelSize}</dd></div><div><dt>${escapeHtml(detailText.evidenceLabel)}</dt><dd>${escapeHtml(capture?.evidence.mode || brief.request.evidencePolicy)}</dd></div><div><dt>${escapeHtml(detailText.sourcesLabel)}</dt><dd>${entry.sourceCount}</dd></div><div><dt>${escapeHtml(detailText.outputLocale)}</dt><dd>${escapeHtml(brief.locale)}</dd></div></dl></section>
    <section class="known-limitations"><h2>${escapeHtml(detailText.limitations)}</h2><ul>${cautions}</ul>${englishDocumentLink('/limitations/', detailText.limitationsLink, brief.locale, 'rail-more')}</section>
  </aside></div>`;
  return pageShell({
    path: entry.detailUrl,
    title: entry.title,
    description: entry.description,
    lang,
    dir,
    body,
    extraHead: `<link rel="alternate" type="application/json" href="${entry.dataUrl}" />`,
    locale: brief.locale,
    socialCard: socialCardPath(brief.locale, brief),
    active: 'studies-location',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: entry.title,
        description: entry.description,
        url: entry.canonicalUrl,
        inLanguage: brief.locale,
        isPartOf: { '@type': 'WebSite', name: 'Likerts', url: `${siteOrigin}/` },
        datePublished: capture?.capturedAt || undefined,
        dateModified: capture?.capturedAt || undefined,
        author: { '@type': 'Organization', name: 'Likerts' },
        publisher: { '@type': 'Organization', name: 'Likerts', logo: { '@type': 'ImageObject', url: `${siteOrigin}/logo-likerts.png` } },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: text.hub.breadcrumb, item: absolute('/studies/') },
          { '@type': 'ListItem', position: 2, name: localeName, item: absolute(localePath(brief.locale)) },
          { '@type': 'ListItem', position: 3, name: entry.title, item: entry.canonicalUrl },
        ],
      },
    ],
  });
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function socialCardDefinitions(catalog, brandDataUri) {
  const cards = [];
  for (const locale of supportedUiLocales) {
    const landing = localizedLandingCopy[locale];
    const hub = uiFor(locale).hub;
    const copy = landing || { title: hub.title, description: hub.description, eyebrow: hub.eyebrow };
    cards.push({ locale, title: copy.socialTitle || copy.title, description: copy.socialDescription || copy.description, eyebrow: copy.eyebrow });
  }
  for (const entry of catalog.studies) cards.push({ locale: entry.locale, study: entry, title: entry.title, description: entry.description, eyebrow: 'LIKERTS · FROZEN SYNTHETIC SAMPLE' });
  return cards.map((card) => ({ ...card, basename: socialCardBaseName(card.locale, card.study), svg: socialCardSvg({ ...card, brandDataUri }) }));
}

function socialBrandAssetSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="58" viewBox="0 0 680 58"><text x="0" y="39" fill="#f8fbff" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="700">${brandLineByLocale['en-US']}</text></svg>\n`;
}

async function socialBrandDataUri(directory) {
  const brand = await readFile(resolve(directory, `${socialBrandAssetBaseName}.png`));
  return `data:image/png;base64,${brand.toString('base64')}`;
}

async function socialCardManifest(cards, directory) {
  const manifestCards = await Promise.all([...cards]
    .sort((left, right) => left.basename.localeCompare(right.basename))
    .map(async (card) => {
      const png = await readFile(resolve(directory, `${card.basename}.png`));
      return [`${card.basename}.png`, {
        source: `${card.basename}.svg`,
        sourceSha256: sha256(card.svg),
        pngSha256: sha256(png),
        mimeType: 'image/png',
        width: 1200,
        height: 630,
      }];
    }));
  return {
    schemaVersion: '1',
    cardVersion: socialCardVersion,
    assets: {
      [`${socialBrandAssetBaseName}.png`]: {
        source: `${socialBrandAssetBaseName}.svg`,
        sourceSha256: sha256(socialBrandAssetSvg()),
        pngSha256: sha256(await readFile(resolve(directory, `${socialBrandAssetBaseName}.png`))),
        mimeType: 'image/png',
        width: 680,
        height: 58,
      },
    },
    cards: Object.fromEntries(manifestCards),
  };
}

async function assertPngSocialCard(file, label = file) {
  let image;
  try {
    image = await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing checked-in social card ${label}. Run \`npm run studies:build\` where Playwright Chromium is available to regenerate it.`);
    throw error;
  }
  if (!image.subarray(0, 8).equals(pngSignature) || image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) {
    throw new Error(`Checked-in social card ${label} must be a 1200×630 PNG. Run \`npm run studies:build\` where Playwright Chromium is available to regenerate it.`);
  }
}

async function launchSocialCardRenderer(override) {
  if (override === false) return null;
  try {
    const { chromium } = await import('@playwright/test');
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (override === true) throw new Error('Playwright Chromium is unavailable for social-card rasterization. Install the project browser or use the checked-in PNG fallback.', { cause: error });
    return null;
  }
}

async function socialRasterHasRequiredPixels(page, image, validation) {
  if (!validation) return true;
  const dataUri = `data:image/png;base64,${image.toString('base64')}`;
  const counts = await page.evaluate(async ({ dataUri, validation }) => {
    const source = new Image();
    source.src = dataUri;
    await source.decode();
    // This code runs inside a standalone SVG document, where createElement()
    // inherits the SVG namespace and does not expose CanvasRenderingContext2D.
    const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    const lightPixels = (x, y, width, height) => {
      const pixels = context.getImageData(x, y, width, height).data;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 210 && pixels[index + 1] > 210 && pixels[index + 2] > 210 && pixels[index + 3] > 0) count += 1;
      }
      return count;
    };
    if (validation === 'brand') return { width: source.width, height: source.height, brand: lightPixels(0, 0, source.width, source.height) };
    return {
      width: source.width,
      height: source.height,
      title: lightPixels(300, 180, 600, 180),
      brand: lightPixels(300, 515, 360, 30),
      caveat: lightPixels(300, 548, 600, 28),
    };
  }, { dataUri, validation });
  return validation === 'brand'
    ? counts.width === 680 && counts.height === 58 && counts.brand > 250
    : counts.width === 1200 && counts.height === 630 && counts.title > 250 && counts.brand > 250 && counts.caveat > 100;
}

async function rasterizeSocialSvg(browser, svg, png, { transparent = false, validation = null } = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    try {
      await page.goto(pathToFileURL(svg).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('image').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => new Promise((resolve, reject) => {
          const preload = new Image();
          preload.onload = async () => { try { await preload.decode(); resolve(); } catch { resolve(); } };
          preload.onerror = () => reject(new Error(`Unable to decode embedded social-card image: ${image.getAttribute('href')?.slice(0, 32)}`));
          preload.src = image.getAttribute('href');
        })));
        for (const image of images) {
          const href = image.getAttribute('href');
          image.removeAttribute('href');
          await new Promise((resolve) => requestAnimationFrame(resolve));
          image.setAttribute('href', href);
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      });
      await page.waitForTimeout(120);
      const screenshot = await page.locator('svg').screenshot({ omitBackground: transparent });
      if (await socialRasterHasRequiredPixels(page, screenshot, validation)) {
        await atomicWriteFile(png, screenshot);
        return;
      }
    } finally {
      await page.close();
    }
  }
  throw new Error(`Chromium could not produce a complete social-card raster for ${svg} after five attempts.`);
}

async function validateCheckedInSocialCards(cards, sourceDirectory) {
  const manifestFile = resolve(sourceDirectory, socialCardManifestFilename);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing ${socialCardManifestFilename}. Run \`npm run studies:build\` where Playwright Chromium is available to generate checked-in PNG social cards.`);
    throw new Error(`Unable to read ${socialCardManifestFilename}: ${error.message}`);
  }
  for (const card of cards) await assertPngSocialCard(resolve(sourceDirectory, `${card.basename}.png`), `${card.basename}.png`);
  const brandAsset = await readFile(resolve(sourceDirectory, `${socialBrandAssetBaseName}.png`));
  if (!brandAsset.subarray(0, 8).equals(pngSignature) || brandAsset.readUInt32BE(16) !== 680 || brandAsset.readUInt32BE(20) !== 58) {
    throw new Error(`Checked-in social brand asset ${socialBrandAssetBaseName}.png must be a 680×58 PNG. Run \`npm run studies:build\` to regenerate it.`);
  }
  const expected = await socialCardManifest(cards, sourceDirectory);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error(`Checked-in social card sources or PNG integrity do not match ${socialCardManifestFilename}. Run \`npm run studies:build\` where Playwright Chromium is available and commit public/social/.`);
  }
  return expected;
}

async function writeSocialBrandAsset(directory, checkedInDirectory, browser) {
  const svg = resolve(directory, `${socialBrandAssetBaseName}.svg`);
  const png = resolve(directory, `${socialBrandAssetBaseName}.png`);
  await atomicWriteFile(svg, socialBrandAssetSvg());
  if (!browser) {
    const source = resolve(checkedInDirectory, `${socialBrandAssetBaseName}.png`);
    if (source !== png) await atomicWriteFile(png, await readFile(source));
    return;
  }
  await rasterizeSocialSvg(browser, svg, png, { transparent: true, validation: 'brand' });
}

async function writeSocialCards(outputDirectory, catalog, { rasterizerAvailable, fallbackDirectory } = {}) {
  const directory = resolve(outputDirectory, socialCardDirectory);
  const checkedInDirectory = fallbackDirectory || resolve(publicDirectory, socialCardDirectory);
  const browser = await launchSocialCardRenderer(rasterizerAvailable);
  let cards;
  await mkdir(directory, { recursive: true });
  if (!browser) {
    cards = socialCardDefinitions(catalog, await socialBrandDataUri(checkedInDirectory));
    const manifest = await validateCheckedInSocialCards(cards, checkedInDirectory);
    await writeSocialBrandAsset(directory, checkedInDirectory, false);
    for (const card of cards) {
      await atomicWriteFile(resolve(directory, `${card.basename}.svg`), card.svg);
      const source = resolve(checkedInDirectory, `${card.basename}.png`);
      const destination = resolve(directory, `${card.basename}.png`);
      if (source !== destination) await atomicWriteFile(destination, await readFile(source));
    }
    await atomicWriteFile(resolve(directory, socialCardManifestFilename), `${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  try {
    await writeSocialBrandAsset(directory, checkedInDirectory, browser);
    cards = socialCardDefinitions(catalog, await socialBrandDataUri(directory));
    for (const card of cards) {
      const svg = resolve(directory, `${card.basename}.svg`);
      const png = resolve(directory, `${card.basename}.png`);
      await atomicWriteFile(svg, card.svg);
      await rasterizeSocialSvg(browser, svg, png, { validation: 'card' });
      await assertPngSocialCard(png, png);
    }
  } finally {
    await browser.close();
  }
  const manifest = await socialCardManifest(cards, directory);
  await atomicWriteFile(resolve(directory, socialCardManifestFilename), `${JSON.stringify(manifest, null, 2)}\n`);
}

function staticPageSeo({ locale = 'en-US', title, description, path }) {
  const image = absolute(socialCardPath(locale));
  const pageTitle = `${title} | Likerts`;
  const alt = socialCardAlt({ locale, title });
  return `<meta property="og:type" content="website" /><meta property="og:site_name" content="Likerts" /><meta property="og:locale" content="${openGraphLocale(locale)}" /><meta property="og:title" content="${escapeHtml(pageTitle)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:url" content="${absolute(path)}" /><meta property="og:image" content="${image}" /><meta property="og:image:secure_url" content="${image}" /><meta property="og:image:type" content="image/png" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="${escapeHtml(alt)}" />\n    <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(pageTitle)}" /><meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${image}" /><meta name="twitter:image:alt" content="${escapeHtml(alt)}" />`;
}

async function refreshLegacyStaticSeo(outputDirectory) {
  const pages = [
    ['/how-it-works/', 'How Likerts works', 'A practical workflow for exploring synthetic audience hypotheses before human validation.'],
    ['/methodology/', 'Likerts methodology', 'How Likerts separates source context, assumptions, model inference, and human-validation next steps.'],
    ['/research-standards/', 'Synthetic research standards', 'How Likerts reports sources, model lineage, repeatability, uncertainty, evaluation, and run cost.'],
    ['/limitations/', 'Limitations of Likerts synthetic research', 'What Likerts can help explore—and what it cannot establish.'],
    ['/examples/', 'Likerts example hypotheses', 'Examples of directional audience hypotheses to explore with Likerts before human validation.'],
    ['/synthetic-market-research/', 'Synthetic market research', 'A practical guide to using synthetic research responsibly before human validation.'],
  ];
  for (const [path, title, description] of pages) {
    const file = resolve(outputDirectory, path.slice(1), 'index.html');
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const stripped = html
      .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
      .replace(/\s*<meta property="og:[^"]+"[^>]*\/>/g, '')
      .replace(/\s*<meta name="twitter:[^"]+"[^>]*\/>/g, '')
      .replace(/\s*<link rel="icon"[^>]*\/>/g, '')
      .replace(/\s*<link rel="apple-touch-icon"[^>]*\/>/g, '')
      .replace(/\s*<link rel="manifest"[^>]*\/>/g, '')
      .replace(/Likerts — (?:Directional synthetic research|Free Synthetic Market Research)/g, brandLineByLocale['en-US']);
    const seo = staticPageSeo({ title, description, path });
    const next = stripped
      .replace(/(<link rel="canonical"[^>]*>)/, `${faviconLinks()}\n    $1`)
      .replace(/(<link rel="stylesheet"[^>]*>)/, `${seo}\n    $1`);
    await writeFile(file, next);
  }
}

function sitemap(catalog) {
  const staticPaths = ['/', '/how-it-works/', '/methodology/', '/research-standards/', '/limitations/', '/examples/', '/synthetic-market-research/', '/studies/', ...acquisitionLocales.map(landingPath)];
  const localePaths = [...new Set(catalog.studies.map((entry) => localePath(entry.locale)))];
  const studyPaths = catalog.studies.map((entry) => entry.detailUrl);
  const urls = [...staticPaths, ...localePaths, ...studyPaths].sort((left, right) => left.localeCompare(right));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url>\n    <loc>${absolute(path)}</loc>\n  </url>`).join('\n')}
</urlset>
`;
}

function llmsText(catalog) {
  const published = catalog.studies.filter((entry) => entry.quality?.automatedQa?.status === 'passed').length;
  return `# Likerts

> Likerts is free synthetic market research for market researchers. It generates model-produced distributions, segments, and research-planning outputs from a brief, with disclosed source context and assumptions when available. It does not provide human-panel evidence, representative estimates, causal findings, independently verified sources, or customer testimony.

## Primary pages

- [Likerts app](${siteOrigin}/): Generate free synthetic data for concept tests, audience hypotheses, messages, pricing, and research planning. Completed live runs include disclosed assumptions and a downloadable human-research handoff draft; no panel is booked.
- [Synthetic market research examples](${siteOrigin}/studies/): ${catalog.studies.length} curated global sample studies, ${published} currently published from frozen captures, with JSON records, source ledgers, model disagreement, cost provenance, and human-validation guidance.
- [How it works](${siteOrigin}/how-it-works/): Practical workflow for using a synthetic study to prepare human research.
- [Methodology](${siteOrigin}/methodology/): How the tool separates source context, assumptions, model inference, and methodological model review.
- [Research standards](${siteOrigin}/research-standards/): Quick and Deep modes, repeatability, run receipts, evaluation boundaries, and operating safeguards.
- [Validation Lab manifest](${siteOrigin}/research-standards/benchmark-manifest.json): Machine-readable zero-state, candidate dataset roadmap, protocol, and metric definitions. It currently reports NO_COMPLETED_BENCHMARKS and no accuracy claim.
- [Limitations](${siteOrigin}/limitations/): Evidence boundaries and appropriate use.
- [Synthetic data for market research](${siteOrigin}/synthetic-market-research/): A practical category guide, global workflow, appropriate uses, and evidence boundaries.
- [Remote MCP endpoint](${siteOrigin}/api/mcp): Streamable HTTP interface for validating a brief, running the evidence-aware synthetic workflow, exploring a completed model-constructed segment, or reading sample-study catalog resources.

## Sample studies

${catalog.studies.map((entry) => `- [${entry.title}](${entry.canonicalUrl}): ${entry.localeName}; ${entry.industryName}; ${entry.status}; JSON ${siteOrigin}${entry.dataUrl}`).join('\n')}

## MCP tools and resources

- \`validate_research_brief\`: validate a brief without model calls.
- \`run_synthetic_study\`: run a bounded synthetic study; may call models and retrieval; returns a versioned human-research handoff draft with no observed responses or panel booking.
- \`explore_synthetic_segment\`: generate a bounded follow-up, objection, counterfactual, or two-concept comparison from supplied completed-run context. Every answer is labeled as a model-generated perspective, not a participant quotation.
- \`list_sample_studies\`: list frozen sample-study records without model calls.
- \`get_sample_study\`: fetch one frozen sample-study record by slug without model calls.
- \`likerts://sample-studies/catalog\`: machine-readable sample-study catalog.
- \`likerts://sample-studies/{slug}\`: machine-readable individual sample-study record.

## Research modes

- Quick mode: a bounded, lower-cost synthetic run for early hypothesis exploration.
- Deep mode: a multi-call synthetic cohort with model disagreement, critic review, run receipt, and Gateway cost provenance where available.

## Use guidance

- Describe Likerts output as synthetic and directional.
- Do not describe simulation units as surveyed respondents.
- Do not present generated segments, distributions, or verbatims as real audience data or customer quotes.
- Treat supplied or retrieved public text as context, not independent verification.
- Treat uploaded materials as unverified, bounded grounding rather than human validation.
- Treat replay as auditable but not deterministic; compare repeated runs using the reported stability fields.
- Use the generated questionnaire, screener, sample-planning assumptions, recruitment instructions, and analysis plan as a researcher-review draft before suitable human research.

## Optional detail

- [Full product and methodology summary](${siteOrigin}/llms-full.txt)
`;
}

function llmsFullText(catalog) {
  return `${llmsText(catalog)}
## Sample-study JSON catalog

The canonical catalog is available at ${siteOrigin}/studies/index.json. Individual records are available at ${siteOrigin}/{locale}/studies/{slug}/study.json. Each record exposes the original brief, the capture status, and, when captured, sanitized study output, source ledger, model lineage, run hashes, cost reporting, uncertainty metrics, and critic findings.

## Synthetic boundary

The library is designed for research planning and SEO discovery, not for publishing claims about what people believe. A published sample is a frozen model-generated run that passed automated integrity checks. Human editorial review remains pending, and no human panel was surveyed.
`;
}

async function writePage(outputDirectory, path, html) {
  const directory = resolve(outputDirectory, path.replace(/^\//, ''));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), html);
}

export async function buildSampleStudyArtifacts({ studies = sampleStudies, captures = [], outputDirectory = defaultOutputDirectory, socialCardRasterizerAvailable, socialCardFallbackDirectory } = {}) {
  validateSampleStudyRegistry(studies);
  assertStaticSampleLocalizationCopy([...new Set(studies.map((study) => study.locale))]);
  const bySlug = new Map(studies.map((study) => [study.slug, study]));
  const captureBySlug = new Map();
  for (const candidate of captures) {
    const brief = bySlug.get(candidate?.briefSlug);
    if (!brief) throw new TypeError(`Capture references an unknown sample-study slug: ${candidate?.briefSlug || 'missing'}.`);
    if (captureBySlug.has(brief.slug)) throw new TypeError(`Only one capture is allowed for ${brief.slug}.`);
    const capture = normalizeCapturedStudy(brief, candidate);
    captureBySlug.set(brief.slug, capture);
  }
  await mkdir(outputDirectory, { recursive: true });
  const orderedStudies = [...studies].sort((left, right) => left.slug.localeCompare(right.slug));
  const catalog = { schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION, generatedFrom: 'curated-sample-study-registry', studies: orderedStudies.map((study) => catalogEntry(study, captureBySlug.get(study.slug))) };
  const globalDirectory = resolve(outputDirectory, 'studies');
  await rm(globalDirectory, { recursive: true, force: true });
  await mkdir(globalDirectory, { recursive: true });
  await writeFile(resolve(globalDirectory, 'index.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(resolve(globalDirectory, 'index.html'), renderIndexPage(catalog));
  for (const locale of acquisitionLocales) {
    await writePage(outputDirectory, landingPath(locale), renderLocalizedLanding(locale));
  }
  for (const locale of [...new Set(orderedStudies.map((study) => study.locale))]) {
    const localeEntries = catalog.studies.filter((entry) => entry.locale === locale);
    const localeDirectory = resolve(outputDirectory, locale.toLowerCase(), 'studies');
    await rm(localeDirectory, { recursive: true, force: true });
    await mkdir(localeDirectory, { recursive: true });
    await writeFile(resolve(localeDirectory, 'index.json'), `${JSON.stringify({ schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION, locale, studies: localeEntries }, null, 2)}\n`);
    await writePage(outputDirectory, localePath(locale), renderScopedHub(catalog, { type: 'locale', value: locale }));
  }
  for (const study of orderedStudies) {
    const detailDirectory = resolve(outputDirectory, study.locale.toLowerCase(), 'studies', study.slug);
    const capture = captureBySlug.get(study.slug);
    const detailUrl = studyPath(study.locale, study.slug);
    const entry = catalog.studies.find((candidate) => candidate.slug === study.slug);
    const detail = { schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION, brief: study, localization: entry.localization, localizationRegistryVersion: entry.localizationRegistryVersion, sampleLineage: entry.sampleLineage, quality: entry.quality, rerun: entry.rerun, curatedContextCandidates: study.curatedContextUrls.map((url) => ({ url, status: 'candidate-not-confirmed-as-runtime-evidence' })), capture: capture || null, status: entry.status, htmlUrl: detailUrl, dataUrl: `${detailUrl}study.json`, canonicalUrl: absolute(detailUrl) };
    await mkdir(detailDirectory, { recursive: true });
    await writeFile(resolve(detailDirectory, 'study.json'), `${JSON.stringify(detail, null, 2)}\n`);
    const related = catalog.studies.filter((entry) => entry.slug !== study.slug && (entry.industry === study.industry || entry.locale === study.locale)).slice(0, 3);
    const fallbackRelated = related.length ? related : catalog.studies.filter((entry) => entry.slug !== study.slug).slice(0, 3);
    await writeFile(resolve(detailDirectory, 'index.html'), renderDetailPage(study, capture, fallbackRelated));
  }
  await writeSocialCards(outputDirectory, catalog, { rasterizerAvailable: socialCardRasterizerAvailable, fallbackDirectory: socialCardFallbackDirectory });
  await refreshLegacyStaticSeo(outputDirectory);
  await writeFile(resolve(outputDirectory, 'sitemap.xml'), sitemap(catalog));
  await writeFile(resolve(outputDirectory, 'llms.txt'), llmsText(catalog));
  await writeFile(resolve(outputDirectory, 'llms-full.txt'), llmsFullText(catalog));
  return freeze({ outputDirectory, studyCount: orderedStudies.length, capturedCount: captureBySlug.size, catalogUrl: '/studies/index.json', htmlUrl: '/studies/' });
}

export async function readCapturedStudies(captureDirectory = defaultCaptureDirectory) {
  let files = [];
  try {
    files = (await readdir(captureDirectory)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(resolve(captureDirectory, file), 'utf8'))));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const captures = await readCapturedStudies();
  const result = await buildSampleStudyArtifacts({ captures });
  process.stdout.write(`Built ${result.studyCount} sample-study artifacts (${result.capturedCount} captured).\n`);
}
