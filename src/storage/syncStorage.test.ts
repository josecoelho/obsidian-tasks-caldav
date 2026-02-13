import { SyncStorage } from './syncStorage';
import { MappingData, SyncState, TaskMapping } from '../types';
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
    notes: '',
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
  } as any;
}

/**
 * Configure the mock adapter so initialize() succeeds:
 * - directory and files don't exist (will be created)
 * - read returns valid JSON for mapping and state, baseline doesn't exist
 */
function setupFreshAdapter(adapter: ReturnType<typeof createMockAdapter>) {
  adapter.exists.mockImplementation(async (path: string) => {
    return false; // nothing exists yet
  });
  adapter.mkdir.mockResolvedValue(undefined);
  adapter.write.mockResolvedValue(undefined);
  // After initialize writes the files, loadIntoCache reads them back.
  // The read calls happen for mapping, state, and baseline.
  // mapping.json and state.json are read; baseline.json check via exists returns false.
  adapter.read.mockImplementation(async (path: string) => {
    if (path.includes('mapping.json')) {
      return JSON.stringify({ tasks: {}, caldavToTask: {} });
    }
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
    mapping?: MappingData;
    state?: SyncState;
    baseline?: CommonTask[];
  } = {}
) {
  const mapping = opts.mapping ?? { tasks: {}, caldavToTask: {} };
  const state = opts.state ?? { lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] };
  const baseline = opts.baseline;

  adapter.exists.mockImplementation(async (path: string) => {
    if (path.includes('baseline.json')) return baseline !== undefined;
    return true; // dir, mapping.json, state.json all exist
  });
  adapter.mkdir.mockResolvedValue(undefined);
  adapter.write.mockResolvedValue(undefined);
  adapter.read.mockImplementation(async (path: string) => {
    if (path.includes('mapping.json')) return JSON.stringify(mapping);
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

  describe('getMapping/getState throw before initialize', () => {
    it('getMapping throws before initialize', () => {
      expect(() => storage.getMapping()).toThrow('SyncStorage not initialized');
    });

    it('getState throws before initialize', () => {
      expect(() => storage.getState()).toThrow('SyncStorage not initialized');
    });
  });

  describe('initialize', () => {
    it('creates directory and files when they do not exist', async () => {
      setupFreshAdapter(adapter);

      await storage.initialize();

      // Should check existence of dir, mapping, state, baseline
      expect(adapter.exists).toHaveBeenCalled();
      // Should create directory
      expect(adapter.mkdir).toHaveBeenCalledWith(expect.stringContaining('.caldav-sync'));
      // Should write initial mapping.json and state.json
      const writeCalls = adapter.write.mock.calls.map((c: any[]) => c[0]);
      expect(writeCalls.some((p: string) => p.includes('mapping.json'))).toBe(true);
      expect(writeCalls.some((p: string) => p.includes('state.json'))).toBe(true);
    });

    it('does not create directory or files when they already exist', async () => {
      setupExistingAdapter(adapter);

      await storage.initialize();

      expect(adapter.mkdir).not.toHaveBeenCalled();
      // No writes during initialize when files exist
      expect(adapter.write).not.toHaveBeenCalled();
    });

    it('loads data into cache so getMapping/getState work', async () => {
      const existingMapping: MappingData = {
        tasks: { 'task-1': { caldavUID: 'uid-1', sourceFile: 'test.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'uid-1': 'task-1' },
      };
      const existingState: SyncState = {
        lastSyncTime: '2025-06-01T12:00:00.000Z',
        conflicts: [],
      };
      setupExistingAdapter(adapter, { mapping: existingMapping, state: existingState });

      await storage.initialize();

      expect(storage.getMapping()).toEqual(existingMapping);
      expect(storage.getState()).toEqual(existingState);
    });
  });

  describe('addTaskMapping', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      adapter.write.mockClear();
    });

    it('adds entry to both tasks and caldavToTask maps', () => {
      storage.addTaskMapping('task-1', 'uid-1', 'notes/test.md');

      const mapping = storage.getMapping();
      expect(mapping.tasks['task-1']).toBeDefined();
      expect(mapping.tasks['task-1'].caldavUID).toBe('uid-1');
      expect(mapping.tasks['task-1'].sourceFile).toBe('notes/test.md');
      expect(mapping.caldavToTask['uid-1']).toBe('task-1');
    });

    it('sets dirty flag so save writes mapping', async () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');

      await storage.save();

      // Only mapping.json should be written (not state.json or baseline.json)
      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('mapping.json');
    });
  });

  describe('removeTaskMapping', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      adapter.write.mockClear();
    });

    it('removes from both tasks and caldavToTask maps', () => {
      storage.removeTaskMapping('task-1');

      const mapping = storage.getMapping();
      expect(mapping.tasks['task-1']).toBeUndefined();
      expect(mapping.caldavToTask['uid-1']).toBeUndefined();
    });

    it('sets dirty flag so save writes mapping', async () => {
      storage.removeTaskMapping('task-1');

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('mapping.json');
    });

    it('does nothing for non-existent task', () => {
      storage.removeTaskMapping('non-existent');

      const mapping = storage.getMapping();
      // Original task still present
      expect(mapping.tasks['task-1']).toBeDefined();
    });
  });

  describe('bidirectional consistency', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
    });

    it('after add, both lookup directions return correct values', () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');

      expect(storage.getTaskIdFromCalDAV('uid-1')).toBe('task-1');
      expect(storage.getCalDAVFromTaskId('task-1')).toBe('uid-1');
    });

    it('after remove, both lookup directions return undefined', () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      storage.removeTaskMapping('task-1');

      expect(storage.getTaskIdFromCalDAV('uid-1')).toBeUndefined();
      expect(storage.getCalDAVFromTaskId('task-1')).toBeUndefined();
    });
  });

  describe('isTaskTracked / isCalDAVTracked', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
    });

    it('returns false for untracked IDs', () => {
      expect(storage.isTaskTracked('task-1')).toBe(false);
      expect(storage.isCalDAVTracked('uid-1')).toBe(false);
    });

    it('returns true after adding a mapping', () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');

      expect(storage.isTaskTracked('task-1')).toBe(true);
      expect(storage.isCalDAVTracked('uid-1')).toBe(true);
    });

    it('returns false after removing a mapping', () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      storage.removeTaskMapping('task-1');

      expect(storage.isTaskTracked('task-1')).toBe(false);
      expect(storage.isCalDAVTracked('uid-1')).toBe(false);
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

    it('writes only mapping.json when only mapping changed', async () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('mapping.json');
    });

    it('writes only state.json when only state changed', async () => {
      storage.updateLastSyncTime();

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('state.json');
    });

    it('writes only baseline.json when only baseline changed', async () => {
      storage.setBaseline([makeCommonTask()]);

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('baseline.json');
    });

    it('writes all files when all are dirty', async () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      storage.updateLastSyncTime();
      storage.setBaseline([makeCommonTask()]);

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(3);
      const paths = adapter.write.mock.calls.map((c: any[]) => c[0]);
      expect(paths.some((p: string) => p.includes('mapping.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('state.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('baseline.json'))).toBe(true);
    });

    it('clears dirty flags after save so second save writes nothing', async () => {
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');

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

      // Advance time slightly to guarantee difference
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
      expect(adapter.write.mock.calls[0][0]).toContain('state.json');
    });
  });

  describe('updateCalDAVTimestamp', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      await storage.save(); // flush dirty flags
      adapter.write.mockClear();
    });

    it('updates lastModifiedCalDAV and lastSyncedCalDAV', () => {
      storage.updateCalDAVTimestamp('task-1', '2025-07-01T10:00:00.000Z');

      const taskMapping = storage.getTaskMapping('task-1');
      expect(taskMapping?.lastModifiedCalDAV).toBe('2025-07-01T10:00:00.000Z');
      expect(taskMapping?.lastSyncedCalDAV).toBeDefined();
    });

    it('marks mapping as dirty', async () => {
      storage.updateCalDAVTimestamp('task-1', '2025-07-01T10:00:00.000Z');

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('mapping.json');
    });

    it('does nothing for non-existent task', async () => {
      storage.updateCalDAVTimestamp('non-existent', '2025-07-01T10:00:00.000Z');

      await storage.save();

      // mapping was already dirty from addTaskMapping in beforeEach,
      // but we cleared write mock. The updateCalDAVTimestamp for a
      // non-existent task should not set dirty again.
      expect(adapter.write).not.toHaveBeenCalled();
    });
  });

  describe('updateObsidianTimestamp', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      await storage.save(); // flush dirty flags
      adapter.write.mockClear();
    });

    it('updates lastModifiedObsidian and lastSyncedObsidian', () => {
      storage.updateObsidianTimestamp('task-1', '2025-07-02T14:00:00.000Z');

      const taskMapping = storage.getTaskMapping('task-1');
      expect(taskMapping?.lastModifiedObsidian).toBe('2025-07-02T14:00:00.000Z');
      expect(taskMapping?.lastSyncedObsidian).toBeDefined();
    });

    it('marks mapping as dirty', async () => {
      storage.updateObsidianTimestamp('task-1', '2025-07-02T14:00:00.000Z');

      await storage.save();

      expect(adapter.write).toHaveBeenCalledTimes(1);
      expect(adapter.write.mock.calls[0][0]).toContain('mapping.json');
    });

    it('does nothing for non-existent task', async () => {
      storage.updateObsidianTimestamp('non-existent', '2025-07-02T14:00:00.000Z');

      await storage.save();

      expect(adapter.write).not.toHaveBeenCalled();
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
      expect(adapter.write.mock.calls[0][0]).toContain('baseline.json');
    });

    it('loads existing baseline from disk on initialize', async () => {
      const baseline = [makeCommonTask({ uid: 'persisted' })];
      setupExistingAdapter(adapter, { baseline });

      await storage.initialize();

      expect(storage.getBaseline()).toEqual(baseline);
    });
  });

  describe('baseline migration', () => {
    it('should default missing notes field to empty string when loading baseline', async () => {
      // Simulate a baseline saved by older code without the `notes` field
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
          // No `notes` field
        },
      ];

      setupExistingAdapter(adapter, { baseline: oldBaseline as any });

      await storage.initialize();

      const baseline = storage.getBaseline();
      expect(baseline).toHaveLength(1);
      expect(baseline[0].notes).toBe('');
    });
  });

  describe('clearAll', () => {
    beforeEach(async () => {
      setupFreshAdapter(adapter);
      await storage.initialize();
      storage.addTaskMapping('task-1', 'uid-1', 'test.md');
      storage.setBaseline([makeCommonTask()]);
      adapter.write.mockClear();
    });

    it('resets mapping to empty', async () => {
      await storage.clearAll();

      const mapping = storage.getMapping();
      expect(mapping.tasks).toEqual({});
      expect(mapping.caldavToTask).toEqual({});
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

    it('writes all three files', async () => {
      await storage.clearAll();

      expect(adapter.write).toHaveBeenCalledTimes(3);
      const paths = adapter.write.mock.calls.map((c: any[]) => c[0]);
      expect(paths.some((p: string) => p.includes('mapping.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('state.json'))).toBe(true);
      expect(paths.some((p: string) => p.includes('baseline.json'))).toBe(true);
    });
  });

  describe('error recovery', () => {
    it('returns default mapping when mapping.json is corrupted', async () => {
      adapter.exists.mockResolvedValue(true);
      adapter.write.mockResolvedValue(undefined);
      adapter.read.mockImplementation(async (path: string) => {
        if (path.includes('mapping.json')) return '{invalid json!!!';
        if (path.includes('state.json')) return JSON.stringify({ lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] });
        throw new Error('File not found');
      });

      await storage.initialize();

      const mapping = storage.getMapping();
      expect(mapping.tasks).toEqual({});
      expect(mapping.caldavToTask).toEqual({});
    });

    it('returns default state when state.json is corrupted', async () => {
      adapter.exists.mockResolvedValue(true);
      adapter.write.mockResolvedValue(undefined);
      adapter.read.mockImplementation(async (path: string) => {
        if (path.includes('mapping.json')) return JSON.stringify({ tasks: {}, caldavToTask: {} });
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
      adapter.read.mockImplementation(async (path: string) => {
        if (path.includes('mapping.json')) return JSON.stringify({ tasks: {}, caldavToTask: {} });
        if (path.includes('state.json')) return JSON.stringify({ lastSyncTime: '2025-01-01T00:00:00.000Z', conflicts: [] });
        if (path.includes('baseline.json')) return '<<<corrupted>>>';
        throw new Error('File not found');
      });

      await storage.initialize();

      expect(storage.getBaseline()).toEqual([]);
    });
  });
});
