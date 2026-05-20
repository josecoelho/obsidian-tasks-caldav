import { ObsidianAdapter, ObsidianSyncSettings, TaskWithBody } from './obsidianAdapter';
import { ObsidianTask, ObsidianTasksWrapper } from '../tasks/obsidianTasksWrapper';
import { CommonTask, SyncChange } from './types';

function makeTask(overrides: Partial<ObsidianTask> = {}): ObsidianTask {
  return {
    description: 'Buy groceries',
    status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
    isDone: false,
    priority: '0',
    tags: ['#sync'],
    taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
    originalMarkdown: '- [ ] Buy groceries 🆔 20250105-a4f #sync',
    createdDate: null,
    startDate: null,
    scheduledDate: null,
    dueDate: null,
    doneDate: null,
    cancelledDate: null,
    recurrence: null,
    id: '20250105-a4f',
    ...overrides,
  };
}

function withBody(task: ObsidianTask, body: string = ''): TaskWithBody {
  return { task, body, parentTask: null };
}

const dummyWrapper = {
  getAllTasksWithBody: jest.fn().mockResolvedValue([]),
  filterByTag: jest.fn().mockImplementation((inputs: TaskWithBody[]) => inputs),
  extractId: jest.fn().mockImplementation((task: ObsidianTask) => task.id || null),
  findTaskById: jest.fn().mockReturnValue(null),
  createTask: jest.fn().mockResolvedValue(undefined),
  updateTaskInVault: jest.fn().mockResolvedValue(undefined),
  insertSubtask: jest.fn().mockResolvedValue(undefined),
  initialize: jest.fn().mockReturnValue(true),
  getTaskId: jest.fn(),
  getToggleCommand: jest.fn().mockReturnValue(null),
  getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'emoji', globalFilter: '' }),
} as unknown as ObsidianTasksWrapper;

const defaultSettings: ObsidianSyncSettings = {
  syncTag: 'sync',
  newTasksDestination: 'Inbox.md',
};

describe('ObsidianAdapter', () => {
  const extractId = (task: ObsidianTask): string | null => task.id || null;

  describe('normalize', () => {
    it('should map inputs to CommonTask[] using existing IDs', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const inputs = [
        withBody(makeTask({ description: 'Task 1', id: 'id-1' })),
        withBody(makeTask({ description: 'Task 2', id: 'id-2' })),
      ];

      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].uid).toBe('id-1');
      expect(tasks[1].uid).toBe('id-2');
    });

    it('should generate IDs for tasks without existing IDs', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const inputs = [
        withBody(makeTask({ id: '' })),
      ];

      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].uid).toBeTruthy();
      expect(tasks[0].uid.length).toBeGreaterThan(0);
    });

    it('should include body from task inputs', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const inputs = [
        { task: makeTask({ id: 'task-1' }), body: 'Some body', parentTask: null },
      ];
      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('Some body');
    });

    it('should default to empty body', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const inputs = [
        withBody(makeTask({ id: 'task-1' })),
      ];
      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('');
    });
  });

  describe('findOriginalTask', () => {
    it('should return the original ObsidianTask after normalize', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const task = makeTask({ description: 'Test', id: 'my-id' });
      adapter.normalize([{ task, body: '', parentTask: null }], extractId);

      expect(adapter.findOriginalTask('my-id')).toBe(task);
    });

    it('should return undefined for unknown IDs', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      adapter.normalize([], extractId);

      expect(adapter.findOriginalTask('unknown')).toBeUndefined();
    });

    it('should find tasks with generated IDs', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const task = makeTask({ id: '' });
      const tasks = adapter.normalize([withBody(task)], extractId);

      expect(adapter.findOriginalTask(tasks[0].uid)).toBe(task);
    });
  });

  describe('obsidianUrl population', () => {
    it('should set obsidianUrl when includeObsidianLink is true', () => {
      const settings: ObsidianSyncSettings = {
        syncTag: 'sync',
        newTasksDestination: 'Inbox.md',
        includeObsidianLink: true,
        getVaultName: () => 'TestVault',
      };
      const adapter = new ObsidianAdapter(dummyWrapper, settings);
      const inputs: TaskWithBody[] = [{
        task: {
          description: 'Test task',
          status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
          isDone: false,
          priority: '0',
          tags: [],
          taskLocation: { path: 'Projects/tasks.md', _lineNumber: 5 },
          originalMarkdown: '- [ ] Test task',
          createdDate: null,
          startDate: null,
          scheduledDate: null,
          dueDate: null,
          doneDate: null,
          cancelledDate: null,
          recurrence: null,
          id: 'test-id-1',
        },
        body: '',
        parentTask: null,
      }];

      const result = adapter.normalize(inputs, (task) => task.id || null);
      expect(result[0].obsidianUrl).toBe('obsidian://open?vault=TestVault&file=Projects%2Ftasks.md');
    });

    it('should not set obsidianUrl when includeObsidianLink is false', () => {
      const settings: ObsidianSyncSettings = {
        syncTag: 'sync',
        newTasksDestination: 'Inbox.md',
        includeObsidianLink: false,
        getVaultName: () => 'TestVault',
      };
      const adapter = new ObsidianAdapter(dummyWrapper, settings);
      const inputs: TaskWithBody[] = [{
        task: {
          description: 'Test task',
          status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
          isDone: false,
          priority: '0',
          tags: [],
          taskLocation: { path: 'Projects/tasks.md', _lineNumber: 5 },
          originalMarkdown: '- [ ] Test task',
          createdDate: null,
          startDate: null,
          scheduledDate: null,
          dueDate: null,
          doneDate: null,
          cancelledDate: null,
          recurrence: null,
          id: 'test-id-2',
        },
        body: '',
        parentTask: null,
      }];

      const result = adapter.normalize(inputs, (task) => task.id || null);
      expect(result[0].obsidianUrl).toBeUndefined();
    });

    it('should encode vault name and file path with spaces', () => {
      const settings: ObsidianSyncSettings = {
        syncTag: 'sync',
        newTasksDestination: 'Inbox.md',
        includeObsidianLink: true,
        getVaultName: () => 'My Vault',
      };
      const adapter = new ObsidianAdapter(dummyWrapper, settings);
      const inputs: TaskWithBody[] = [{
        task: {
          description: 'Test task',
          status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
          isDone: false,
          priority: '0',
          tags: [],
          taskLocation: { path: 'My Folder/tasks file.md', _lineNumber: 1 },
          originalMarkdown: '- [ ] Test task',
          createdDate: null,
          startDate: null,
          scheduledDate: null,
          dueDate: null,
          doneDate: null,
          cancelledDate: null,
          recurrence: null,
          id: 'test-id-3',
        },
        body: '',
        parentTask: null,
      }];

      const result = adapter.normalize(inputs, (task) => task.id || null);
      expect(result[0].obsidianUrl).toBe('obsidian://open?vault=My%20Vault&file=My%20Folder%2Ftasks%20file.md');
    });
  });

  describe('normalize parentUid', () => {
    it('sets parentUid to the assigned id of the structural parent', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const parent = { id: 'p1', description: 'Parent', tags: ['#sync'],
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false, priority: '0', recurrence: null,
        taskLocation: { path: 'a.md', _lineNumber: 0 },
        originalMarkdown: '- [ ] Parent 🆔 p1 #sync',
        createdDate: null, startDate: null, scheduledDate: null,
        dueDate: null, doneDate: null, cancelledDate: null } as unknown as ObsidianTask;
      const child = { ...parent, id: 'c1', description: 'Child',
        originalMarkdown: '    - [ ] Child 🆔 c1' } as unknown as ObsidianTask;

      const tasks = adapter.normalize(
        [
          { task: parent, body: '', parentTask: null },
          { task: child, body: '', parentTask: parent },
        ],
        (t) => (t.id && t.id.length > 0 ? t.id : null),
      );
      const byUid = new Map(tasks.map(t => [t.uid, t]));
      expect(byUid.get('p1')!.parentUid ?? null).toBeNull();
      expect(byUid.get('c1')!.parentUid).toBe('p1');
    });

    it('falls back to null parentUid when the structural parent is not in the batch', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const orphanParent = { id: 'p9', description: 'Filtered parent', tags: [],
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false, priority: '0', recurrence: null,
        taskLocation: { path: 'a.md', _lineNumber: 0 },
        originalMarkdown: '- [ ] Filtered parent 🆔 p9',
        createdDate: null, startDate: null, scheduledDate: null,
        dueDate: null, doneDate: null, cancelledDate: null } as unknown as ObsidianTask;
      const child = { ...orphanParent, id: 'c9', description: 'Child',
        originalMarkdown: '    - [ ] Child 🆔 c9' } as unknown as ObsidianTask;

      const tasks = adapter.normalize(
        [{ task: child, body: '', parentTask: orphanParent }],
        (t) => (t.id && t.id.length > 0 ? t.id : null),
      );
      expect(tasks[0].parentUid ?? null).toBeNull();
    });
  });

  describe('applyChanges / writeBackIds — serialise in obsidian-tasks configured format', () => {
    const commonTask: CommonTask = {
      uid: 'task-001', title: 'Configured format task', status: 'TODO',
      dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
      priority: 'none', tags: [], recurrenceRule: '', body: '',
    };

    it('creates new tasks in dataview when obsidian-tasks is configured for dataview', async () => {
      let written = '';
      const createTask = jest.fn().mockImplementation((markdown: string) => { written = markdown; return Promise.resolve(); });
      const wrapper = {
        ...dummyWrapper, createTask,
        getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'dataview', globalFilter: '' }),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      expect(written).toContain('[id:: ');
      expect(written).not.toContain('🆔');
    });

    it('creates new tasks in emoji when obsidian-tasks is configured for emoji', async () => {
      let written = '';
      const createTask = jest.fn().mockImplementation((markdown: string) => { written = markdown; return Promise.resolve(); });
      const wrapper = {
        ...dummyWrapper, createTask,
        getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'emoji', globalFilter: '' }),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      expect(written).toContain('🆔 ');
      expect(written).not.toContain('[id:: ');
    });

    it('rewrites an updated task in the configured format regardless of its prior format', async () => {
      let written = '';
      const updateTaskInVault = jest.fn().mockImplementation((_t: unknown, markdown: string) => { written = markdown; return Promise.resolve(); });
      const existing = makeTask({ id: 'task-001', originalMarkdown: '- [ ] Old 📅 2025-01-01 🆔 task-001 #sync' });
      const wrapper = {
        ...dummyWrapper,
        findTaskById: jest.fn().mockReturnValue(existing),
        updateTaskInVault,
        getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'dataview', globalFilter: '' }),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'update', task: commonTask }]);

      expect(written).toContain('[id:: task-001]');
      expect(written).not.toContain('🆔');
      expect(written).not.toContain('📅');
    });

    it('writes back a generated id in the configured format', async () => {
      let written = '';
      const updateTaskInVault = jest.fn().mockImplementation((_t: unknown, markdown: string) => { written = markdown; return Promise.resolve(); });
      const noIdTask = makeTask({ id: '', originalMarkdown: '- [ ] New task #sync' });
      const wrapper = {
        ...dummyWrapper,
        extractId: jest.fn().mockReturnValue(null),
        updateTaskInVault,
        getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'dataview', globalFilter: '' }),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      const [normalized] = adapter.normalize([withBody(noIdTask)], () => null);
      await adapter.writeBackIds([normalized]);

      expect(updateTaskInVault).toHaveBeenCalledTimes(1);
      expect(written).toContain('[id:: ');
      expect(written).not.toContain('🆔');
    });
  });

  describe('applyChanges — complete', () => {
    it('calls executeToggleTaskDoneCommand for complete changes', async () => {
      const toggleFn = jest.fn().mockReturnValue(
        '- [x] Weekly review 🔁 every week 📅 2026-02-17 ✅ 2026-02-17 🆔 task-001'
      );
      const updateTaskInVault = jest.fn().mockResolvedValue(undefined);
      const wrapper = {
        ...dummyWrapper,
        getToggleCommand: jest.fn().mockReturnValue(toggleFn),
        updateTaskInVault,
        findTaskById: jest.fn().mockReturnValue(null),
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);
      const existingTask = makeTask({
        description: 'Weekly review',
        originalMarkdown: '- [ ] Weekly review 🔁 every week 📅 2026-02-17 🆔 task-001',
        id: 'task-001',
      });
      adapter.normalize([withBody(existingTask)], (t) => t.id || null);

      const result = await adapter.applyChanges([{
        type: 'complete',
        task: {
          uid: 'task-001',
          title: 'Weekly review',
          status: 'DONE',
          dueDate: '2026-02-17',
          startDate: null,
          scheduledDate: null,
          completedDate: '2026-02-17',
          priority: 'none',
          tags: [],
          recurrenceRule: 'FREQ=WEEKLY',
          body: '',
        },
      }]);

      expect(toggleFn).toHaveBeenCalledWith(
        existingTask.originalMarkdown,
        existingTask.taskLocation.path,
      );
      expect(updateTaskInVault).toHaveBeenCalled();
      expect(result.completionRemappings).toHaveLength(0); // single line = no remapping
    });

    it('returns completionRemapping when toggle produces new recurring task', async () => {
      const toggleResult = '- [x] Weekly review 🔁 every week 📅 2026-02-17 ✅ 2026-02-17 🆔 task-001\n- [ ] Weekly review 🔁 every week 📅 2026-02-24 🆔 task-002';
      const toggleFn = jest.fn().mockReturnValue(toggleResult);
      const wrapper = {
        ...dummyWrapper,
        getToggleCommand: jest.fn().mockReturnValue(toggleFn),
        updateTaskInVault: jest.fn().mockResolvedValue(undefined),
        findTaskById: jest.fn().mockReturnValue(null),
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);
      const existingTask = makeTask({
        description: 'Weekly review',
        originalMarkdown: '- [ ] Weekly review 🔁 every week 📅 2026-02-17 🆔 task-001',
        id: 'task-001',
      });
      adapter.normalize([withBody(existingTask)], (t) => t.id || null);

      const result = await adapter.applyChanges([{
        type: 'complete',
        task: {
          uid: 'task-001',
          title: 'Weekly review',
          status: 'DONE',
          dueDate: '2026-02-17',
          startDate: null,
          scheduledDate: null,
          completedDate: '2026-02-17',
          priority: 'none',
          tags: [],
          recurrenceRule: 'FREQ=WEEKLY',
          body: '',
        },
      }]);

      expect(result.completionRemappings).toEqual([{
        oldTaskId: 'task-001',
        newTaskId: 'task-002',
      }]);
    });

    it('returns completionRemapping when toggle produces new recurring task in dataview format', async () => {
      const toggleResult = '- [x] Weekly review [repeat:: every week] [due:: 2026-02-17] [completion:: 2026-02-17] [id:: task-001]\n- [ ] Weekly review [repeat:: every week] [due:: 2026-02-24] [id:: task-002]';
      const toggleFn = jest.fn().mockReturnValue(toggleResult);
      const wrapper = {
        ...dummyWrapper,
        getToggleCommand: jest.fn().mockReturnValue(toggleFn),
        updateTaskInVault: jest.fn().mockResolvedValue(undefined),
        findTaskById: jest.fn().mockReturnValue(null),
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);
      const existingTask = makeTask({
        description: 'Weekly review',
        originalMarkdown: '- [ ] Weekly review [repeat:: every week] [due:: 2026-02-17] [id:: task-001]',
        id: 'task-001',
      });
      adapter.normalize([withBody(existingTask)], (t) => t.id || null);

      const result = await adapter.applyChanges([{
        type: 'complete',
        task: {
          uid: 'task-001',
          title: 'Weekly review',
          status: 'DONE',
          dueDate: '2026-02-17',
          startDate: null,
          scheduledDate: null,
          completedDate: '2026-02-17',
          priority: 'none',
          tags: [],
          recurrenceRule: 'FREQ=WEEKLY',
          body: '',
        },
      }]);

      expect(result.completionRemappings).toEqual([{
        oldTaskId: 'task-001',
        newTaskId: 'task-002',
      }]);
    });

    it('throws when obsidian-tasks API is not available', async () => {
      const wrapper = {
        ...dummyWrapper,
        getToggleCommand: jest.fn().mockReturnValue(null),
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);
      const existingTask = makeTask({ id: 'task-001' });
      adapter.normalize([withBody(existingTask)], (t) => t.id || null);

      await expect(adapter.applyChanges([{
        type: 'complete',
        task: {
          uid: 'task-001',
          title: 'Test',
          status: 'DONE',
          dueDate: null,
          startDate: null,
          scheduledDate: null,
          completedDate: '2026-02-17',
          priority: 'none',
          tags: [],
          recurrenceRule: '',
          body: '',
        },
      }])).rejects.toThrow('obsidian-tasks API not available');
    });
  });

  describe('applyChanges subtask creates', () => {
    const baseCommonTask = {
      title: 'Task',
      status: 'TODO' as const,
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none' as const,
      tags: [],
      recurrenceRule: '',
      body: '',
      parentUid: null,
    };

    it('creates parent before child and calls insertSubtask for the child', async () => {
      const createTask = jest.fn().mockResolvedValue(undefined);
      const insertSubtask = jest.fn().mockResolvedValue(undefined);

      // The parent ObsidianTask returned by findTaskById after the parent is created.
      // Return it for any call — the first call stores it in createdIdByUid.created,
      // the second lookup resolves the child's parentTask from that stored entry.
      const mockParentObsidianTask = makeTask({ id: 'generated-parent-id', description: 'Parent' });
      const findTaskById = jest.fn().mockReturnValue(mockParentObsidianTask);

      const wrapper = {
        ...dummyWrapper,
        createTask,
        insertSubtask,
        findTaskById,
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);

      const changes = [
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-child', parentUid: 'cal-parent' } },
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-parent', parentUid: null } },
      ] as SyncChange[];

      await adapter.applyChanges(changes);

      expect(createTask).toHaveBeenCalledTimes(1);    // only the parent (top-level)
      expect(insertSubtask).toHaveBeenCalledTimes(1); // the child nested
    });

    it('returns createdMappings for both parent and child', async () => {
      const mockParentObsidianTask = makeTask({ id: 'p-id', description: 'Parent' });
      const findTaskById = jest.fn().mockReturnValue(mockParentObsidianTask);

      const wrapper = {
        ...dummyWrapper,
        createTask: jest.fn().mockResolvedValue(undefined),
        insertSubtask: jest.fn().mockResolvedValue(undefined),
        findTaskById,
      } as unknown as ObsidianTasksWrapper;

      const adapter = new ObsidianAdapter(wrapper, defaultSettings);

      const changes = [
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-child', parentUid: 'cal-parent' } },
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-parent', parentUid: null } },
      ] as SyncChange[];

      const result = await adapter.applyChanges(changes);

      expect(result.createdMappings).toHaveLength(2);
      const caldavUIDs = result.createdMappings.map(m => m.caldavUID).sort();
      expect(caldavUIDs).toEqual(['cal-child', 'cal-parent']);
    });
  });
});
