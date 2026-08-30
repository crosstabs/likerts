/**
 * Curated sample-study briefs. This module is deliberately dependency-free so
 * browser, build, and MCP consumers can import the same stable catalog.
 */
import {
  LOCALIZATION_REGISTRY_VERSION,
  MARKET_ROLLOUT_STATUSES,
  listLocalesForCapability,
  requireLocaleCapability,
  resolveMarket,
} from '../shared/localization.mjs';

export const SAMPLE_STUDY_SCHEMA_VERSION = '1.1';

// This is an admission capability list, not a coverage requirement. The
// catalog may deliberately contain multiple studies for one enabled locale.
export const supportedSampleStudyLocales = Object.freeze(
  listLocalesForCapability('sample').map((entry) => entry.id),
);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

function canonicalSampleLocalization(locale, request) {
  const sampleLocale = requireLocaleCapability(locale, 'sample');
  const reportLocale = requireLocaleCapability(sampleLocale.id, 'report');
  const instrumentLocale = requireLocaleCapability(sampleLocale.id, 'instrument');
  const sourceLocales = (request.sourceLanguages || []).map((value) => requireLocaleCapability(value, 'source').id);
  const retrievalLocales = sourceLocales.map((value) => requireLocaleCapability(value, 'retrieval').id);
  const market = resolveMarket(request.market);
  if (market.status !== MARKET_ROLLOUT_STATUSES.ENABLED) {
    throw new TypeError(`Sample studies cannot use a market that is not enabled: ${market.id}.`);
  }
  return {
    schemaVersion: 'study-localization-v1',
    marketId: market.id,
    reportLocale: reportLocale.id,
    sourceLocales,
    retrieval: { policy: retrievalLocales.length ? 'PREFER' : 'ANY', locales: retrievalLocales },
    instrumentLocale: instrumentLocale.id,
  };
}

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const brief = ({ stableId, slug, locale, industry, title, description, researchIntent, disclosure, evidenceBoundary, humanValidation, request }) => {
  const { sourceUrls = [], ...runYourOwnRequest } = request;
  const localization = canonicalSampleLocalization(locale, runYourOwnRequest);
  return ({
  schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION,
  stableId,
  slug,
  locale,
  industry,
  title,
  description,
  researchIntent,
  disclosure,
  evidenceBoundary,
  humanValidation,
  // This is the canonical request object accepted by the runtime. The
  // registry version is separate so the request itself stays contract-valid.
  localization,
  localizationRegistryVersion: LOCALIZATION_REGISTRY_VERSION,
  // Curated official links are only included in editorial capture. They are not
  // silently copied into a visitor's editable “run your own” brief.
  curatedContextUrls: sourceUrls,
  request: {
    ...runYourOwnRequest,
    localization,
    outputLocale: locale,
    researchMode: 'DEEP',
    evidencePolicy: 'AUTO',
    clientRunId: `sample-${slug}`,
  },
  });
};

const registry = [
  brief({
    stableId: 'SS-EN-US-001',
    slug: 'ai-copilot-pilot-small-business-us', locale: 'en-US', industry: 'workplace-ai',
    title: 'AI copilot pilot adoption among US small businesses',
    description: 'A directional hypothesis about pilot governance, workflow fit, and responsible adoption.',
    researchIntent: 'Identify the controls that might make a bounded AI-copilot pilot credible to smaller employer businesses.',
    disclosure: 'Synthetic, model-generated hypothesis—not observed survey results or a market estimate.',
    evidenceBoundary: 'Census data may establish firm-size, sector, and AI-use context; NIST may define risk-management considerations. Neither source establishes product preference, pilot intent, purchase likelihood, workforce impact, or the accuracy of this synthetic distribution.',
    humanValidation: 'Conduct 12–15 decision-maker interviews, a message-and-control conjoint with a properly recruited business sample, and an observed 60-day pilot measuring opt-in, weekly use, review burden, error escalation, and discontinuation.',
    request: { prompt: 'How likely would you be to approve a 60-day AI-copilot trial for drafting and internal knowledge search if every output required human review, business data was contractually protected, and monthly cost was capped?', audience: 'Owners and operations, IT, or functional decision-makers at United States employer businesses with 20–249 employees', panelSize: 200, assumptions: 'Low-risk internal workflows only; no automated employment decisions; onboarding and opt-out are included; no staffing-reduction promise; contractual data controls work as described.', market: 'United States', searchLocation: 'United States', sourceLanguages: ['en-US'], searchCountry: 'US', sourceUrls: ['https://www.census.gov/hfp/btos/data_downloads', 'https://www.census.gov/hfp/btos/about', 'https://www.nist.gov/itl/ai-risk-management-framework', 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf'] },
  }),
  brief({
    stableId: 'SS-ES-ES-001',
    slug: 'coche-electrico-recarga-garaje-comunitario-espana', locale: 'es-ES', industry: 'electric-mobility',
    title: 'Recarga de coche eléctrico en garajes comunitarios de España',
    description: 'Una hipótesis direccional sobre permisos, coste y facilidad de instalación.',
    researchIntent: 'Explorar si una propuesta que incluye la instalación de recarga reduce la incertidumbre de quienes viven en pisos y consideran un vehículo eléctrico.',
    disclosure: 'Resultado sintético generado por modelos; no son respuestas de una encuesta observada.',
    evidenceBoundary: 'Los datos de DGT y MITECO pueden describir infraestructura y cuestiones documentadas de recarga; no establecen intención de compra, viabilidad privada, aprobación comunitaria, sensibilidad al precio ni preferencia por esta propuesta.',
    humanValidation: 'Entrevistar a residentes, administradores de fincas, concesionarios e instaladores; probar precio, instalación, plazo y aprobación en una encuesta de elección; validar con leads cualificados y evaluaciones de recarga completadas.',
    request: { prompt: '¿Qué probabilidad habría de que eligiera un coche eléctrico como próximo vehículo si el precio incluyera la instalación del punto de recarga en su plaza de garaje comunitario, con coste total y plazos por escrito?', audience: 'Conductores de ciudades españolas que viven en edificios con aparcamiento comunitario y prevén sustituir su coche en 24–36 meses', panelSize: 200, assumptions: 'Existe una plaza privada; la instalación es técnicamente viable; las aprobaciones comunitarias, eléctricas y del edificio siguen siendo restricciones reales; el alcance y plazo constan por escrito; no se afirma un ahorro total general.', market: 'Spain', searchLocation: 'Spain', sourceLanguages: ['es-ES'], searchCountry: 'ES', sourceUrls: ['https://nap.dgt.es/es/dataset/0d1f0fbe-504d-4cc3-a09e-bdf6b248e8b8', 'https://revista.dgt.es/images/PRESENTACION-ENCUESTA-RESUMEN.pdf', 'https://www.idae.es/tecnologias/eficiencia-energetica/transporte/grupo-de-trabajo-de-infraestructuras-de-recarga-del-vehiculo-electrico-gtirve'] },
  }),
  brief({
    stableId: 'SS-PT-BR-001',
    slug: 'assinatura-pix-automatico-microempresas-brasil', locale: 'pt-BR', industry: 'financial-services',
    title: 'Assinaturas com Pix Automático entre microempresas brasileiras',
    description: 'Uma hipótese direcional sobre fluxo de caixa, confiança e configuração.',
    researchIntent: 'Testar quais avisos de autorização e cancelamento podem sustentar a confiança em assinaturas empresariais recorrentes via Pix Automático.',
    disclosure: 'Estimativa sintética gerada por modelos, não uma pesquisa observada com pessoas.',
    evidenceBoundary: 'Estatísticas e regras do Banco Central podem definir uso, operação, autorização e cancelamento do Pix; não comprovam disposição para assinar, confiança, compreensão, conversão, retenção ou preferência por uma interface.',
    humanValidation: 'Realizar entrevistas de compreensão em português; testar variações de aviso, notificação, cancelamento e preço; observar autorização, falhas, cancelamentos, disputas e contatos de suporte em um piloto limitado.',
    request: { prompt: 'Qual é a probabilidade de você contratar uma assinatura empresarial via Pix Automático se o valor, a frequência, o aviso antes da cobrança e o cancelamento imediato forem mostrados antes da autorização?', audience: 'MEI e donos de pequenas empresas que já usam Pix em transações comerciais', panelSize: 200, assumptions: 'O recebedor é uma empresa registrada; a autorização é explícita; valor e frequência são informados; o cancelamento está disponível no aplicativo; não se presume disponibilidade universal nem fraude zero.', market: 'Brazil', searchLocation: 'Brazil', sourceLanguages: ['pt-BR'], searchCountry: 'BR', sourceUrls: ['https://www.bcb.gov.br/estabilidadefinanceira/pix-em-numeros-estatisticas', 'https://dadosabertos.bcb.gov.br/dataset/pix', 'https://www.bcb.gov.br/estabilidadefinanceira/pix-normas', 'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=513&tipo=Instru%C3%A7%C3%A3o+Normativa+BCB'] },
  }),
  brief({
    stableId: 'SS-FR-FR-001',
    slug: 'consigne-bouteille-reemployable-supermarche-france', locale: 'fr-FR', industry: 'consumer-products',
    title: 'Consigne de bouteilles réemployables en supermarché français',
    description: 'Une hypothèse directionnelle sur le prix, le retour et la disponibilité.',
    researchIntent: 'Explorer les conditions de commodité et de consigne susceptibles d’encourager l’essai d’un emballage en verre réemployable.',
    disclosure: 'Cette sortie synthétique est générée par des modèles, pas par des personnes interrogées.',
    evidenceBoundary: 'L’ADEME peut établir définitions, objectifs, contexte mesuré et analyses environnementales propres à un scénario; ces sources ne permettent ni de généraliser les avantages ni d’inférer achat, retour ou réachat.',
    humanValidation: 'Mener des entretiens en magasin et sur le parcours de retour; tester conjointement montant, lieu et commodité; puis mesurer achat, retour, casse, remboursement et réachat dans un essai en magasin.',
    request: { prompt: 'Dans quelle mesure seriez-vous susceptible d’acheter régulièrement une boisson dans une bouteille en verre réemployable avec une consigne de 1 €, si le retour se faisait dans votre supermarché habituel et que le prix du produit restait identique ?', audience: 'Adultes de 25 à 64 ans achetant des boissons emballées en supermarché au moins chaque semaine', panelSize: 200, assumptions: 'Le prix et la qualité du produit restent identiques; un point de retour existe dans le supermarché habituel; la consigne est remboursée rapidement; aucun bénéfice environnemental universel n’est affirmé au-delà des conditions étudiées.', market: 'France', searchLocation: 'France', sourceLanguages: ['fr-FR'], searchCountry: 'FR', sourceUrls: ['https://observatoire-reemploi-reutilisation.ademe.fr/emballages', 'https://observatoire-reemploi-reutilisation.ademe.fr/chiffres-reemploi-emballages', 'https://observatoire-reemploi-reutilisation.ademe.fr/actualites/etude-consigne-emballages'] },
  }),
  brief({
    stableId: 'SS-DE-DE-001',
    slug: 'waermepumpe-angebot-bestandsheim-deutschland', locale: 'de-DE', industry: 'housing',
    title: 'Wärmepumpen-Angebot für Bestandsheime in Deutschland',
    description: 'Eine richtungsweisende Hypothese zu Kostenklarheit, Förderungen und Umsetzung.',
    researchIntent: 'Ermitteln, welche Angebotsbestandteile Eigentümer zu einer Wärmepumpenprüfung bewegen könnten.',
    disclosure: 'Synthetische, modellgenerierte Einschätzung – keine beobachteten Umfrageergebnisse.',
    evidenceBoundary: 'Destatis kann Wohn- und Heizkontext beschreiben, KfW aktuelle Programmbedingungen. Förderbedingungen müssen datiert und erneut geprüft werden; keine Quelle belegt Absicht, Preisakzeptanz, Eignung oder Einsparungen.',
    humanValidation: 'Eigentümer und Installateure interviewen; Angebotsbestandteile und Preiswahl testen; angeforderte Prüfungen, Vor-Ort-Termine, Abbrüche, angenommene Angebote und mögliche Ergebnisse nach Einbau beobachten.',
    request: { prompt: 'Wie wahrscheinlich ist es, dass Sie für Ihr bestehendes Ein- oder Zweifamilienhaus ein verbindliches Wärmepumpenangebot anfordern, wenn Fördercheck, Gesamtpreis, Schallprognose und erwartete Betriebskosten transparent ausgewiesen werden?', audience: 'Selbstnutzende Eigentümer bestehender Ein- oder Zweifamilienhäuser, die überwiegend mit Gas oder Öl beheizt werden', panelSize: 200, assumptions: 'Die Eignung ist bis zur Prüfung unbestätigt; ein qualifizierter Installateur prüft das Gebäude; Förderung und Betriebskosten hängen von Datum, Immobilie und Haushalt ab; alle Schätzungen zeigen ihre Eingaben.', market: 'Germany', searchLocation: 'Germany', sourceLanguages: ['de-DE'], searchCountry: 'DE', sourceUrls: ['https://www.destatis.de/DE/Presse/Pressemitteilungen/2025/06/PD25_N031_31_51.html', 'https://www.destatis.de/DE/Presse/Pressemitteilungen/Zensus2022-Pressemitteilungen/PM_zensus2022_52.html', 'https://www.kfw.de/inlandsfoerderung/Privatpersonen/Bestehende-Immobilie/F%C3%B6rderprodukte/Heizungsf%C3%B6rderung-f%C3%BCr-Privatpersonen-Wohngeb%C3%A4ude-%28458%29/'] },
  }),
  brief({
    stableId: 'SS-ZH-CN-001',
    slug: 'smart-ev-data-controls-china', locale: 'zh-CN', industry: 'electric-mobility',
    title: '中国智能电动车的数据控制偏好',
    description: '关于数据控制、透明度和功能便利性的方向性假设。',
    researchIntent: '探索可见的数据控制是否会改变用户启用车联网功能的意愿。',
    disclosure: '这是模型生成的合成结果，不是观察到的人类调查结果。',
    evidenceBoundary: '工信部资料可说明汽车与新能源汽车背景，网信办及工信部规则可定义受监管的数据类别与义务；这些来源不能证明消费者信任、隐私理解、功能需求、权限行为或假设产品的合规性。',
    humanValidation: '开展普通话认知访谈，以交互原型测试控制设计，进行多城市选择实验，并在经同意的产品试验中测量真实的同意理解、权限设置、功能启用、删除请求、投诉和长期留存。',
    request: { prompt: '如果一款智能新能源汽车默认关闭非必要数据采集，并提供车内本地处理、逐项授权和一键删除记录，您有多大可能启用语音助手和个性化导航？', audience: '计划在三年内考虑购买新能源汽车的中国主要城市成年人', panelSize: 200, assumptions: '控制功能按描述运行；必要的安全处理单独进行；界面说明哪些功能无法关闭；不承诺完全匿名；所有人看到相同的功能演示。', market: 'China', searchLocation: 'China', sourceLanguages: ['zh-CN'], searchCountry: 'CN', sourceUrls: ['https://www.miit.gov.cn/jgsj/zbys/qcgy/art/2026/art_4c5ed7009d21485da32b2a01abcf2819.html', 'https://www.cac.gov.cn/2021-08/20/c_1631049984897667.htm', 'https://www.miit.gov.cn/gyhxxhb/jgsj/cyzcyfgs/bmgz/xxtxl/art/2022/art_6c31c457291248cc9f95d1dd5f9979c3.html'] },
  }),
  brief({
    stableId: 'SS-JA-JP-001',
    slug: 'mobile-checkin-business-hotels-japan', locale: 'ja-JP', industry: 'travel',
    title: '日本のビジネスホテルにおけるモバイルチェックイン',
    description: '時間短縮、本人確認、対面支援に関する方向性の仮説。',
    researchIntent: '国内出張者がモバイル事前チェックインとデジタルキーを受け入れる条件を探る。',
    disclosure: 'これはモデル生成の合成的な結果であり、観測された調査回答ではありません。',
    evidenceBoundary: '観光庁の統計は宿泊・旅行の状況と観光DXの方針を説明できますが、旅行者の選好、運用上の節約、待ち時間短縮、アクセシビリティ、デジタルキーの成功を証明するものではありません。',
    humanValidation: '到着動線を観察し、年齢と端末習熟度を横断して日本語で面接し、利用選択をA/Bテストして、完了率、対面切替、所要時間、締め出し、アクセシビリティ問題、満足度を測定する。',
    request: { prompt: 'スタッフによる対応も選べ、料金・キャンセル条件・データ利用が事前に明示される場合、次回の国内出張でモバイル事前チェックインとデジタルキーを利用する可能性はどの程度ありますか。', audience: '過去1年間に国内のビジネスホテルへ2回以上宿泊した成人', panelSize: 200, assumptions: 'スタッフ支援を引き続き利用できる；本人確認は適用要件を満たす；物理キーの代替がある；料金・キャンセル・データ利用を開示する；デジタル化が常に待ち時間を減らすとは仮定しない。', market: 'Japan', searchLocation: 'Japan', sourceLanguages: ['ja-JP'], searchCountry: 'JP', sourceUrls: ['https://www.mlit.go.jp/kankocho/tokei_hakusyo/shukuhakutokei.html', 'https://www.mlit.go.jp/kankocho/seisaku_seido/kihonkeikaku/jizoku_kankochi/kanko-dx.html', 'https://www.mlit.go.jp/kankocho/tokei_hakusyo/shohidoko.html'] },
  }),
  brief({
    stableId: 'SS-KO-KR-001',
    slug: 'ad-supported-ott-plan-south-korea', locale: 'ko-KR', industry: 'media',
    title: '한국의 광고 기반 OTT 요금제 선택',
    description: '가격, 광고 경험, 해지 조건에 관한 방향성 가설입니다.',
    researchIntent: '더 저렴한 광고형 OTT 요금제로 전환할 때의 가격·광고·해지 절충을 탐색합니다.',
    disclosure: '이는 모델이 생성한 합성 결과이며 관찰된 사람 설문 결과가 아닙니다.',
    evidenceBoundary: 'KISDI와 방송통신위원회 자료는 미디어 이용 및 구독 맥락을 설명할 수 있지만, 그 수치를 합성 결과로 재사용할 수 없으며 전환·이탈·광고 수용도·요금제 선호를 입증하지 않습니다.',
    humanValidation: '현재 유료 이용자를 인터뷰하고 가격·광고량 컨조인트를 실시하며, 동의 기반 요금제 제안 실험에서 전환, 시청 시간, 광고 이탈, 해지, 취소, 불만 비율을 관찰합니다.',
    request: { prompt: '광고가 시간당 최대 4분이고 아동 콘텐츠에는 광고가 없으며 언제든 해지할 수 있다면, 현재 가장 많이 쓰는 유료 OTT 요금제를 30% 저렴한 광고형 요금제로 바꿀 가능성은 얼마나 됩니까?', audience: '최근 3개월 동안 유료 OTT 서비스를 이용한 20–49세 성인', panelSize: 200, assumptions: '콘텐츠 목록과 화질은 동일하다; 30% 할인은 실제다; 명시된 광고량은 지켜진다; 아동 콘텐츠에는 광고가 없다; 해지는 월 단위로 가능하다.', market: 'South Korea', searchLocation: 'South Korea', sourceLanguages: ['ko-KR'], searchCountry: 'KR', sourceUrls: ['https://kisdi.re.kr/report/view.do?arrMasterId=3934581&artId=1862836&key=m2101113024973&masterId=3934581', 'https://kisdi.re.kr/bbs/view.do?bbsSn=114726&key=m2101113055776', 'https://stat.kisdi.re.kr/main.html', 'https://m.kcc.go.kr/user.do?boardId=1058&boardSeq=65045&cp=2&dc=E04010000&mode=view&page=E04010000'] },
  }),
  brief({
    stableId: 'SS-AR-SA-001',
    slug: 'arabic-ai-study-assistant-saudi-universities', locale: 'ar-SA', industry: 'education',
    title: 'مساعد دراسة بالذكاء الاصطناعي في الجامعات السعودية',
    description: 'فرضية اتجاهية حول الفائدة الأكاديمية والخصوصية والنزاهة.',
    researchIntent: 'تحديد شروط الحوكمة والمنتج التي قد تدعم الاستخدام الطوعي لمساعد دراسة جامعي باللغة العربية.',
    disclosure: 'هذه نتيجة تركيبيّة مولّدة بالنماذج وليست نتائج استطلاع من أشخاص تمت ملاحظتهم.',
    evidenceBoundary: 'قد تحدد مصادر المركز الوطني للتعليم الإلكتروني توقعات الحوكمة والجودة، وقد توضح الهيئة العامة للإحصاء سياق التعليم والاتصال؛ لكنها لا تثبت القبول أو نتائج التعلم أو الدقة أو النزاهة الأكاديمية أو فهم الخصوصية.',
    humanValidation: 'إجراء مقابلات معرفية بالعربية، ومراجعة من الطلاب وأعضاء هيئة التدريس وإتاحة الوصول والحوكمة، ثم تجربة فصل دراسي مضبوطة تقيس التبني الطوعي والأخطاء والتحقق من المصادر وطلب المساعدة والتعلم وفهم الخصوصية.',
    request: { prompt: 'ما مدى احتمال استخدامك مساعد دراسة جامعي باللغة العربية تدعمه المؤسسة، إذا أظهر مصادره، ولم يُستخدم في التقييم، وخضع لإشراف المدرّس، وأتاح لك حذف بياناتك؟', audience: 'طلاب جامعيون بالغون مسجلون في مقررات تُدرّس أساساً بالعربية في السعودية', panelSize: 200, assumptions: 'تعتمد المؤسسة الأداة؛ يمكن فحص الاستشهادات؛ لا تُستخدم الأداة للتقييم أو كشف المخالفات؛ تتوفر إحالة إلى المدرّس وحذف البيانات؛ المشاركة طوعية.', market: 'Saudi Arabia', searchLocation: 'Saudi Arabia', sourceLanguages: ['ar-SA'], searchCountry: 'SA', sourceUrls: ['https://nelc.gov.sa/media-center/news/national-elearning-center-announces-ai-framework-digital-learning', 'https://nelc.gov.sa/en/regulations-and-standards/elearning-standards', 'https://www.stats.gov.sa/documents/20117/2435267/ICT%2BAccess%2Band%2BUsage%2B2025-EN.pdf/d91fc7dd-2f2e-ee1a-248c-c8f38102ef01?t=1767603674645', 'https://www.stats.gov.sa/documents/20117/2435273/Education%2Band%2BTraining%2BStatistics%2B2025%2BEN%2B%281%29.pdf/08f376b7-5906-0a24-1fe9-f609ebfcc5ae?t=1767866579084'] },
  }),
  brief({
    stableId: 'SS-HI-IN-001',
    slug: 'hindi-agromet-advisory-small-farmers-india', locale: 'hi-IN', industry: 'agriculture',
    title: 'भारत के छोटे किसानों के लिए हिंदी कृषि-मौसम सलाह',
    description: 'समय, भरोसे और कार्रवाई योग्य सलाह पर एक दिशात्मक परिकल्पना।',
    researchIntent: 'यह जानना कि स्थानीय भाषा, आवाज़ और फसल-स्तरीय प्रासंगिकता सत्यापित कृषि-मौसम सलाह के नियमित उपयोग को कैसे प्रभावित कर सकती है।',
    disclosure: 'यह मॉडल-जनित संश्लेषित परिणाम है, देखा गया मानव सर्वेक्षण परिणाम नहीं।',
    evidenceBoundary: 'कृषि जनगणना परिचालन जोतों की रूपरेखा और IMD मौजूदा मौसम व सलाह सेवाओं का संदर्भ दे सकते हैं; ये फोन पहुँच, समझ, नियमित उपयोग, कार्रवाई, उपज, आय या कृषि परिणाम सिद्ध नहीं करते।',
    humanValidation: 'कम-से-कम तीन राज्यों में सहायक हिंदी साक्षात्कार करें; टेक्स्ट, आवाज़, कम-डेटा और साझा-डिवाइस यात्राएँ जाँचें; एक पूरी फसल अवस्था तक पायलट चलाकर संदेश प्राप्ति, समझ, कार्रवाई, गैर-उपयोग और विस्तार-कर्मी तक पहुँच देखें।',
    request: { prompt: 'यदि आपके ब्लॉक और फसल के अनुसार सत्यापित मौसम‑कृषि सलाह हिन्दी में, कम डेटा वाले ऐप और आवाज़ दोनों से, सप्ताह में दो बार मुफ़्त मिले, तो आपके उसे नियमित रूप से देखने की कितनी संभावना है?', audience: 'हिंदी-भाषी जिलों के छोटे और सीमांत परिचालन जोत धारक जिनके पास निजी या साझा मोबाइल फोन की पहुँच है', panelSize: 200, assumptions: 'सेवा मुफ़्त है; सलाह समय-मुद्रित है और IMD या विस्तार स्रोतों से जुड़ी है; आवाज़ कम बैंडविड्थ पर काम करती है; साझा उपकरण समर्थित हैं; सेवा स्थानीय विस्तार सलाह का स्थान नहीं लेती।', market: 'India', searchLocation: 'India', sourceLanguages: ['hi-IN'], searchCountry: 'IN', sourceUrls: ['https://mausam.imd.gov.in/responsive/agromet_adv_ser_state_current.php', 'https://mausamsankalp.imd.gov.in/', 'https://internal.imd.gov.in/press_release/20220824_pr_1790.pdf', 'https://www.agcensus.gov.in/AgriCensus/media/Operational%20Guideline%202021-22.pdf'] },
  }),
];

export function validateSampleStudyRegistry(studies) {
  if (!Array.isArray(studies) || !studies.length) throw new TypeError('Sample studies must include at least one brief.');
  const slugs = new Set();
  const stableIds = new Set();
  for (const study of studies) {
    if (!study || study.schemaVersion !== SAMPLE_STUDY_SCHEMA_VERSION) throw new TypeError('Every sample study must use the current schema version.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(study.slug) || slugs.has(study.slug)) throw new TypeError('Sample-study slugs must be unique, lowercase URL segments.');
    if (!/^SS-[A-Z]{2}-[A-Z]{2}-\d{3}$/.test(study.stableId || '') || stableIds.has(study.stableId) || !study.industry || !study.title || !study.description || !study.researchIntent || !study.disclosure || !study.evidenceBoundary || !study.humanValidation) throw new TypeError('Sample-study editorial fields and stable IDs are required.');
    let sampleLocale;
    try {
      sampleLocale = requireLocaleCapability(study.locale, 'sample');
    } catch (error) {
      throw new TypeError(`Sample-study locale admission failed: ${error.message}`);
    }
    if (sampleLocale.id !== study.locale) throw new TypeError('Sample-study locales must use canonical registry IDs.');
    const request = study.request || {};
    if (request.outputLocale !== study.locale || request.researchMode !== 'DEEP' || request.evidencePolicy !== 'AUTO') throw new TypeError('Sample-study requests must be localized DEEP studies with bounded automatic evidence retrieval.');
    const expectedLocalization = canonicalSampleLocalization(study.locale, request);
    if (study.localizationRegistryVersion !== LOCALIZATION_REGISTRY_VERSION || !sameJson(study.localization, expectedLocalization) || !sameJson(request.localization, expectedLocalization)) throw new TypeError('Sample studies must carry matching canonical localization requests and the current registry version.');
    if (!Number.isInteger(request.panelSize) || request.panelSize < 50 || request.panelSize > 500 || typeof request.prompt !== 'string' || request.prompt.trim().length < 12) throw new TypeError('Sample-study requests must satisfy the synthetic-study input bounds.');
    if (!Array.isArray(study.curatedContextUrls) || study.curatedContextUrls.length < 2 || study.curatedContextUrls.length > 4 || study.curatedContextUrls.some((url) => !/^https:\/\//.test(url))) throw new TypeError('Sample studies must include two to four curated public official source URLs.');
    slugs.add(study.slug); stableIds.add(study.stableId);
  }
  if (new Set(studies.map((study) => study.industry)).size < 6) throw new TypeError('Sample studies must cover at least six industries.');
  return true;
}

validateSampleStudyRegistry(registry);
export const sampleStudies = deepFreeze(registry);
