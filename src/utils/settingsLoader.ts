import { CalDAVSettings, CalendarMapping, DEFAULT_CALDAV_SETTINGS } from '../types';

/** The two reads settings loading needs from the host plugin. */
export interface SettingsIO {
  loadData(): Promise<unknown>;
  dataFileExists(): Promise<boolean>;
}

/**
 * Load and resolve plugin settings. A null read while the data file exists on
 * disk is a failure (transient read race or corruption), not a fresh install —
 * it throws instead of silently yielding defaults, so a later save can never
 * clobber the stored configuration (#126).
 */
export async function loadSettingsFrom(io: SettingsIO): Promise<CalDAVSettings> {
  const loaded = await io.loadData();
  if (loaded == null && await io.dataFileExists()) {
    throw new Error('the settings file exists but could not be read');
  }
  return resolveSettings(loaded);
}

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
