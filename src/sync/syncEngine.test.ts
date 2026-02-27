import { App } from 'obsidian';
import { SyncEngine } from './syncEngine';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS, IdMapping } from '../types';
import { CalendarObject } from '../caldav/vtodoMapper';
import { ObsidianTask } from '../tasks/obsidianTasksWrapper';
import { CommonTask } from './types';

// --- Helpers ---

function makeObsidianTask(overrides: Partial<ObsidianTask> = {}): ObsidianTask {
  return {
    description: 'Test task',
    status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
    isDone: false,
    priority: '0',
    tags: ['#sync'],
    taskLocation: { _tasksFile: { _path: 'Tasks.md' }, _lineNumber: 1 },
    originalMarkdown: '- [ ] Test task [id::20250101-abc] #sync',
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
    syncTag: '', // Default to no tag filtering; tests that need it set syncTag explicitly
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

function withBody(...tasks: ObsidianTask[]) {
  return tasks.map(task => ({ task, body: '' }));
}

function makeCalObj(uid: string, summary: string, extra: string[] = []): CalendarObject {
  return {
    data: buildVTODO(uid, summary, extra),
    url: `http://example.com/${uid}.ics`,
    etag: `etag-${uid}`,
  };
}

// --- Mocks ---

const mockWrapperInitialize = jest.fn().mockReturnValue(true);
const mockGetAllTasksWithBody = jest.fn().mockResolvedValue([]);
const mockFindTaskById = jest.fn().mockReturnValue(null);
const mockCreateTask = jest.fn().mockResolvedValue(undefined);
const mockUpdateTaskInVault = jest.fn().mockResolvedValue(undefined);
const mockGetTaskId = jest.fn().mockImplementation((task: ObsidianTask) => task.id || null);
const mockFilterByTag = jest.fn().mockImplementation(
  (inputs: Array<{ task: ObsidianTask }>, syncTag?: string) => {
    if (!syncTag || syncTag.trim() === '') return inputs;
    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return inputs.filter(({ task }) => {
      if (!task.tags || task.tags.length === 0) return false;
      return task.tags.some((tag: string) => tag.toLowerCase().replace(/^#/, '') === tagLower);
    });
  },
);
const mockExtractId = jest.fn().mockImplementation((task: ObsidianTask) => task.id || null);

jest.mock('../tasks/obsidianTasksWrapper', () => ({
  ObsidianTasksWrapper: jest.fn().mockImplementation(() => ({
    initialize: mockWrapperInitialize,
    getAllTasksWithBody: mockGetAllTasksWithBody,
    findTaskById: mockFindTaskById,
    createTask: mockCreateTask,
    updateTaskInVault: mockUpdateTaskInVault,
    getTaskId: mockGetTaskId,
    filterByTag: mockFilterByTag,
    extractId: mockExtractId,
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
const mockGetState = jest.fn().mockReturnValue({ lastSyncTime: '', conflicts: [] });
const mockSetBaseline = jest.fn();
const mockUpdateLastSyncTime = jest.fn();
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockGetIdMapping = jest.fn().mockReturnValue({ taskIdToCaldavUid: {}, caldavUidToTaskId: {} });
const mockSetIdMapping = jest.fn();

jest.mock('../storage/syncStorage', () => ({
  SyncStorage: jest.fn().mockImplementation(() => ({
    initialize: mockStorageInitialize,
    getBaseline: mockGetBaseline,
    getState: mockGetState,
    setBaseline: mockSetBaseline,
    updateLastSyncTime: mockUpdateLastSyncTime,
    save: mockSave,
    getIdMapping: mockGetIdMapping,
    setIdMapping: mockSetIdMapping,
  })),
}));

// --- Tests ---

describe('SyncEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrapperInitialize.mockReturnValue(true);
    mockGetAllTasksWithBody.mockResolvedValue([]);
    mockFindTaskById.mockReturnValue(null);
    mockCreateTask.mockResolvedValue(undefined);
    mockUpdateTaskInVault.mockResolvedValue(undefined);
    mockGetTaskId.mockImplementation((task: ObsidianTask) => task.id || null);
    mockFilterByTag.mockImplementation(
      (inputs: Array<{ task: ObsidianTask }>, syncTag?: string) => {
        if (!syncTag || syncTag.trim() === '') return inputs;
        const tagLower = syncTag.toLowerCase().replace(/^#/, '');
        return inputs.filter(({ task }) => {
          if (!task.tags || task.tags.length === 0) return false;
          return task.tags.some((tag: string) => tag.toLowerCase().replace(/^#/, '') === tagLower);
        });
      },
    );
    mockExtractId.mockImplementation((task: ObsidianTask) => task.id || null);
    mockConnect.mockResolvedValue(undefined);
    mockFetchVTODOs.mockResolvedValue([]);
    mockCreateVTODO.mockResolvedValue(undefined);
    mockUpdateVTODO.mockResolvedValue(undefined);
    mockDeleteVTODOByUID.mockResolvedValue(undefined);
    mockFetchVTODOByUID.mockResolvedValue(null);
    mockStorageInitialize.mockResolvedValue(undefined);
    mockGetBaseline.mockReturnValue([]);
    mockGetIdMapping.mockReturnValue({ taskIdToCaldavUid: {}, caldavUidToTaskId: {} });
    mockGetState.mockReturnValue({ lastSyncTime: '', conflicts: [] });
    mockSave.mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('should return true when obsidian-tasks plugin is available', async () => {
      const engine = new SyncEngine(new App(), makeSettings());
      expect(await engine.initialize()).toBe(true);
      expect(mockWrapperInitialize).toHaveBeenCalled();
      expect(mockStorageInitialize).toHaveBeenCalled();
    });

    it('should return false when obsidian-tasks plugin is unavailable', async () => {
      mockWrapperInitialize.mockReturnValue(false);
      const engine = new SyncEngine(new App(), makeSettings());
      expect(await engine.initialize()).toBe(false);
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
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(mockCreateTask).not.toHaveBeenCalled();
      expect(mockUpdateTaskInVault).not.toHaveBeenCalled();
      expect(mockCreateVTODO).not.toHaveBeenCalled();
      expect(mockUpdateVTODO).not.toHaveBeenCalled();
      expect(mockDeleteVTODOByUID).not.toHaveBeenCalled();
      expect(mockSetBaseline).not.toHaveBeenCalled();
      expect(mockUpdateLastSyncTime).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('should still report what would change', async () => {
      const task = makeObsidianTask({
        description: 'Task to sync',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

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
      const task = makeObsidianTask({
        description: 'Task to push',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(mockCreateVTODO).toHaveBeenCalledTimes(1);
      expect(mockSetBaseline).toHaveBeenCalled();
      expect(mockUpdateLastSyncTime).toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalled();
    });

    it('should create task in Obsidian when CalDAV has a new task', async () => {
      const vtodo = makeCalObj('caldav-task-001', 'Buy milk');
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasksWithBody.mockResolvedValue([]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.created.toObsidian).toBe(1);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
      // Should update IdMapping for the new task
      expect(mockSetIdMapping).toHaveBeenCalled();
    });

    it('should update IdMapping when deleting a task', async () => {
      // Task is in baseline (was synced before) and in CalDAV, but not in Obsidian
      const vtodo = makeCalObj('caldav-del', 'Task to delete on CalDAV');
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-del': 'caldav-del' },
        caldavUidToTaskId: { 'caldav-del': '20250101-del' },
      });
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
        body: '',
      }]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.deleted.toCalDAV).toBe(1);
      expect(mockDeleteVTODOByUID).toHaveBeenCalledTimes(1);
      expect(mockSetIdMapping).toHaveBeenCalled();
    });
  });

  describe('result counting', () => {
    it('should count creates, updates, and deletes correctly', async () => {
      const task1 = makeObsidianTask({
        description: 'Task one',
        id: '20250101-001',
        tags: ['#sync'],
      });
      const task2 = makeObsidianTask({
        description: 'Task two',
        id: '20250101-002',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task two [id::20250101-002] #sync',
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task1, task2));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toCalDAV).toBe(2);
      expect(result.updated.toCalDAV).toBe(0);
      expect(result.deleted.toCalDAV).toBe(0);
      expect(result.created.toObsidian).toBe(0);
    });

    it('should count CalDAV creates to Obsidian', async () => {
      mockFetchVTODOs.mockResolvedValue([
        makeCalObj('cal-001', 'CalDAV task 1'),
        makeCalObj('cal-002', 'CalDAV task 2'),
      ]);
      mockGetAllTasksWithBody.mockResolvedValue([]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toObsidian).toBe(2);
      expect(result.created.toCalDAV).toBe(0);
    });
  });

  describe('baseline seeding', () => {
    it('should seed baseline from IdMapping on first sync with new engine', async () => {
      const task = makeObsidianTask({
        description: 'Already synced task',
        id: '20250101-abc',
        tags: ['#sync'],
      });
      const vtodo = makeCalObj('caldav-abc', 'Already synced task');
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([]); // Empty baseline
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      // The task exists on both sides and was in the IdMapping →
      // baseline should have been seeded, preventing duplication
      expect(result.created.toObsidian).toBe(0);
      expect(result.created.toCalDAV).toBe(0);
    });

    it('should not seed baseline when IdMapping is also empty', async () => {
      const task = makeObsidianTask({
        description: 'Brand new task',
        id: '20250101-new',
        tags: ['#sync'],
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));
      mockGetBaseline.mockReturnValue([]);
      mockGetIdMapping.mockReturnValue({ taskIdToCaldavUid: {}, caldavUidToTaskId: {} });

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.created.toCalDAV).toBe(1);
    });
  });

  describe('conflict strategy', () => {
    it('should use obsidian-wins strategy when autoResolveObsidianWins is true', async () => {
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
        body: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Updated in Obsidian',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Updated in Obsidian [id::20250101-abc] #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Updated in CalDAV');

      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings({ autoResolveObsidianWins: true }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.conflicts).toBe(1);
      expect(result.updated.toCalDAV).toBe(1);
      expect(result.details.toCalDAV[0].task.title).toBe('Updated in Obsidian');
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
        body: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Updated in Obsidian',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Updated in Obsidian [id::20250101-abc] #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Updated in CalDAV');

      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(new App(), makeSettings({ autoResolveObsidianWins: false }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.conflicts).toBe(1);
      expect(result.updated.toObsidian).toBe(1);
      expect(result.details.toObsidian[0].task.title).toBe('Updated in CalDAV');
    });
  });

  describe('ID writeback after sync', () => {
    it('should write IDs to vault after successful sync for tasks without IDs', async () => {
      const task = makeObsidianTask({
        description: 'Task without ID',
        tags: ['#sync'],
        id: '',
        originalMarkdown: '- [ ] Task without ID #sync',
      });

      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(mockUpdateTaskInVault).toHaveBeenCalledTimes(1);
      const newMarkdown = (mockUpdateTaskInVault.mock.calls[0] as [ObsidianTask, string])[1];
      expect(newMarkdown).toContain('🆔');
    });

    it('should not write IDs during dry run', async () => {
      const task = makeObsidianTask({
        description: 'Task without ID',
        tags: ['#sync'],
        id: '',
        originalMarkdown: '- [ ] Task without ID #sync',
      });

      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(mockUpdateTaskInVault).not.toHaveBeenCalled();
    });

    it('should not write IDs for tasks that already have them', async () => {
      const task = makeObsidianTask({
        description: 'Task with ID',
        tags: ['#sync'],
        id: '20250101-abc',
        originalMarkdown: '- [ ] Task with ID 🆔 20250101-abc #sync',
      });

      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      await engine.sync(false);

      expect(mockUpdateTaskInVault).not.toHaveBeenCalled();
    });

    it('should only write IDs for tasks matching the sync tag', async () => {
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

      mockGetAllTasksWithBody.mockResolvedValue(withBody(syncedTask, unsyncedTask));

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      await engine.sync(false);

      const writebackCalls = mockUpdateTaskInVault.mock.calls.filter(
        (call: [ObsidianTask, string]) => call[1].includes('🆔')
      );
      expect(writebackCalls).toHaveLength(1);
      expect((writebackCalls[0] as [ObsidianTask, string])[0]).toBe(syncedTask);
    });
  });

  describe('CalDAV sync tag filtering', () => {
    it('should exclude CalDAV tasks without the sync tag', async () => {
      const vtodoWithTag = makeCalObj('caldav-with-tag', 'Task with tag', ['CATEGORIES:sync']);
      const vtodoWithoutTag = makeCalObj('caldav-no-tag', 'Task without tag', ['CATEGORIES:other']);

      mockFetchVTODOs.mockResolvedValue([vtodoWithTag, vtodoWithoutTag]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.created.toObsidian).toBe(1);
      expect(result.details.caldavTasks!.length).toBe(1);
      expect(result.details.caldavTasks![0].title).toBe('Task with tag');
    });

    it('should exclude mapped CalDAV tasks without the sync tag (tag-only filtering)', async () => {
      const vtodo = makeCalObj('caldav-mapped', 'Mapped task');

      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { 'task-mapped': 'caldav-mapped' },
        caldavUidToTaskId: { 'caldav-mapped': 'task-mapped' },
      });

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.details.caldavTasks!.length).toBe(0);
    });

    it('should exclude CalDAV tasks with no categories when sync tag is set', async () => {
      const vtodo = makeCalObj('caldav-bare', 'Task no categories');

      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.details.caldavTasks!.length).toBe(0);
      expect(result.created.toObsidian).toBe(0);
    });

    it('should match CalDAV categories case-insensitively', async () => {
      const vtodo = makeCalObj('caldav-upper', 'Task with SYNC', ['CATEGORIES:SYNC']);

      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.details.caldavTasks!.length).toBe(1);
    });

    it('should include all CalDAV tasks when no sync tag is configured', async () => {
      const vtodo1 = makeCalObj('caldav-1', 'Task one');
      const vtodo2 = makeCalObj('caldav-2', 'Task two');

      mockFetchVTODOs.mockResolvedValue([vtodo1, vtodo2]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings({ syncTag: '' }));
      await engine.initialize();
      const result = await engine.sync(true);

      expect(result.success).toBe(true);
      expect(result.details.caldavTasks!.length).toBe(2);
    });
  });

  describe('sync result', () => {
    it('should include input snapshots', async () => {
      const task = makeObsidianTask({
        description: 'My task',
        tags: ['#sync'],
        id: '20250101-abc',
      });

      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));

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
        body: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Original task',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Original task [id::20250101-abc] #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Updated from CalDAV');

      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });
      mockFindTaskById.mockReturnValue(obsTask);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.updated.toObsidian).toBe(1);
      expect(mockUpdateTaskInVault).toHaveBeenCalledTimes(1);
      expect((mockUpdateTaskInVault.mock.calls[0] as [ObsidianTask, string])[0]).toBe(obsTask);
    });

    it('should include completion date when CalDAV marks task as done', async () => {
      const baseline = {
        uid: '20250101-abc',
        description: 'Task to complete',
        status: 'TODO' as const,
        dueDate: '2025-07-01',
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [] as string[],
        recurrenceRule: '',
        body: '',
      };

      const obsTask = makeObsidianTask({
        description: 'Task to complete',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task to complete 📅 2025-07-01 🆔 20250101-abc #sync',
      });

      const vtodo = makeCalObj('caldav-abc', 'Task to complete', [
        'DUE;VALUE=DATE:20250701',
        'STATUS:COMPLETED',
        'COMPLETED:20250715T140000Z',
        'PERCENT-COMPLETE:100',
      ]);

      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });
      mockFindTaskById.mockReturnValue(obsTask);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.updated.toObsidian).toBe(1);
      expect(mockUpdateTaskInVault).toHaveBeenCalledTimes(1);

      const newMarkdown = (mockUpdateTaskInVault.mock.calls[0] as [ObsidianTask, string])[1];
      expect(newMarkdown).toContain('- [x]');
      expect(newMarkdown).toContain('📅 2025-07-01');
      expect(newMarkdown).toContain('✅ 2025-07-15');
      expect(newMarkdown).toContain('🆔 20250101-abc');
    });
  });

  describe('IdMapping updates after sync', () => {
    it('should update IdMapping when creating task on CalDAV from Obsidian', async () => {
      const task = makeObsidianTask({
        description: 'New obsidian task',
        id: '20250101-new',
        tags: ['#sync'],
        originalMarkdown: '- [ ] New obsidian task [id::20250101-new] #sync',
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(task));
      mockFetchVTODOs.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetIdMapping.mockReturnValue({ taskIdToCaldavUid: {}, caldavUidToTaskId: {} });
      mockFindTaskById.mockReturnValue(task);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(result.created.toCalDAV).toBe(1);
      expect(mockSetIdMapping).toHaveBeenCalledTimes(1);
      // The IdMapping should include the new task with obsidian- prefix
      const savedMapping = (mockSetIdMapping.mock.calls[0] as [IdMapping])[0];
      expect(savedMapping.taskIdToCaldavUid['20250101-new']).toMatch(/^obsidian-/);
    });
  });

  describe('baseline after sync', () => {
    it('should include all synced tasks in new baseline', async () => {
      const taskA = makeObsidianTask({
        description: 'Task A from Obsidian',
        id: '20250101-aaa',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task A from Obsidian [id::20250101-aaa] #sync',
      });
      const vtodoB = makeCalObj('caldav-bbb', 'Task B from CalDAV');

      mockGetAllTasksWithBody.mockResolvedValue(withBody(taskA));
      mockFetchVTODOs.mockResolvedValue([vtodoB]);
      mockGetBaseline.mockReturnValue([]);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(mockSetBaseline).toHaveBeenCalledTimes(1);

      const newBaseline = (mockSetBaseline.mock.calls[0] as [CommonTask[]])[0];
      expect(newBaseline.length).toBe(2);
      const uids = newBaseline.map((t: CommonTask) => t.uid).sort();
      expect(uids).toContain('20250101-aaa');
      expect(uids).toContain('caldav-bbb');
    });
  });

  describe('idempotency', () => {
    it('should produce zero changes on second sync after successful first sync', async () => {
      const taskA = makeObsidianTask({
        description: 'Task A',
        id: '20250101-aaa',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Task A [id::20250101-aaa] #sync',
      });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(taskA));
      mockFetchVTODOs.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);
      mockGetIdMapping.mockReturnValue({ taskIdToCaldavUid: {}, caldavUidToTaskId: {} });

      const engine1 = new SyncEngine(new App(), makeSettings());
      await engine1.initialize();
      const result1 = await engine1.sync(false);

      expect(result1.success).toBe(true);
      expect(result1.created.toCalDAV).toBe(1);

      const savedBaseline = (mockSetBaseline.mock.calls[0] as [CommonTask[]])[0];

      // Second sync
      jest.clearAllMocks();
      mockWrapperInitialize.mockReturnValue(true);
      mockConnect.mockResolvedValue(undefined);
      mockStorageInitialize.mockResolvedValue(undefined);
      mockSave.mockResolvedValue(undefined);
      mockCreateVTODO.mockResolvedValue(undefined);
      mockUpdateVTODO.mockResolvedValue(undefined);
      mockDeleteVTODOByUID.mockResolvedValue(undefined);
      mockCreateTask.mockResolvedValue(undefined);
      mockUpdateTaskInVault.mockResolvedValue(undefined);
      mockFetchVTODOByUID.mockResolvedValue(null);
      mockFilterByTag.mockImplementation(
        (inputs: Array<{ task: ObsidianTask }>, syncTag?: string) => {
          if (!syncTag || syncTag.trim() === '') return inputs;
          const tagLower = syncTag.toLowerCase().replace(/^#/, '');
          return inputs.filter(({ task }) => {
            if (!task.tags || task.tags.length === 0) return false;
            return task.tags.some((tag: string) => tag.toLowerCase().replace(/^#/, '') === tagLower);
          });
        },
      );
      mockExtractId.mockImplementation((task: ObsidianTask) => task.id || null);
      mockGetAllTasksWithBody.mockResolvedValue(withBody(taskA));
      const vtodoA = makeCalObj('obsidian-20250101-aaa', 'Task A', ['CATEGORIES:sync']);
      mockFetchVTODOs.mockResolvedValue([vtodoA]);
      mockGetBaseline.mockReturnValue(savedBaseline);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-aaa': 'obsidian-20250101-aaa' },
        caldavUidToTaskId: { 'obsidian-20250101-aaa': '20250101-aaa' },
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
      const vtodo1 = makeCalObj('caldav-001', 'Task one');
      const vtodo2 = makeCalObj('caldav-002', 'Task two');

      mockFetchVTODOs.mockResolvedValue([vtodo1, vtodo2]);
      mockGetAllTasksWithBody.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([]);

      mockCreateTask
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);

      const engine = new SyncEngine(new App(), makeSettings());
      await engine.initialize();
      const result = await engine.sync(false);

      expect(result.success).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(2);
    });
  });
});
