import { CalendarMapping } from '../types';

/** Last non-empty path segment of a URL, used as a fallback calendar label. */
export function lastPathSegment(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const segment = trimmed.substring(trimmed.lastIndexOf('/') + 1);
  return segment || url;
}

/**
 * Human label for a calendar: its name when set, otherwise the calendar URL's
 * last path segment, otherwise the server URL. Empty only for a blank calendar.
 */
export function calendarLabel(calendar: CalendarMapping): string {
  if (calendar.calendarName.trim()) {
    return calendar.calendarName.trim();
  }
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) {
    return lastPathSegment(url);
  }
  return calendar.serverUrl.trim();
}
