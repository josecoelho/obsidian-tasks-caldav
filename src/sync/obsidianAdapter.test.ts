import { ObsidianAdapter, ObsidianSyncSettings, TaskWithBody } from './obsidianAdapter';
import { ObsidianTask, ObsidianTasksWrapper } from '../tasks/obsidianTasksWrapper';
// CommonTask used indirectly via adapter types

function makeTask(overrides: Partial<ObsidianTask> = {}): ObsidianTask {
  return {
    description: 'Buy groceries',
    status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
    isDone: false,
    priority: '0',
    tags: ['#sync'],
    taskLocation: { _tasksFile: { _path: 'Tasks.md' }, _lineNumber: 1 },
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
        existingTask.taskLocation._tasksFile._path,
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
