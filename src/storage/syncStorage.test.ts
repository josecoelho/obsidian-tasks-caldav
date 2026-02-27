import { App } from 'obsidian';
import { SyncStorage } from './syncStorage';
import { IdMapping, SyncState } from '../types';
import { CommonTask } from '../sync/types';

function makeCommonTask(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: 'task-001',
    title: 'Default task',
    status: 'TODO',
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: '',
    body: '',
    ...overrides,
  };
}

function createMockAdapter() {
  return {
    exists: jest.fn(),
    mkdir: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
  };
}

function createMockApp(adapter: ReturnType<typeof createMockAdapter>) {
  return {
    vault: { adapter },
  } as unknown as App;
}

/**
 * Configure the mock adapter so initialize() succeeds:
 * - directory and files don't exist (will be created)
 * - read returns valid JSON for state
 */
function setupFreshAdapter(adapter: ReturnType<typeof createMockAdapter>) {
  adapter.exists.mockImplementation(() => {
    return false;
  });
  adapter.mkdir.mockResolvedValue(undefined);
  adapter.write.mockResolvedValue(undefined);
  adapter.read.mockImplementation((path: string) => {
    if (path.includes('state.json')) {
      return JSON.stringify({ lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] });
    }
    throw new Error('File not found');
  });
}

/**
 * Configure the adapter as if files already exist on disk with given data.
 */
function setupExistingAdapter(
  adapter: ReturnType<typeof createMockAdapter>,
  opts: {
    state?: SyncState;
    baseline?: CommonTask[];
    idMapping?: IdMapping;
    oldMappingJson?: { tasks: Record<string, { caldavUID: string }> };
  } = {}
) {
  const state = opts.state ?? { lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] };
  const baseline = opts.baseline;
  const idMapping = opts.idMapping;
  const oldMappingJson = opts.oldMappingJson;

  adapter.exists.mockImplementation((path: string) => {
    if (path.includes('baseline.json')) return baseline !== undefined;
    if (path.includes('id-mapping.json')) return idMapping !== undefined;
    if (path.includes('mapping.json')) return oldMappingJson !== undefined;
    return true;
  });
  adapter.mkdir.mockResolvedValue(undefined);
  adapter.write.mockResolvedValue(undefined);
  adapter.read.mockImplementation((path: string) => {
    if (path.includes('id-mapping.json') && idMapping) return JSON.stringify(idMapping);
    if (path.includes('mapping.json') && oldMappingJson) return JSON.stringify(oldMappingJson);
    if (path.includes('state.json')) return JSON.stringify(state);
    if (path.includes('baseline.json') && baseline) return JSON.stringify(baseline);
    throw new Error('File not found');
  });
}

describe('SyncStorage', () => {
  let adapter: ReturnType<typeof createMockAdapter>;
  let storage: SyncStorage;

  beforeEach(() => {
    adapter = createMockAdapter();
    const app = createMockApp(adapter);
    storage = new SyncStorage(app);
  });

  describe('getState throws before initialize', () => {
    it('getState throws before initialize', () => {
      expect(() => storage.getState()).toThrow('SyncStorage not initialized');
    });
  });

  describe('initialize', () => {
    it('creates directory and state file when they do not exist', async () => {
      setupFreshAdapter(adapter);

      await storage.initialize();

      expect(adapter.exists).toHaveBeenCalled();
      expect(adapter.mkdir).toHaveBeenCalledWith(expect.stringContaining('.caldav-sync'));
      const writeCalls = adapter.write.mock.calls.map((c: unknown[]) => c[0]);
      expect(writeCalls.some((p: string) => p.includes('state.json'))).toBe(true);
    });

    it('does not create directory or files when they already exist', async () => {
      setupExistingAdapter(adapter);

      await storage.initialize();

      expect(adapter.mkdir).not.toHaveBeenCalled();
      expect(adapter.write).not.toHaveBeenCalled();
    });

    it('loads data into cache so getState works', async () => {
      const existingState: SyncState = {
        lastSyncTime: '2025-06-01T12:00:00.000Z',
        conflicts: [],
      };
      setupExistingAdapter(adapter, { state: existingState });

      await storage.initialize();

      expect(storage.getState()).toEqual(existingState);
    });
  });

  describe('save only writes dirty data', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      adapter.write.mockClear();
    });

    it('writes nothing when nothing has changed', async () => {
      await storage.save();

      expect(adapter.write).not.toHaveBeenCalled();
    });

    it('writes only state.json when only state changed', async () => {
      storage.updateLastSyncTime();

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('state.json');
    });

    it('writes only baseline.json when only baseline changed', async () => {
      storage.setBaseline([makeCommonTask()]);

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('baseline.json');
    });

    it('writes only id-mapping.json when only IdMapping changed', async () => {
      storage.setIdMapping({ taskIdToCaldavUid: { 'a': 'b' }, caldavUidToTaskId: { 'b': 'a' } });

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('id-mapping.json');
    });

    it('writes all files when all are dirty', async () => {
      storage.updateLastSyncTime();
      storage.setBaseline([makeCommonTask()]);
      storage.setIdMapping({ taskIdToCaldavUid: { 'a': 'b' }, caldavUidToTaskId: { 'b': 'a' } });

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(3);
      const paths = adapter.write.mock.calls.map((c: unknown[]) => c[0]);
      expect(paths.some((p: string) => p.includes('state.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('baseline.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('id-mapping.json'))).toBe(true);
    });

    it('clears dirty flags after save so second save writes nothing', async () => {
      storage.setIdMapping({ taskIdToCaldavUid: { 'a': 'b' }, caldavUidToTaskId: { 'b': 'a' } });

      await storage.save();
      adapter.write.mockClear();

      await storage.save();
      expect(adapter.write).not.toHaveBeenCalled();
    });
  });

  describe('updateLastSyncTime', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      adapter.write.mockClear();
    });

    it('updates the lastSyncTime in state', () => {
      const before = storage.getState().lastSyncTime;

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

      storage.updateLastSyncTime();

      const after = storage.getState().lastSyncTime;
      expect(after).toBe('2030-01-01T00:00:00.000Z');
      expect(after).not.toBe(before);

      jest.useRealTimers();
    });

    it('marks state as dirty', async () => {
      storage.updateLastSyncTime();

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('state.json');
    });
  });

  describe('setBaseline / getBaseline', () => {
    it('returns empty array before initialize', () => {
      expect(storage.getBaseline()).toEqual([]);
    });

    it('returns empty array after initialize when no baseline file exists', async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();

      expect(storage.getBaseline()).toEqual([]);
    });

    it('returns stored baseline after setBaseline', async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();

      const tasks = [makeCommonTask({ uid: 'a' }), makeCommonTask({ uid: 'b' })];
      storage.setBaseline(tasks);

      expect(storage.getBaseline()).toEqual(tasks);
    });

    it('marks baseline as dirty on setBaseline', async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      adapter.write.mockClear();

      storage.setBaseline([makeCommonTask()]);

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('baseline.json');
    });

    it('loads existing baseline from disk on initialize', async () => {
      const baseline = [makeCommonTask({ uid: 'persisted' })];
      setupExistingAdapter(adapter, { baseline });

      await storage.initialize();

      expect(storage.getBaseline()).toEqual(baseline);
    });
  });

  describe('baseline migration', () => {
    it('should default missing body field to empty string when loading baseline', async () => {
      const oldBaseline = [
        {
          uid: 'old-task',
          title: 'Task from old version',
          status: 'TODO',
          dueDate: null,
          startDate: null,
          scheduledDate: null,
          completedDate: null,
          priority: 'none',
          tags: [],
          recurrenceRule: '',
          // No `body` field
        },
      ];

      setupExistingAdapter(adapter, { baseline: oldBaseline as unknown as CommonTask[] });

      await storage.initialize();

      const baseline = storage.getBaseline();
      expect(baseline).toHaveLength(1);
      expect(baseline[0].body).toBe('');
    });
  });

  describe('getIdMapping / setIdMapping', () => {
    it('returns empty IdMapping before initialize', () => {
      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      });
    });

    it('returns empty IdMapping after initialize when no file exists', async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();

      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      });
    });

    it('persists and retrieves IdMapping', async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      adapter.write.mockClear();

      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'task-1': 'caldav-uid-1' },
        caldavUidToTaskId: { 'caldav-uid-1': 'task-1' },
      };
      storage.setIdMapping(idMapping);

      expect(storage.getIdMapping()).toEqual(idMapping);

      await storage.save();
      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect((adapter.write.mock.calls[0] as [string, string])[0]).toContain('id-mapping.json');
    });

    it('loads existing IdMapping from disk on initialize', async () => {
      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'task-1': 'cal-1' },
        caldavUidToTaskId: { 'cal-1': 'task-1' },
      };
      setupExistingAdapter(adapter, { idMapping });

      await storage.initialize();

      expect(storage.getIdMapping()).toEqual(idMapping);
    });
  });

  describe('migrateFromMappingJson', () => {
    it('should convert old mapping.json to IdMapping on initialize', async () => {
      const oldMapping = {
        tasks: {
          'task-1': { caldavUID: 'cal-1' },
          'task-2': { caldavUID: 'cal-2' },
        },
      };
      setupExistingAdapter(adapter, { oldMappingJson: oldMapping });

      await storage.initialize();

      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: { 'task-1': 'cal-1', 'task-2': 'cal-2' },
        caldavUidToTaskId: { 'cal-1': 'task-1', 'cal-2': 'task-2' },
      });
    });

    it('should skip migration when IdMapping already has entries', async () => {
      const oldMapping = {
        tasks: {
          'task-1': { caldavUID: 'cal-1' },
        },
      };
      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'existing': 'existing-cal' },
        caldavUidToTaskId: { 'existing-cal': 'existing' },
      };
      setupExistingAdapter(adapter, { oldMappingJson: oldMapping, idMapping });

      await storage.initialize();

      // Should keep existing, not overwrite with old mapping data
      expect(storage.getIdMapping()).toEqual(idMapping);
    });

    it('should skip migration when mapping.json does not exist', async () => {
      setupFreshAdapter(adapter);

      await storage.initialize();

      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      });
    });
  });

  describe('clearAll', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      storage.setBaseline([makeCommonTask()]);
      adapter.write.mockClear();
    });

    it('resets state with fresh lastSyncTime', async () => {
      await storage.clearAll();

      const state = storage.getState();
      expect(state.conflicts).toEqual([]);
      expect(state.lastSyncTime).toBeDefined();
    });

    it('resets baseline to empty array', async () => {
      await storage.clearAll();

      expect(storage.getBaseline()).toEqual([]);
    });

    it('resets IdMapping to empty', async () => {
      storage.setIdMapping({
        taskIdToCaldavUid: { 'task-1': 'cal-1' },
        caldavUidToTaskId: { 'cal-1': 'task-1' },
      });
      adapter.write.mockClear();

      await storage.clearAll();

      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      });
    });

    it('writes all three files', async () => {
      await storage.clearAll();

      expect(adapter.write).toHaveBeenCalledTimes(3);
      const paths = adapter.write.mock.calls.map((c: unknown[]) => c[0]);
      expect(paths.some((p: string) => p.includes('state.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('baseline.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('id-mapping.json'))).toBe(true);
    });
  });

  describe('error recovery', () => {
    it('returns default state when state.json is corrupted', async () => {
      adapter.exists.mockResolvedValue(true);
      adapter.write.mockResolvedValue(undefined);
      adapter.read.mockImplementation((path: string) => {
        if (path.includes('state.json')) return 'not valid json at all';
        throw new Error('File not found');
      });

      await storage.initialize();

      const state = storage.getState();
      expect(state.lastSyncTime).toBeDefined();
      expect(state.conflicts).toEqual([]);
    });

    it('returns empty baseline when baseline.json is corrupted', async () => {
      adapter.exists.mockResolvedValue(true);
      adapter.write.mockResolvedValue(undefined);
      adapter.read.mockImplementation((path: string) => {
        if (path.includes('state.json')) return JSON.stringify({ lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] });
        if (path.includes('baseline.json')) return '<<<corrupted>>>';
        throw new Error('File not found');
      });

      await storage.initialize();

      expect(storage.getBaseline()).toEqual([]);
    });

    it('returns empty IdMapping when id-mapping.json is corrupted', async () => {
      adapter.exists.mockResolvedValue(true);
      adapter.write.mockResolvedValue(undefined);
      adapter.read.mockImplementation((path: string) => {
        if (path.includes('id-mapping.json')) return '<<<corrupted>>>';
        if (path.includes('state.json')) return JSON.stringify({ lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] });
        throw new Error('File not found');
      });

      await storage.initialize();

      expect(storage.getIdMapping()).toEqual({
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      });
    });
  });
});
