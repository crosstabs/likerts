import { initialResult, initialStudy } from '../data.js';

const CJK_ILLUSTRATIVE_COPY = Object.freeze({
  'zh-CN': Object.freeze({
    market: 'China',
    prompt: '如果一款智能新能源汽车默认关闭非必要数据采集，并提供车内本地处理、逐项授权和一键删除记录，您有多大可能启用语音助手和个性化导航？',
    audience: '计划在三年内考虑购买新能源汽车的中国主要城市成年人',
    concept: '一款默认关闭非必要数据采集，并提供车内本地处理、逐项授权和一键删除记录的智能新能源汽车。',
    assumptions: '所有控制功能均按描述运行；必要的安全处理单独说明；所有人看到相同的功能演示。',
    title: '隐私控制条件下启用车载智能功能的可能性',
    summary: '该示意性合成分布显示，在控制功能清晰可见时，启用意向偏正向。',
    takeaway: '示意结果显示出正向趋势，但这不是观察到的人类态度。请通过普通话认知访谈和真实产品测试来验证理解、信任和实际设置行为。',
    confidenceNote: '这是首次模型运行前显示的示意数据，不是抽样调查结果。',
    audienceLabel: '潜在新能源汽车购买者',
    contextLabel: '中国主要城市 · 三年内购车意向',
    attributes: [
      ['隐私关注', '从较低到较高的示意性组合'],
      ['年龄范围', '25–54 岁'],
      ['使用情境', '车载语音助手和个性化导航'],
    ],
    segments: ['隐私优先型', '功能平衡型', '便利驱动型', '谨慎观望型'],
    responses: [
      ['重视隐私的潜在购车者 · 34', '如果每项权限都能单独查看和撤回，我会更愿意尝试，但仍会先确认哪些处理必须上传。'],
      ['高频导航用户 · 29', '本地处理和一键删除让我更放心，只要关闭数据收集不会影响基本导航。'],
      ['家庭用车决策者 · 41', '这些控制听起来有帮助，但我需要看到简单说明，并确认删除记录后会发生什么。'],
      ['谨慎采用者 · 52', '即使默认关闭非必要采集，我仍会等待真实使用反馈，再决定是否启用个性化功能。'],
    ],
  }),
  'ja-JP': Object.freeze({
    market: 'Japan',
    prompt: 'スタッフ対応も選べ、料金・キャンセル条件・データ利用が事前に明示される場合、次回の国内出張でモバイル事前チェックインとデジタルキーを利用する可能性はどの程度ありますか。',
    audience: '過去1年間に国内のビジネスホテルへ2回以上宿泊した成人',
    concept: 'スタッフ対応を残し、料金・キャンセル条件・データ利用を事前に明示するモバイル事前チェックインとデジタルキー。',
    assumptions: 'スタッフ支援と物理キーの代替手段があり、本人確認は適用要件を満たし、全員に同じ利用条件が示されます。',
    title: '国内出張でモバイルチェックインを利用する可能性',
    summary: 'この説明用の合成分布では、対面支援と条件の明示がある場合に利用意向がやや前向きです。',
    takeaway: '説明用の結果は前向きな方向を示しますが、実際の宿泊者の態度ではありません。日本語での認知インタビューと到着動線の実地テストで、理解、完了率、対面切替を検証してください。',
    confidenceNote: '最初のモデル実行前に表示する説明用データであり、標本調査の結果ではありません。',
    audienceLabel: '国内出張者',
    contextLabel: '日本 · ビジネスホテルを年2回以上利用',
    attributes: [
      ['デジタル習熟度', '低い層から高い層までの説明用構成'],
      ['年齢範囲', '25～64歳'],
      ['利用場面', '国内出張時のホテル到着'],
    ],
    segments: ['時間短縮重視層', '対面支援併用層', 'デジタル積極層', '慎重確認層'],
    responses: [
      ['出張の多い営業担当 · 37', '到着前に手続きが終わり、問題があればスタッフへ切り替えられるなら使ってみたいです。'],
      ['運用担当者 · 45', '料金とキャンセル条件が同じ画面で確認できれば便利ですが、本人確認で止まらないことが重要です。'],
      ['小規模事業者 · 33', 'デジタルキーは魅力的ですが、電池切れや通信障害のときに物理キーを受け取れるか確認したいです。'],
      ['慎重な利用者 · 58', 'データ利用の範囲が短く分かりやすく説明され、対面手続きも残るなら検討します。'],
    ],
  }),
  'ko-KR': Object.freeze({
    market: 'South Korea',
    prompt: '광고가 시간당 최대 4분이고 아동 콘텐츠에는 광고가 없으며 언제든 해지할 수 있다면, 현재 가장 많이 쓰는 유료 OTT 요금제를 30% 저렴한 광고형 요금제로 바꿀 가능성은 얼마나 됩니까?',
    audience: '최근 3개월 동안 유료 OTT 서비스를 이용한 20–49세 성인',
    concept: '시간당 광고를 최대 4분으로 제한하고 아동 콘텐츠에는 광고가 없으며 언제든 해지할 수 있는 30% 저렴한 광고형 OTT 요금제.',
    assumptions: '콘텐츠 목록과 화질은 동일하고, 할인과 광고량은 설명대로 유지되며, 월 단위 해지가 가능합니다.',
    title: '광고형 OTT 요금제로 전환할 가능성',
    summary: '이 예시용 합성 분포에서는 광고량과 해지 조건이 명확할 때 전환 의향이 다소 긍정적으로 나타납니다.',
    takeaway: '예시 결과는 긍정적인 방향을 보이지만 실제 이용자의 태도를 관찰한 것이 아닙니다. 한국어 인지 인터뷰와 동의 기반 요금제 실험으로 이해도, 전환, 광고 이탈과 해지를 검증하세요.',
    confidenceNote: '첫 모델 실행 전에 보여 주는 예시 데이터이며 표본 설문 결과가 아닙니다.',
    audienceLabel: '유료 OTT 이용자',
    contextLabel: '대한민국 · 최근 3개월 내 이용',
    attributes: [
      ['광고 수용도', '낮음부터 높음까지의 예시 구성'],
      ['연령 범위', '20–49세'],
      ['이용 상황', '주로 사용하는 유료 OTT 요금제'],
    ],
    segments: ['가격 절감 우선형', '광고 부담 균형형', '콘텐츠 중심형', '무광고 선호형'],
    responses: [
      ['가격을 중시하는 이용자 · 27', '광고 시간이 실제로 제한되고 바로 해지할 수 있다면 비용을 줄이기 위해 시험해 볼 것 같습니다.'],
      ['가족 계정 이용자 · 39', '아동 콘텐츠에 광고가 없다는 점은 좋지만, 가족 모두가 같은 조건을 적용받는지 확인하고 싶습니다.'],
      ['주말 집중 시청자 · 32', '30% 할인은 매력적이지만 긴 콘텐츠 중간에 광고가 어디에 배치되는지가 중요합니다.'],
      ['무광고 선호 이용자 · 46', '가격보다 끊김 없는 시청을 더 중요하게 생각해서 실제 광고 경험을 보기 전에는 바꾸기 어렵습니다.'],
    ],
  }),
});

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

function buildIllustrativeExample(locale, copy) {
  const study = {
    ...initialStudy,
    prompt: copy.prompt,
    audience: copy.audience,
    market: copy.market,
    outputLocale: locale,
    instrumentLocale: locale,
    concept: copy.concept,
    assumptions: copy.assumptions,
  };
  const populationFrame = {
    ...initialResult.populationFrame,
    intendedPopulation: copy.audience,
    geography: { market: copy.market, countryCode: locale.slice(-2) },
    languages: { outputLocale: locale, sourceLanguages: [] },
  };
  const responses = copy.responses.map(([profile, quote], index) => ({
    ...initialResult.responses[index],
    profile,
    quote,
  }));
  const result = {
    ...initialResult,
    title: copy.title,
    summary: copy.summary,
    takeaway: copy.takeaway,
    confidenceNote: copy.confidenceNote,
    methodResult: {
      ...initialResult.methodResult,
      summary: copy.summary,
    },
    audienceSummary: {
      audienceLabel: copy.audienceLabel,
      contextLabel: copy.contextLabel,
      attributes: copy.attributes.map(([label, value]) => ({ label, value })),
    },
    segments: initialResult.segments.map((segment, index) => ({
      ...segment,
      label: copy.segments[index],
    })),
    responses,
    populationFrame,
    modelCard: {
      ...initialResult.modelCard,
      disclosure: populationFrame.disclaimer,
    },
    researchDesign: {
      ...initialResult.researchDesign,
      stimulus: { ...initialResult.researchDesign.stimulus, text: copy.concept },
    },
    meta: {
      ...initialResult.meta,
      market: copy.market,
      outputLocale: locale,
    },
  };
  return deepFreeze({ study, result });
}

const CJK_ILLUSTRATIVE_EXAMPLES = deepFreeze(Object.fromEntries(
  Object.entries(CJK_ILLUSTRATIVE_COPY).map(([locale, copy]) => [locale, buildIllustrativeExample(locale, copy)]),
));

const DEFAULT_ILLUSTRATIVE_EXAMPLE = deepFreeze({ study: initialStudy, result: initialResult });

export function illustrativeExampleFor(locale) {
  return CJK_ILLUSTRATIVE_EXAMPLES[locale] || DEFAULT_ILLUSTRATIVE_EXAMPLE;
}

export const cjkIllustrativeExampleLocales = Object.freeze(Object.keys(CJK_ILLUSTRATIVE_EXAMPLES));
