import { CalendarMapping } from '../types';

/** Calendar fields that must be set before a sync can be attempted, in display order. */
const REQUIRED_FIELDS: ReadonlyArray<{ key: keyof CalendarMapping; label: string }> = [
  { key: 'serverUrl', label: 'server URL' },
  { key: 'username', label: 'username' },
  { key: 'calendarName', label: 'calendar name' },
];

/** Labels of required fields that are empty (or whitespace-only). Empty array when fully configured. */
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  return REQUIRED_FIELDS
    .filter(({ key }) => calendar[key].trim() === '')
    .map(({ label }) => label);
}

/** True when a calendar has every field required to attempt a sync. */
export function isCalendarConfigured(calendar: CalendarMapping): boolean {
  return missingCalendarFields(calendar).length === 0;
}

/**
 * Human-readable reason a calendar can't sync, or null when it is fully configured.
 * Names the calendar by its name, falling back to its server URL, then its position.
 */
export function describeIncompleteCalendar(calendar: CalendarMapping, index: number): string | null {
  const missing = missingCalendarFields(calendar);
  if (missing.length === 0) {
    return null;
  }
  const name = calendar.calendarName.trim() || calendar.serverUrl.trim() || `Calendar ${index + 1}`;
  return `${name} (missing ${missing.join(', ')})`;
}
