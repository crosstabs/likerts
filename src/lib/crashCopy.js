const crashCopy = Object.freeze({
  en: Object.freeze({ title: 'Likerts could not continue', body: 'Reload the page to start again. If this repeats, share the reference shown with the failed request.', reload: 'Reload page' }),
  zh: Object.freeze({ title: 'Likerts 无法继续运行', body: '请重新加载页面后再试。如果问题重复出现，请提供失败请求中显示的参考编号。', reload: '重新加载页面' }),
  ja: Object.freeze({ title: 'Likerts を続行できませんでした', body: 'ページを再読み込みして、もう一度お試しください。繰り返し発生する場合は、失敗したリクエストに表示された参照番号をお知らせください。', reload: 'ページを再読み込み' }),
  ko: Object.freeze({ title: 'Likerts를 계속 실행할 수 없습니다', body: '페이지를 새로고침한 후 다시 시도하세요. 문제가 반복되면 실패한 요청에 표시된 참조 번호를 알려 주세요.', reload: '페이지 새로고침' }),
});

export function localizedCrashCopy(language = 'en') {
  const key = String(language).toLowerCase().split('-')[0];
  return crashCopy[key] || crashCopy.en;
}
