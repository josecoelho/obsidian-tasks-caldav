import { ObsidianAdapter, ObsidianSyncSettings, TaskWithBody } from './obsidianAdapter';
import { ObsidianTask, ObsidianTasksWrapper } from '../tasks/obsidianTasksWrapper';
import { CommonTask } from './types';

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
  return { task, body };
}

const dummyWrapper = {
  getAllTasksWithBody: jest.fn().mockResolvedValue([]),
  filterByTag: jest.fn().mockImplementation((inputs: TaskWithBody[]) => inputs),
  extractId: jest.fn().mockImplementation((task: ObsidianTask) => task.id || null),
  findTaskById: jest.fn().mockReturnValue(null),
  createTask: jest.fn().mockResolvedValue(undefined),
  updateTaskInVault: jest.fn().mockResolvedValue(undefined),
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
        { task: makeTask({ id: 'task-1' }), body: 'Some body' },
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

  describe('fetchTasks strips reserved identifiers from CommonTask.tags', () => {
    function makeWrapper(getAllTasks: TaskWithBody[], globalFilter = ''): ObsidianTasksWrapper {
      return {
        ...dummyWrapper,
        getAllTasksWithBody: jest.fn().mockResolvedValue(getAllTasks),
        filterByTag: jest.fn().mockImplementation((inputs: TaskWithBody[]) => inputs),
        extractId: jest.fn().mockImplementation((task: ObsidianTask) => task.id || null),
        getTasksPluginConfig: jest.fn().mockResolvedValue({ format: 'emoji', globalFilter }),
      } as unknown as ObsidianTasksWrapper;
    }

    it('strips the configured syncTag', async () => {
      const task = makeTask({ id: 't1', tags: ['#sync', '#urgent'] });
      const adapter = new ObsidianAdapter(makeWrapper([withBody(task)]), { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      const tasks = await adapter.fetchTasks();

      expect(tasks[0].tags).toEqual(['urgent']);
    });

    it('also strips obsidian-tasks globalFilter even when present in task.tags', async () => {
      // Defends against obsidian-tasks behavior changes; obsidian-tasks
      // normally pre-strips its globalFilter, but if it ever stopped, we
      // must not leak the identifier into outgoing tags.
      const task = makeTask({ id: 't1', tags: ['#task', '#sync', '#urgent'] });
      const adapter = new ObsidianAdapter(makeWrapper([withBody(task)], '#task'), { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      const tasks = await adapter.fetchTasks();

      expect(tasks[0].tags).toEqual(['urgent']);
    });

    it('preserves user-content tags that happen to overlap with neither identifier', async () => {
      const task = makeTask({ id: 't1', tags: ['#sync', '#work', '#urgent'] });
      const adapter = new ObsidianAdapter(makeWrapper([withBody(task)], '#task'), { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      const tasks = await adapter.fetchTasks();

      expect(tasks[0].tags.sort()).toEqual(['urgent', 'work']);
    });
  });

  describe('fetchTasks ID generation', () => {
    afterEach(() => jest.restoreAllMocks());

    it('never generates an ID owned by a task outside the sync filter (#115)', async () => {
      const draws = [new Uint8Array([0x12, 0x34]), new Uint8Array([0xab, 0xcd])];
      jest.spyOn(crypto, 'getRandomValues').mockImplementation(<T,>(arr: T): T => {
        (arr as Uint8Array).set(draws.shift()!);
        return arr;
      });
      const now = new Date();
      const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

      const unfiltered = makeTask({ id: `${today}-1234`, tags: ['#other'] });
      const newTask = makeTask({ id: '', tags: ['#sync'] });
      const wrapper = {
        ...dummyWrapper,
        getAllTasksWithBody: jest.fn().mockResolvedValue([withBody(unfiltered), withBody(newTask)]),
        filterByTag: jest.fn().mockImplementation((inputs: TaskWithBody[]) =>
          inputs.filter(({ task }) => task.tags.includes('#sync'))),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, defaultSettings);

      const tasks = await adapter.fetchTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].uid).toBe(`${today}-abcd`);
    });
  });

  describe('findOriginalTask', () => {
    it('should return the original ObsidianTask after normalize', () => {
      const adapter = new ObsidianAdapter(dummyWrapper, defaultSettings);
      const task = makeTask({ description: 'Test', id: 'my-id' });
      adapter.normalize([{ task, body: '' }], extractId);

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
      }];

      const result = adapter.normalize(inputs, (task) => task.id || null);
      expect(result[0].obsidianUrl).toBe('obsidian://open?vault=My%20Vault&file=My%20Folder%2Ftasks%20file.md');
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
});
