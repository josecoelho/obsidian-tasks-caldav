import { CalendarMapping } from '../types';
import { calendarLabel } from './calendarLabel';

/**
 * Labels of required fields that are missing. A calendar can sync when it has a
 * username and either a calendar URL or a legacy serverUrl + calendarName pair.
 */
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  const missing: string[] = [];
  const hasUrl = (calendar.calendarUrl ?? '').trim() !== '';
  const hasLegacy = calendar.serverUrl.trim() !== '' && calendar.calendarName.trim() !== '';
  if (!hasUrl && !hasLegacy) {
    missing.push('calendar URL');
  }
  if (calendar.username.trim() === '') {
    missing.push('username');
  }
  return missing;
}

/** True when a calendar has every field required to attempt a sync. */
export function isCalendarConfigured(calendar: CalendarMapping): boolean {
  return missingCalendarFields(calendar).length === 0;
}

/**
 * Human-readable reason a calendar can't sync, or null when it is fully
 * configured. Names the calendar via {@link calendarLabel}, falling back to its
 * position.
 */
export function describeIncompleteCalendar(calendar: CalendarMapping, index: number): string | null {
  const missing = missingCalendarFields(calendar);
  if (missing.length === 0) {
    return null;
  }
  const name = calendarLabel(calendar) || `Calendar ${index + 1}`;
  return `${name} (missing ${missing.join(', ')})`;
}
