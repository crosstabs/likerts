const cleanLocale = (value) => typeof value === 'string' ? value.trim() : '';

export function studyLanguageAlignment({ interfaceLocale, reportLocale, instrumentLocale }) {
  const interfaceId = cleanLocale(interfaceLocale);
  const reportId = cleanLocale(reportLocale);
  const instrumentId = cleanLocale(instrumentLocale) || reportId;
  const mismatchDimensions = [];
  if (reportId !== interfaceId) mismatchDimensions.push('report');
  if (instrumentId !== interfaceId) mismatchDimensions.push('instrument');

  return Object.freeze({
    interfaceLocale: interfaceId,
    reportLocale: reportId,
    instrumentLocale: instrumentId,
    aligned: Boolean(interfaceId) && mismatchDimensions.length === 0,
    mismatchDimensions: Object.freeze(mismatchDimensions),
  });
}
