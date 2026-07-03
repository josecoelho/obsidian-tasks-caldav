import { CalendarMapping } from '../types';

/** Filesystem-safe, human-readable slug from an arbitrary string. */
function sanitizeStorageId(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Deterministic storage directory ID from server URL + calendar name.
 * Retained for the legacy storage scheme (and migration 002).
 */
export function calendarStorageId(serverUrl: string, calendarName: string): string {
  return sanitizeStorageId(`${serverUrl}_${calendarName}`);
}

/**
 * Storage directory ID for a calendar mapping. A legacy (or legacy-adopter)
 * calendar keeps its original serverUrl+calendarName key so its baseline is
 * never orphaned; a URL-pinned calendar keys off its unique collection URL.
 */
export function storageIdForCalendar(calendar: CalendarMapping): string {
  if (calendar.serverUrl.trim() && calendar.calendarName.trim()) {
    return calendarStorageId(calendar.serverUrl, calendar.calendarName);
  }
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) {
    return sanitizeStorageId(url);
  }
  return calendarStorageId(calendar.serverUrl, calendar.calendarName);
}
