import { App } from 'obsidian';
import { SyncEngine } from './syncEngine';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from '../types';
import { CalendarObject } from '../caldav/vtodoMapper';

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

function buildVTODO(uid: string, summary: string, extra: string[] = []): string {
  const hasStatus = extra.some(l => l.startsWith('STATUS:'));
  const hasPriority = extra.some(l => l.startsWith('PRIORITY:'));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20250101T000000Z',
    `SUMMARY:${summary}`,
    ...(hasStatus ? [] : ['STATUS:NEEDS-ACTION']),
    ...(hasPriority ? [] : ['PRIORITY:0']),
    ...extra,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeCalObj(uid: string, summary: string, extra: string[] = []): CalendarObject {
  return {
    data: buildVTODO(uid, summary, extra),
    url: `http://example.com/${uid}.ics`,
    etag: `etag-${uid}`,
  };
}

// --- Mocks ---

// All mock fns are declared at module level so jest.mock() can reference them,
// but each test can reconfigure via mockReturnValue / mockImplementation.

const mockTaskManagerInitialize = jest.fn().mockResolvedValue(true);
const mockGetAllTasks = jest.fn().mockReturnValue([]);
const mockEnsureTaskHasId = jest.fn().mockResolvedValue('mock-id');
const mockFindTaskById = jest.fn().mockReturnValue(null);
const mockCreateTask = jest.fn().mockResolvedValue(undefined);
const mockUpdateTaskInVault = jest.fn().mockResolvedValue(undefined);

jest.mock('../tasks/taskManager', () => ({
  TaskManager: jest.fn().mockImplementation(() => ({
    initialize: mockTaskManagerInitialize,
    getAllTasks: mockGetAllTasks,
    ensureTaskHasId: mockEnsureTaskHasId,
    findTaskById: mockFindTaskById,
    createTask: mockCreateTask,
    updateTaskInVault: mockUpdateTaskInVault,
  })),
}));

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockFetchVTODOs = jest.fn().mockResolvedValue([]);
const mockCreateVTODO = jest.fn().mockResolvedValue(undefined);
const mockUpdateVTODO = jest.fn().mockResolvedValue(undefined);
const mockDeleteVTODOByUID = jest.fn().mockResolvedValue(undefined);
const mockFetchVTODOByUID = jest.fn().mockResolvedValue(null);

jest.mock('../caldav/calDAVClientDirect', () => ({
  CalDAVClientDirect: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    fetchVTODOs: mockFetchVTODOs,
    createVTODO: mockCreateVTODO,
    updateVTODO: mockUpdateVTODO,
    deleteVTODOByUID: mockDeleteVTODOByUID,
    fetchVTODOByUID: mockFetchVTODOByUID,
  })),
}));

const mockStorageInitialize = jest.fn().mockResolvedValue(undefined);
const mockGetBaseline = jest.fn().mockReturnValue([]);
const mockGetMapping = jest.fn().mockReturnValue({ tasks: {}, caldavToTask: {} });
const mockGetState = jest.fn().mockReturnValue({ lastSyncTime: '', conflicts: [] });
const mockSetBaseline = jest.fn();
const mockUpdateLastSyncTime = jest.fn();
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockAddTaskMapping = jest.fn();
const mockRemoveTaskMapping = jest.fn();

jest.mock('../storage/syncStorage', () => ({
  SyncStorage: jest.fn().mockImplementation(() => ({
    initialize: mockStorageInitialize,
    getBaseline: mockGetBaseline,
    getMapping: mockGetMapping,
    getState: mockGetState,
    setBaseline: mockSetBaseline,
    updateLastSyncTime: mockUpdateLastSyncTime,
    save: mockSave,
    addTaskMapping: mockAddTaskMapping,
    removeTaskMapping: mockRemoveTaskMapping,
  })),
}));

// --- Tests ---

describe('SyncEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set implementations that individual tests may override.
    // clearAllMocks clears call counts but not implementations,
    // so we must explicitly reset any fn that a test reconfigures.
    mockTaskManagerInitialize.mockResolvedValue(true);
    mockGetAllTasks.mockReturnValue([]);
    mockEnsureTaskHasId.mockResolvedValue('mock-id');
    mockFindTaskById.mockReturnValue(null);
    mockCreateTask.mockResolvedValue(undefined);
    mockUpdateTaskInVault.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(undefined);
    mockFetchVTODOs.mockResolvedValue([]);
    mockCreateVTODO.mockResolvedValue(undefined);
    mockUpdateVTODO.mockResolvedValue(undefined);
    mockDeleteVTODOByUID.mockResolvedValue(undefined);
    mockFetchVTODOByUID.mockResolvedValue(null);
    mockStorageInitialize.mockResolvedValue(undefined);
    mockGetBaseline.mockReturnValue([]);
    mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });
    mockGetState.mockReturnValue({ lastSyncTime: '', conflicts: [] });
    mockSave.mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('should return true when obsidian-tasks plugin is available', async () => {
      const engine = new SyncEngine(new App(), makeSettings());
      expect(await engine.initialize()).toBe(true);
      expect(mockTaskManagerInitialize).toHaveBeenCalled();
      expect(mockStorageInitialize).toHaveBeenCalled();
    });

    it('should return false when obsidian-tasks plugin is unavailable', async () => {
      mockTaskManagerInitialize.mockResolvedValue(false);
      const engine = new SyncEngine(new App(), makeSettings());
      expect(await engine.initialize()).toBe(false);
      // Should not initialize storage if taskManager failed
      expect(mockStorageInitialize).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return failure result when CalDAV connection fails', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
      expect(result.created).toEqual({ toObsidian: 0, toCalDAV: 0 });
    });

    it('should return failure result when fetching VTODOs fails', async () => {
      mockFetchVTODOs.mockRejectedValue(new Error('Server error'));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Server error');
    });
  });

  describe('dry run', () => {
    it('should not apply changes or save state', async () => {
      const task = makeObsidianTask({
        description: 'New obsidian task',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      mockGetAllTasks.mockReturnValue([task]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      // Should NOT touch vault or CalDAV
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockUpdateTaskInVault).not.toHaveBeenCalled();
      expect(mockCreateVTODO).not.toHaveBeenCalled();
      expect(mockUpdateVTODO).not.toHaveBeenCalled();
      expect(mockDeleteVTODOByUID).not.toHaveBeenCalled();
      // Should NOT save state
      expect(mockSetBaseline).not.toHaveBeenCalled();
      expect(mockUpdateLastSyncTime).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('should still report what would change', async () => {
      // Obsidian has a task, CalDAV doesn't → would create on CalDAV
      const task = makeObsidianTask({
        description: 'Task to sync',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      mockGetAllTasks.mockReturnValue([task]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toCalDAV).toBe(1);
      expect(result.details.toCalDAV.length).toBe(1);
      expect(result.details.toCalDAV[0].type).toBe('create');
      expect(result.message).toContain('Dry run');
    });
  });

  describe('real sync', () => {
    it('should apply changes and save state', async () => {
      // Obsidian has a task not on CalDAV → creates on CalDAV
      const task = makeObsidianTask({
        description: 'Task to push',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      mockGetAllTasks.mockReturnValue([task]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      // Should create VTODO on CalDAV
      expect(mockCreateVTODO).toHaveBeenCalledTimes(1);
      // Should save state
      expect(mockSetBaseline).toHaveBeenCalled();
      expect(mockUpdateLastSyncTime).toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalled();
    });

    it('should create task in Obsidian when CalDAV has a new task', async () => {
      // CalDAV has a task, Obsidian doesn't → create in Obsidian
      const vtodo = makeCalObj('caldav-task-001', 'Buy milk');
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasks.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.created.toObsidian).toBe(1);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
      // Should add mapping for the new task
      expect(mockAddTaskMapping).toHaveBeenCalled();
    });

    it('should remove mapping when deleting a task', async () => {
      // Task exists in baseline but not in Obsidian or CalDAV → delete
      // Simulate: CalDAV has task that was in baseline, Obsidian deleted it
      const task = makeObsidianTask({
        description: 'Task to delete on CalDAV',
        id: '20250101-del',
        tags: ['#sync'],
      });
      // Task is in baseline (was synced before) and in CalDAV, but not in Obsidian
      const vtodo = makeCalObj('caldav-del', 'Task to delete on CalDAV');
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasks.mockReturnValue([]);
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-del': { caldavUID: 'caldav-del', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'caldav-del': '20250101-del' },
      });
      // Baseline has this task (synced before)
      mockGetBaseline.mockReturnValue([{
        uid: '20250101-del',
        description: 'Task to delete on CalDAV',
        status: 'TODO',
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none',
        tags: [],
        recurrenceRule: '',
      }]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.deleted.toCalDAV).toBe(1);
      expect(mockDeleteVTODOByUID).toHaveBeenCalledTimes(1);
      expect(mockRemoveTaskMapping).toHaveBeenCalled();
    });
  });

  describe('result counting', () => {
    it('should count creates, updates, and deletes correctly', async () => {
      // Two Obsidian tasks not on CalDAV → 2 creates to CalDAV
      const task1 = makeObsidianTask({
        description: 'Task one',
        id: '20250101-001',
        tags: ['#sync'],
      });
      const task2 = makeObsidianTask({
        description: 'Task two',
        id: '20250101-002',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task two %%[id::20250101-002]%% #sync',
      });
      mockGetAllTasks.mockReturnValue([task1, task2]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toCalDAV).toBe(2);
      expect(result.updated.toCalDAV).toBe(0);
      expect(result.deleted.toCalDAV).toBe(0);
      expect(result.created.toObsidian).toBe(0);
    });

    it('should count CalDAV creates to Obsidian', async () => {
      // Two CalDAV tasks not in Obsidian → 2 creates to Obsidian
      mockFetchVTODOs.mockResolvedValue([
        makeCalObj('cal-001', 'CalDAV task 1'),
        makeCalObj('cal-002', 'CalDAV task 2'),
      ]);
      mockGetAllTasks.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toObsidian).toBe(2);
      expect(result.created.toCalDAV).toBe(0);
    });
  });

  describe('baseline seeding', () => {
    it('should seed baseline from mapping on first sync with new engine', async () => {
      // Scenario: mapping exists from old engine, baseline is empty
      const task = makeObsidianTask({
        description: 'Already synced task',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      const vtodo = makeCalObj('caldav-abc', 'Already synced task');
      mockGetAllTasks.mockReturnValue([task]);
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([]); // Empty baseline
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-abc': { caldavUID: 'caldav-abc', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      // The task exists on both sides and was in the mapping →
      // baseline should have been seeded, preventing duplication
      expect(result.created.toObsidian).toBe(0);
      expect(result.created.toCalDAV).toBe(0);
    });

    it('should not seed baseline when mapping is also empty', async () => {
      // Fresh install: no mapping, no baseline → tasks are new
      const task = makeObsidianTask({
        description: 'Brand new task',
        id: '20250101-new',
        tags: ['#sync'],
      });
      mockGetAllTasks.mockReturnValue([task]);
      mockGetBaseline.mockReturnValue([]);
      mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      // No baseline, no mapping → task is new, should be created on CalDAV
      expect(result.created.toCalDAV).toBe(1);
    });
  });

  describe('conflict strategy', () => {
    it('should use obsidian-wins strategy when autoResolveObsidianWins is true', async () => {
      // Both sides have the same task with different content, baseline has original
      const baseline = {
        uid: '20250101-abc',
        description: 'Original task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [] as string[],
        recurrenceRule: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Updated in Obsidian',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Updated in Obsidian %%[id::20250101-abc]%% #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Updated in CalDAV');

      mockGetAllTasks.mockReturnValue([obsTask]);
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-abc': { caldavUID: 'caldav-abc', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings({ autoResolveObsidianWins: true }));
      await engine.initialize();
      const result = await engine.sync(true);

      // With obsidian-wins, conflict is auto-resolved → update pushed to CalDAV
      // The conflict is still recorded for informational purposes
      expect(result.conflicts).toBe(1);
      expect(result.updated.toCalDAV).toBe(1);
      expect(result.details.toCalDAV[0].task.description).toBe('Updated in Obsidian');
    });

    it('should use caldav-wins strategy when autoResolveObsidianWins is false', async () => {
      const baseline = {
        uid: '20250101-abc',
        description: 'Original task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [] as string[],
        recurrenceRule: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Updated in Obsidian',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Updated in Obsidian %%[id::20250101-abc]%% #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Updated in CalDAV');

      mockGetAllTasks.mockReturnValue([obsTask]);
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-abc': { caldavUID: 'caldav-abc', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings({ autoResolveObsidianWins: false }));
      await engine.initialize();
      const result = await engine.sync(true);

      // With caldav-wins, conflict is auto-resolved → update pushed to Obsidian
      // The conflict is still recorded for informational purposes
      expect(result.conflicts).toBe(1);
      expect(result.updated.toObsidian).toBe(1);
      expect(result.details.toObsidian[0].task.description).toBe('Updated in CalDAV');
    });
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

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      await engine.sync(true);

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

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
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

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: '' }));
      await engine.initialize();
      await engine.sync(true);

      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(2);
    });

    it('should match sync tag case-insensitively', async () => {
      const task = makeObsidianTask({
        description: 'Mixed case',
        tags: ['#Sync'],
        originalMarkdown: '- [ ] Mixed case #Sync',
      });

      mockGetAllTasks.mockReturnValue([task]);

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
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

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: '#sync' }));
      await engine.initialize();
      await engine.sync(true);

      expect(mockEnsureTaskHasId).toHaveBeenCalledTimes(1);
    });
  });

  describe('sync result', () => {
    it('should include input snapshots', async () => {
      const task = makeObsidianTask({
        description: 'My task',
        tags: ['#sync'],
        id: '20250101-abc',
      });

      mockGetAllTasks.mockReturnValue([task]);

      const engine = new SyncEngine(new App(), makeSettings());
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

    it('should not include input snapshots on error', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(false);
      expect(result.details.obsidianTasks).toBeUndefined();
    });
  });

  describe('apply changes to Obsidian', () => {
    it('should update existing task in vault when CalDAV has changes', async () => {
      // Baseline has original description
      const baseline = {
        uid: '20250101-abc',
        description: 'Original task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [] as string[],
        recurrenceRule: '',
      };

      // Obsidian still has the original
      const obsTask = makeObsidianTask({
        description: 'Original task',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Original task %%[id::20250101-abc]%% #sync',
      });

      // CalDAV has changed description
      const vtodo = makeCalObj('caldav-abc', 'Updated from CalDAV');

      mockGetAllTasks.mockReturnValue([obsTask]);
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-abc': { caldavUID: 'caldav-abc', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'caldav-abc': '20250101-abc' },
      });
      // findTaskById must return the obsidian task so the update path works
      mockFindTaskById.mockReturnValue(obsTask);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.updated.toObsidian).toBe(1);
      expect(mockUpdateTaskInVault).toHaveBeenCalledTimes(1);
      // First arg should be the existing obsidian task
      expect(mockUpdateTaskInVault.mock.calls[0][0]).toBe(obsTask);
    });
  });

  describe('mapping updates after sync', () => {
    it('should add mapping when creating task on CalDAV from Obsidian', async () => {
      // Obsidian has a new task not on CalDAV, no baseline, no mapping
      const task = makeObsidianTask({
        description: 'New obsidian task',
        id: '20250101-new',
        tags: ['#sync'],
        originalMarkdown: '- [ ] New obsidian task %%[id::20250101-new]%% #sync',
      });
      mockGetAllTasks.mockReturnValue([task]);
      mockFetchVTODOs.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });
      // findTaskById returns the task (used by updateMappingsAfterSync to get sourceFile)
      mockFindTaskById.mockReturnValue(task);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.created.toCalDAV).toBe(1);
      expect(mockAddTaskMapping).toHaveBeenCalledTimes(1);
      // Should be called with (taskUid, caldavUID, sourceFile)
      // caldavUID should start with 'obsidian-'
      const callArgs = mockAddTaskMapping.mock.calls[0];
      expect(callArgs[0]).toBe('20250101-new');
      expect(callArgs[1]).toMatch(/^obsidian-/);
    });
  });

  describe('baseline after sync', () => {
    it('should include all synced tasks in new baseline', async () => {
      // Obsidian has task A (new)
      const taskA = makeObsidianTask({
        description: 'Task A from Obsidian',
        id: '20250101-aaa',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task A from Obsidian %%[id::20250101-aaa]%% #sync',
      });
      // CalDAV has task B (new)
      const vtodoB = makeCalObj('caldav-bbb', 'Task B from CalDAV');

      mockGetAllTasks.mockReturnValue([taskA]);
      mockFetchVTODOs.mockResolvedValue([vtodoB]);
      mockGetBaseline.mockReturnValue([]);
      mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(mockSetBaseline).toHaveBeenCalledTimes(1);

      const newBaseline: any[] = mockSetBaseline.mock.calls[0][0];
      // Should contain both tasks
      expect(newBaseline.length).toBe(2);
      const uids = newBaseline.map((t: any) => t.uid).sort();
      expect(uids).toContain('20250101-aaa');
      expect(uids).toContain('caldav-bbb');
    });
  });

  describe('idempotency', () => {
    it('should produce zero changes on second sync after successful first sync', async () => {
      // First sync: Obsidian has task A (new)
      const taskA = makeObsidianTask({
        description: 'Task A',
        id: '20250101-aaa',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task A %%[id::20250101-aaa]%% #sync',
      });
      mockGetAllTasks.mockReturnValue([taskA]);
      mockFetchVTODOs.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });

      const engine1 = new SyncEngine(new App(), makeSettings());
      await engine1.initialize();
      const result1 = await engine1.sync(false);

      expect(result1.success).toBe(true);
      expect(result1.created.toCalDAV).toBe(1);

      // Capture the baseline that was saved
      const savedBaseline = mockSetBaseline.mock.calls[0][0];

      // Second sync: now CalDAV also has the task (it was created in first sync),
      // baseline has it, and mapping has it.
      jest.clearAllMocks();
      // Re-set default implementations after clearAllMocks
      mockTaskManagerInitialize.mockResolvedValue(true);
      mockConnect.mockResolvedValue(undefined);
      mockStorageInitialize.mockResolvedValue(undefined);
      mockSave.mockResolvedValue(undefined);
      mockCreateVTODO.mockResolvedValue(undefined);
      mockUpdateVTODO.mockResolvedValue(undefined);
      mockDeleteVTODOByUID.mockResolvedValue(undefined);
      mockCreateTask.mockResolvedValue(undefined);
      mockUpdateTaskInVault.mockResolvedValue(undefined);
      mockEnsureTaskHasId.mockResolvedValue('20250101-aaa');
      mockFetchVTODOByUID.mockResolvedValue(null);

      // Obsidian still has the same task
      mockGetAllTasks.mockReturnValue([taskA]);
      // CalDAV now has a matching task (created in first sync)
      // Include CATEGORIES:sync to match what the real sync would produce
      const vtodoA = makeCalObj('obsidian-20250101-aaa', 'Task A', ['CATEGORIES:sync']);
      mockFetchVTODOs.mockResolvedValue([vtodoA]);
      // Baseline reflects what was saved
      mockGetBaseline.mockReturnValue(savedBaseline);
      // Mapping now has the task
      mockGetMapping.mockReturnValue({
        tasks: { '20250101-aaa': { caldavUID: 'obsidian-20250101-aaa', sourceFile: 'Tasks.md', lastSyncedObsidian: '', lastSyncedCalDAV: '', lastModifiedObsidian: '', lastModifiedCalDAV: '' } },
        caldavToTask: { 'obsidian-20250101-aaa': '20250101-aaa' },
      });

      const engine2 = new SyncEngine(new App(), makeSettings());
      await engine2.initialize();
      const result2 = await engine2.sync(false);

      expect(result2.success).toBe(true);
      expect(result2.created.toCalDAV).toBe(0);
      expect(result2.created.toObsidian).toBe(0);
      expect(result2.updated.toCalDAV).toBe(0);
      expect(result2.updated.toObsidian).toBe(0);
      expect(result2.deleted.toCalDAV).toBe(0);
      expect(result2.deleted.toObsidian).toBe(0);
    });
  });

  describe('error resilience', () => {
    it('should continue applying remaining changes after one fails', async () => {
      // Two new CalDAV tasks to create in Obsidian
      const vtodo1 = makeCalObj('caldav-001', 'Task one');
      const vtodo2 = makeCalObj('caldav-002', 'Task two');

      mockFetchVTODOs.mockResolvedValue([vtodo1, vtodo2]);
      mockGetAllTasks.mockReturnValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetMapping.mockReturnValue({ tasks: {}, caldavToTask: {} });

      // First call rejects, second resolves
      mockCreateTask
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      // Should have attempted both creates, not aborted after first failure
      expect(mockCreateTask).toHaveBeenCalledTimes(2);
    });
  });
});
