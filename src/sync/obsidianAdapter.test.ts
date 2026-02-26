import { ObsidianAdapter, TaskWithBody } from './obsidianAdapter';
import { ObsidianTask } from '../tasks/obsidianTasksWrapper';

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

describe('ObsidianAdapter', () => {
  const extractId = (task: ObsidianTask): string | null => task.id || null;

  describe('normalize', () => {
    it('should map inputs to CommonTask[] using existing IDs', () => {
      const adapter = new ObsidianAdapter();
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
      const adapter = new ObsidianAdapter();
      const inputs = [
        withBody(makeTask({ id: '' })),
      ];

      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].uid).toBeTruthy();
      expect(tasks[0].uid.length).toBeGreaterThan(0);
    });

    it('should include body from task inputs', () => {
      const adapter = new ObsidianAdapter();
      const inputs = [
        { task: makeTask({ id: 'task-1' }), body: 'Some body' },
      ];
      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('Some body');
    });

    it('should default to empty body', () => {
      const adapter = new ObsidianAdapter();
      const inputs = [
        withBody(makeTask({ id: 'task-1' })),
      ];
      const tasks = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('');
    });
  });

  describe('findOriginalTask', () => {
    it('should return the original ObsidianTask after normalize', () => {
      const adapter = new ObsidianAdapter();
      const task = makeTask({ description: 'Test', id: 'my-id' });
      adapter.normalize([{ task, body: '' }], extractId);

      expect(adapter.findOriginalTask('my-id')).toBe(task);
    });

    it('should return undefined for unknown IDs', () => {
      const adapter = new ObsidianAdapter();
      adapter.normalize([], extractId);

      expect(adapter.findOriginalTask('unknown')).toBeUndefined();
    });

    it('should find tasks with generated IDs', () => {
      const adapter = new ObsidianAdapter();
      const task = makeTask({ id: '' });
      const tasks = adapter.normalize([withBody(task)], extractId);

      expect(adapter.findOriginalTask(tasks[0].uid)).toBe(task);
    });
  });
});
