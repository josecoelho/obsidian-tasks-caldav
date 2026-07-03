import { CalDAVSettings, CalendarMapping, DEFAULT_CALDAV_SETTINGS } from '../types';

/**
 * Resolve persisted plugin data into usable settings without ever throwing.
 * Null or garbage input yields fresh defaults, a stored object merges over
 * defaults, and a pre-calendars-array flat config is lifted into
 * `calendars[0]` with its legacy `tag` field intact (migration 003 owns the
 * tag→obsidianTag/caldavCategory split).
 */
export function resolveSettings(loaded: unknown): CalDAVSettings {
  const data = isPlainObject(loaded) ? loaded : {};
  const settings = { ...DEFAULT_CALDAV_SETTINGS, ...data } as CalDAVSettings;
  settings.calendars = Array.isArray(data.calendars)
    ? (data.calendars as CalendarMapping[])
    : data.serverUrl
      ? [liftLegacyCalendar(data)]
      : [];
  return settings;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function liftLegacyCalendar(legacy: Record<string, unknown>): CalendarMapping {
  return {
    tag: (legacy.syncTag as string) ?? 'sync',
    calendarName: (legacy.calendarName as string) ?? '',
    serverUrl: (legacy.serverUrl as string) ?? '',
    username: (legacy.username as string) ?? '',
    password: (legacy.password as string) ?? '',
  } as unknown as CalendarMapping;
}
