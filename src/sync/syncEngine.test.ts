import { App } from 'obsidian';
import { SyncEngine } from './syncEngine';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from '../types';

// --- Helpers ---

function makeObsidianTask(overrides: Partial<any> = {}): any {
  return {
    description: 'Test task',
    status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
    isDone: false,
    priority: '0',
    tags: ['#sync'],
    taskLocation: { _tasksFile: { _path: 'Tasks.md' }, _lineNumber: 1 },
    originalMarkdown: '- [ ] Test task %%[id::20250101-abc]%% #sync',
    createdDate: null,
    startDate: null,
    scheduledDate: null,
    dueDate: null,
    doneDate: null,
    cancelledDate: null,
    recurrence: null,
    id: '20250101-abc',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<CalDAVSettings> = {}): CalDAVSettings {
  return {
    ...DEFAULT_CALDAV_SETTINGS,
    syncTag: 'sync',
    ...overrides,
  };
}

// --- Mocks ---

// Mock TaskManager
const mockGetAllTasks = jest.fn();
const mockEnsureTaskHasId = jest.fn().mockResolvedValue('mock-id');
const mockInitialize = jest.fn().mockResolvedValue(true);

jest.mock('../tasks/taskManager', () => ({
  TaskManager: jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    getAllTasks: mockGetAllTasks,
    ensureTaskHasId: mockEnsureTaskHasId,
    findTaskById: jest.fn().mockReturnValue(null),
  })),
}));

// Mock CalDAVClientDirect
jest.mock('../caldav/calDAVClientDirect', () => ({
  CalDAVClientDirect: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    fetchVTODOs: jest.fn().mockResolvedValue([]),
  })),
}));

// Mock SyncStorage
jest.mock('../storage/syncStorage', () => ({
  SyncStorage: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    getBaseline: jest.fn().mockReturnValue([]),
    getMapping: jest.fn().mockReturnValue({ tasks: {}, caldavToTask: {} }),
    getState: jest.fn().mockReturnValue({ lastSyncTime: '', conflicts: [] }),
    setBaseline: jest.fn(),
    updateLastSyncTime: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    addTaskMapping: jest.fn(),
    removeTaskMapping: jest.fn(),
  })),
}));

describe('SyncEngine', () => {
  let engine: SyncEngine;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sync tag filtering for ID injection', () => {
    it('should only inject IDs into tasks matching the sync tag', async () => {
      const syncedTask = makeObsidianTask({
        description: 'Synced task',
        tags: ['#sync'],
        id: '',
        originalMarkdown: '- [ ] Synced task #sync',
      });
      const unsyncedTask = makeObsidianTask({
        description: 'Unsynced task',
        tags: ['#work'],
        id: '',
        originalMarkdown: '- [ ] Unsynced task #work',
      });

      mockGetAllTasks.mockReturnValue([syncedTask, unsyncedTask]);

      engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      await engine.sync(true);

      // ensureTaskHasId should only be called for the #sync task
      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(1);
      expect(mockEnsureTaskHasId).toHaveBeenCalledWith(syncedTask);
    });

    it('should not inject IDs into any task when none match the sync tag', async () => {
      const task1 = makeObsidianTask({
        description: 'Work task',
        tags: ['#work'],
        originalMarkdown: '- [ ] Work task #work',
      });
      const task2 = makeObsidianTask({
        description: 'Personal task',
        tags: ['#personal'],
        originalMarkdown: '- [ ] Personal task #personal',
      });

      mockGetAllTasks.mockReturnValue([task1, task2]);

      engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      await engine.sync(true);

      expect(mockEnsureTaskHasId).not.toHaveBeenCalled();
    });

    it('should inject IDs into all tasks when sync tag is empty', async () => {
      const task1 = makeObsidianTask({
        description: 'Task A',
        tags: ['#work'],
        originalMarkdown: '- [ ] Task A #work',
      });
      const task2 = makeObsidianTask({
        description: 'Task B',
        tags: [],
        originalMarkdown: '- [ ] Task B',
      });

      mockGetAllTasks.mockReturnValue([task1, task2]);

      engine = new SyncEngine(new App(), makeSettings({ syncTag: '' }));
      await engine.initialize();
      await engine.sync(true);

      // No sync tag filter → all tasks get IDs
      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(2);
    });

    it('should match sync tag case-insensitively', async () => {
      const task = makeObsidianTask({
        description: 'Mixed case',
        tags: ['#Sync'],
        originalMarkdown: '- [ ] Mixed case #Sync',
      });

      mockGetAllTasks.mockReturnValue([task]);

      engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      await engine.sync(true);

      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(1);
      expect(mockEnsureTaskHasId).toHaveBeenCalledWith(task);
    });

    it('should handle sync tag with # prefix in settings', async () => {
      const task = makeObsidianTask({
        description: 'Tagged task',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Tagged task #sync',
      });

      mockGetAllTasks.mockReturnValue([task]);

      engine = new SyncEngine(new App(), makeSettings({ syncTag: '#sync' }));
      await engine.initialize();
      await engine.sync(true);

      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(1);
    });
  });

  describe('sync result includes input snapshots', () => {
    it('should include obsidian, caldav, and baseline tasks in dry run result', async () => {
      const task = makeObsidianTask({
        description: 'My task',
        tags: ['#sync'],
        id: '20250101-abc',
      });

      mockGetAllTasks.mockReturnValue([task]);

      engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.details.obsidianTasks).toBeDefined();
      expect(result.details.caldavTasks).toBeDefined();
      expect(result.details.baselineTasks).toBeDefined();
      expect(result.details.obsidianTasks!.length).toBe(1);
      expect(result.details.obsidianTasks![0].uid).toBe('20250101-abc');
      expect(result.details.caldavTasks).toEqual([]);
      expect(result.details.baselineTasks).toEqual([]);
    });
  });
});
