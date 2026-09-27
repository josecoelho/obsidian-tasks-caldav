import { moment } from 'obsidian';

/**
 * Accept only a complete date: YYYY plus month/day, or YYYY plus day-of-year.
 * Tokens may be adjacent or separated by spaces, hyphens, dots, or slashes.
 * This is a subset of Moment syntax; literals and all other tokens are rejected.
 */
export function isDayFormat(format: string): boolean {
  if (!format || typeof format !== 'string') return false;

  const parts = format.match(/YYYY|M{1,4}|Do|D{1,4}|[-./ ]+/g);
  // Reject anything outside the supported syntax instead of stripping it.
  if (!parts || parts.join('') !== format) return false;

  const yearCount = parts.filter(part => part === 'YYYY').length;
  const monthCount = parts.filter(part => part.startsWith('M')).length;
  const dayOfMonthCount = parts.filter(part => ['D', 'DD', 'Do'].includes(part)).length;
  const dayOfYearCount = parts.filter(part => ['DDD', 'DDDD'].includes(part)).length;

  return yearCount === 1 && (
    (monthCount === 1 && dayOfMonthCount === 1 && dayOfYearCount === 0) ||
    (monthCount === 0 && dayOfMonthCount === 0 && dayOfYearCount === 1)
  );
}

/**
 * Parse the filename or trailing path segments using the restricted date format.
 * Invalid formats, mismatched paths, and impossible dates return null.
 */
export function extractDateFromNotePath(path: string, format?: string): string | null {
  if (!format || !isDayFormat(format)) return null;

  const pathSegments = path.replace(/\.md$/i, '').split('/');
  const segmentCount = format.split('/').length;
  if (pathSegments.length < segmentCount) return null;

  const dateText = pathSegments.slice(-segmentCount).join('/');
  // A note date is a calendar day, independent of local timezone transitions.
  const date = moment.utc(dateText, format, true);
  // Parse using the user's locale, but serialize with ASCII digits for sync.
  return date.isValid() ? date.locale('en').format('YYYY-MM-DD') : null;
}
