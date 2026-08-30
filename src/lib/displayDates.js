import { formatLocalizedDate, formatLocalizedDateTime } from './localizedFormatting.js';

// Presentation must never expose malformed source date values as UI copy.
export function formatDisplayDate(value, locale, notRecorded, includeTime = false) {
  if (!value) return notRecorded;
  try {
    return includeTime ? formatLocalizedDateTime(value, locale) : formatLocalizedDate(value, locale);
  } catch {
    return notRecorded;
  }
}
