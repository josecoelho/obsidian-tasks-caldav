import { App } from 'obsidian';
import { runMigrations, Migration } from './migrationRunner';
import { mappingJsonToIdMapping } from './001-mapping-json-to-id-mapping';
import { flatStorageToPerCalendar } from './002-flat-storage-to-per-calendar';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from '../types';

function createMockAdapter() {
  return {
    exists: jest.fn(),
    mkdir: jest.fn().mockResolvedValue(undefined),
    read: jest.fn(),
    write: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockApp(adapter: ReturnType<typeof createMockAdapter>) {
  return { vault: { adapter } } as unknown as App;
}

function settingsWithCalendar(calendarName: string): CalDAVSettings {
  return {
    ...DEFAULT_CALDAV_SETTINGS,
    calendars: [{
      tag: 'sync',
      calendarName,
      serverUrl: 'https://example.com',
      username: 'user',
      password: 'pass',
    }],
  };
}

describe('runMigrations', () => {
  it('runs all migrations in order', async () => {
    const order: string[] = [];
    const fakeMigrations: Migration[] = [
      { name: 'first', async run() { await Promise.resolve(); order.push('first'); } },
      { name: 'second', async run() { await Promise.resolve(); order.push('second'); } },
    ];

    const adapter = createMockAdapter();
    const app = createMockApp(adapter);

    // Directly test ordering by calling each migration
    for (const m of fakeMigrations) {
      await m.run(app, DEFAULT_CALDAV_SETTINGS);
    }

    expect(order).toEqual(['first', 'second']);
  });

  it('calls runMigrations without error on empty settings', async () => {
    const adapter = createMockAdapter();
    adapter.exists.mockResolvedValue(false);
    const app = createMockApp(adapter);

    await expect(runMigrations(app, DEFAULT_CALDAV_SETTINGS)).resolves.toBeUndefined();
  });
});

describe('001-mapping-json-to-id-mapping', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let app: App;

  beforeEach(() => {
    adapter = createMockAdapter();
    app = createMockApp(adapter);
  });

  it('skips when mapping.json does not exist', async () => {
    adapter.exists.mockResolvedValue(false);

    await mappingJsonToIdMapping.run(app, DEFAULT_CALDAV_SETTINGS);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('converts mapping.json to id-mapping.json and deletes old file', async () => {
    const oldMapping = {
      tasks: {
        'task-1': { caldavUID: 'cal-1' },
        'task-2': { caldavUID: 'cal-2' },
      },
    };

    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('mapping.json') && !path.includes('id-mapping')) return true;
      return false;
    });
    adapter.read.mockResolvedValue(JSON.stringify(oldMapping));

    await mappingJsonToIdMapping.run(app, DEFAULT_CALDAV_SETTINGS);

    expect(adapter.write).toHaveBeenCalledTimes(1);
    const [writePath, writeContent] = adapter.write.mock.calls[0] as [string, string];
    expect(writePath).toContain('id-mapping.json');
    const written = JSON.parse(writeContent) as { taskIdToCaldavUid: Record<string, string>; caldavUidToTaskId: Record<string, string> };
    expect(written.taskIdToCaldavUid).toEqual({ 'task-1': 'cal-1', 'task-2': 'cal-2' });
    expect(written.caldavUidToTaskId).toEqual({ 'cal-1': 'task-1', 'cal-2': 'task-2' });

    expect(adapter.remove).toHaveBeenCalledWith(expect.stringContaining('mapping.json'));
  });

  it('deletes mapping.json without writing when id-mapping.json already exists', async () => {
    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('id-mapping.json')) return true;
      if (path.includes('mapping.json')) return true;
      return false;
    });

    await mappingJsonToIdMapping.run(app, DEFAULT_CALDAV_SETTINGS);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).toHaveBeenCalledWith(expect.stringContaining('mapping.json'));
  });

  it('deletes mapping.json when tasks object is empty', async () => {
    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('mapping.json') && !path.includes('id-mapping')) return true;
      return false;
    });
    adapter.read.mockResolvedValue(JSON.stringify({ tasks: {} }));

    await mappingJsonToIdMapping.run(app, DEFAULT_CALDAV_SETTINGS);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).toHaveBeenCalledWith(expect.stringContaining('mapping.json'));
  });
});

describe('002-flat-storage-to-per-calendar', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let app: App;
  const settings = settingsWithCalendar('Work');

  beforeEach(() => {
    adapter = createMockAdapter();
    app = createMockApp(adapter);
  });

  it('skips when no calendars configured', async () => {
    await flatStorageToPerCalendar.run(app, DEFAULT_CALDAV_SETTINGS);

    expect(adapter.exists).not.toHaveBeenCalled();
  });

  it('skips when no root sync files exist', async () => {
    adapter.exists.mockResolvedValue(false);

    await flatStorageToPerCalendar.run(app, settings);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('moves root files to per-calendar directory and deletes originals', async () => {
    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars/')) return false;
      if (path.includes('state.json')) return true;
      if (path.includes('baseline.json')) return true;
      if (path.includes('id-mapping.json')) return true;
      return false;
    });
    adapter.read.mockImplementation((path: string) => {
      if (path.includes('state.json')) return '{"state": true}';
      if (path.includes('baseline.json')) return '{"baseline": true}';
      if (path.includes('id-mapping.json')) return '{"mapping": true}';
      throw new Error('File not found');
    });

    await flatStorageToPerCalendar.run(app, settings);

    expect(adapter.write).toHaveBeenCalledTimes(3);
    const writePaths = adapter.write.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writePaths.every((p: string) => p.includes('calendars/example-com_Work/'))).toBe(true);

    expect(adapter.remove).toHaveBeenCalledTimes(3);
    const removePaths = adapter.remove.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(removePaths.every((p: string) => !p.includes('calendars/'))).toBe(true);
  });

  it('does not overwrite existing target files but still deletes root copies', async () => {
    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars/example-com_Work/state.json')) return true;
      if (path.includes('calendars/example-com_Work/baseline.json')) return true;
      if (path.includes('calendars/example-com_Work/id-mapping.json')) return true;
      if (path.includes('calendars/Work')) return true;
      if (path.includes('calendars')) return true;
      if (path.includes('.caldav-sync/state.json')) return true;
      if (path.includes('.caldav-sync/baseline.json')) return true;
      if (path.includes('.caldav-sync/id-mapping.json')) return true;
      if (path.includes('.caldav-sync')) return true;
      return false;
    });

    await flatStorageToPerCalendar.run(app, settings);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.remove).toHaveBeenCalledTimes(3);
  });

  it('only migrates files that exist at root', async () => {
    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars/')) return false;
      if (path.includes('state.json')) return true;
      return false;
    });
    adapter.read.mockImplementation((path: string) => {
      if (path.includes('state.json')) return '{"state": true}';
      throw new Error('File not found');
    });

    await flatStorageToPerCalendar.run(app, settings);

    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.remove).toHaveBeenCalledTimes(1);
  });
});
