import { App } from 'obsidian';
import { CalDAVSettings } from '../types';
import { resolveSettings } from '../utils/settingsLoader';
import { runMigrations } from './migrationRunner';

/**
 * Settings evolution: the exact data.json each released version wrote, loaded
 * and migrated to the latest shape. Every test reads as old file → latest
 * settings, so a migration regression for any historical install is caught
 * here. Storage-file migrations (001/002) are exercised in
 * migrationRunner.test.ts; this file cares only about the settings shape.
 */

const ALL_MIGRATIONS = [
  '001-mapping-json-to-id-mapping',
  '002-flat-storage-to-per-calendar',
  '003-tag-to-obsidian-tag-and-caldav-category',
];

async function loadAndMigrate(historicalDataJson: unknown): Promise<{
  settings: CalDAVSettings;
  migrated: boolean;
}> {
  const noStorageFiles = {
    vault: { adapter: { exists: () => Promise.resolve(false) } },
  } as unknown as App;
  const settings = resolveSettings(historicalDataJson);
  const migrated = await runMigrations(noStorageFiles, settings);
  return { settings, migrated };
}

describe('settings evolution: historical data.json → latest shape', () => {
  it('v1.0 flat single-calendar file', async () => {
    const v1_0_dataJson = {
      serverUrl: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      calendarName: 'Personal',
      syncTag: 'todo',
      syncInterval: 10,
      newTasksDestination: 'Tasks/Inbox.md',
      requireManualConflictResolution: true,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'ask',
    };

    const { settings, migrated } = await loadAndMigrate(v1_0_dataJson);

    expect(migrated).toBe(true);
    expect(settings).toEqual({
      calendars: [{
        obsidianTag: 'todo',
        caldavCategory: 'todo',
        calendarName: 'Personal',
        serverUrl: 'https://dav.example.com',
        username: 'me',
        password: 'secret',
      }],
      syncInterval: 10,
      newTasksDestination: 'Tasks/Inbox.md',
      newTasksSection: undefined,
      requireManualConflictResolution: true,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'ask',
      includeObsidianLink: false,
      showAutoSyncNotifications: false,
      appliedMigrations: ALL_MIGRATIONS,
      // Superseded flat fields ride along at the top level untouched.
      serverUrl: 'https://dav.example.com',
      username: 'me',
      password: 'secret',
      calendarName: 'Personal',
      syncTag: 'todo',
    });
  });

  it('v1.2 calendars array with the single tag field', async () => {
    const v1_2_dataJson = {
      calendars: [
        {
          tag: 'work',
          calendarName: 'Work',
          serverUrl: 'https://dav.example.com',
          username: 'me',
          password: 'secret',
        },
        {
          tag: 'home',
          calendarName: 'Home',
          serverUrl: 'https://dav.example.com',
          username: 'me',
          password: 'secret',
        },
      ],
      syncInterval: 5,
      newTasksDestination: 'Inbox.md',
      requireManualConflictResolution: true,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'keepBoth',
      includeObsidianLink: true,
      showAutoSyncNotifications: false,
    };

    const { settings, migrated } = await loadAndMigrate(v1_2_dataJson);

    expect(migrated).toBe(true);
    expect(settings).toEqual({
      calendars: [
        {
          obsidianTag: 'work',
          caldavCategory: 'work',
          calendarName: 'Work',
          serverUrl: 'https://dav.example.com',
          username: 'me',
          password: 'secret',
        },
        {
          obsidianTag: 'home',
          caldavCategory: 'home',
          calendarName: 'Home',
          serverUrl: 'https://dav.example.com',
          username: 'me',
          password: 'secret',
        },
      ],
      syncInterval: 5,
      newTasksDestination: 'Inbox.md',
      newTasksSection: undefined,
      requireManualConflictResolution: true,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'keepBoth',
      includeObsidianLink: true,
      showAutoSyncNotifications: false,
      appliedMigrations: ALL_MIGRATIONS,
    });
  });

  it('v1.3 already-migrated file passes through unchanged', async () => {
    const v1_3_dataJson = {
      calendars: [{
        obsidianTag: 'sync',
        caldavCategory: 'sync',
        calendarName: 'Personal',
        serverUrl: 'https://dav.example.com',
        username: 'me',
        password: 'secret',
      }],
      syncInterval: 5,
      newTasksDestination: 'Inbox.md',
      requireManualConflictResolution: true,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'ask',
      includeObsidianLink: false,
      showAutoSyncNotifications: false,
      appliedMigrations: ALL_MIGRATIONS,
    };

    const { settings, migrated } = await loadAndMigrate(v1_3_dataJson);

    expect(migrated).toBe(false);
    expect(settings).toEqual({ ...v1_3_dataJson, newTasksSection: undefined });
  });

  it('v1.4 URL-pinned file with sync direction passes through unchanged', async () => {
    const v1_4_dataJson = {
      calendars: [{
        obsidianTag: 'sync',
        caldavCategory: 'sync',
        calendarName: '',
        serverUrl: '',
        username: 'me',
        password: 'secret',
        calendarUrl: 'https://dav.example.com/calendars/me/personal/',
        syncDirection: 'pull',
      }],
      syncInterval: 15,
      newTasksDestination: 'Inbox.md',
      newTasksSection: 'Tasks',
      requireManualConflictResolution: false,
      autoResolveObsidianWins: true,
      syncCompletedTasks: true,
      deleteBehavior: 'deleteObsidian',
      includeObsidianLink: true,
      showAutoSyncNotifications: true,
      appliedMigrations: ALL_MIGRATIONS,
    };

    const { settings, migrated } = await loadAndMigrate(v1_4_dataJson);

    expect(migrated).toBe(false);
    expect(settings).toEqual(v1_4_dataJson);
  });
});
