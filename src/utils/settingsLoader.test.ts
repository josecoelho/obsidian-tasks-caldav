import { loadSettingsFrom, resolveSettings, SettingsIO } from './settingsLoader';
import { DEFAULT_CALDAV_SETTINGS } from '../types';

function io(overrides: Partial<SettingsIO>): SettingsIO {
  return {
    loadData: () => Promise.resolve(null),
    dataFileExists: () => Promise.resolve(false),
    ...overrides,
  };
}

describe('loadSettingsFrom', () => {
  it('returns defaults when no data file exists', async () => {
    const settings = await loadSettingsFrom(io({}));
    expect(settings).toEqual(DEFAULT_CALDAV_SETTINGS);
  });

  it('throws when the data file exists but reads null', async () => {
    const failing = io({ dataFileExists: () => Promise.resolve(true) });
    await expect(loadSettingsFrom(failing)).rejects.toThrow('could not be read');
  });

  it('resolves loaded data without checking the file when the read succeeds', async () => {
    const dataFileExists = jest.fn().mockResolvedValue(true);
    const settings = await loadSettingsFrom(io({
      loadData: () => Promise.resolve({ syncInterval: 30 }),
      dataFileExists,
    }));
    expect(settings.syncInterval).toBe(30);
    expect(dataFileExists).not.toHaveBeenCalled();
  });
});

describe('resolveSettings', () => {
  it('returns defaults for null (fresh install)', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_CALDAV_SETTINGS);
  });

  it('returns defaults for undefined', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_CALDAV_SETTINGS);
  });

  it('returns defaults for non-object garbage', () => {
    expect(resolveSettings('corrupt')).toEqual(DEFAULT_CALDAV_SETTINGS);
    expect(resolveSettings(42)).toEqual(DEFAULT_CALDAV_SETTINGS);
    expect(resolveSettings([1, 2, 3])).toEqual(DEFAULT_CALDAV_SETTINGS);
  });

  it('merges stored settings over defaults', () => {
    const resolved = resolveSettings({ syncInterval: 15 });
    expect(resolved.syncInterval).toBe(15);
    expect(resolved.newTasksDestination).toBe(DEFAULT_CALDAV_SETTINGS.newTasksDestination);
  });

  it('preserves an existing calendars array untouched', () => {
    const calendars = [{
      obsidianTag: 'work',
      caldavCategory: 'work',
      calendarName: 'Work',
      serverUrl: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
    }];
    const resolved = resolveSettings({ calendars });
    expect(resolved.calendars).toEqual(calendars);
  });

  it('replaces a non-array calendars value with defaults', () => {
    const resolved = resolveSettings({ calendars: 'garbage' });
    expect(resolved.calendars).toEqual([]);
  });

  it('lifts a pre-array flat config into calendars[0] with legacy tag intact', () => {
    const resolved = resolveSettings({
      serverUrl: 'https://dav.example.com',
      calendarName: 'Personal',
      username: 'me',
      password: 'secret',
      syncTag: 'todo',
    });
    expect(resolved.calendars).toHaveLength(1);
    expect(resolved.calendars[0]).toMatchObject({
      tag: 'todo',
      calendarName: 'Personal',
      serverUrl: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
    });
  });

  it('defaults the legacy tag to sync when absent', () => {
    const resolved = resolveSettings({ serverUrl: 'https://dav.example.com' });
    expect(resolved.calendars[0]).toMatchObject({ tag: 'sync' });
  });

  it('lifts the flat config when the stored calendars value is corrupt', () => {
    const resolved = resolveSettings({
      serverUrl: 'https://dav.example.com',
      calendars: 'garbage',
    });
    expect(resolved.calendars).toHaveLength(1);
    expect(resolved.calendars[0]).toMatchObject({ serverUrl: 'https://dav.example.com' });
  });

  it('does not lift the flat config when calendars is already present', () => {
    const resolved = resolveSettings({
      serverUrl: 'https://dav.example.com',
      calendars: [],
    });
    expect(resolved.calendars).toEqual([]);
  });
});
