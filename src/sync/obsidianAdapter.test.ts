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
  const adapter = new ObsidianAdapter();

  describe('normalize', () => {
    const extractId = (task: ObsidianTask): string | null => task.id || null;

    it('should map inputs to CommonTask[] using existing IDs', () => {
      const inputs = [
        withBody(makeTask({ description: 'Task 1', id: 'id-1' })),
        withBody(makeTask({ description: 'Task 2', id: 'id-2' })),
      ];

      const { tasks } = adapter.normalize(inputs, extractId);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].uid).toBe('id-1');
      expect(tasks[1].uid).toBe('id-2');
    });

    it('should generate IDs for tasks without existing IDs', () => {
      const inputs = [
        withBody(makeTask({ id: '' })),
      ];

      const { tasks, tasksById } = adapter.normalize(inputs, extractId);
      // Should have generated an ID
      expect(tasks[0].uid).toBeTruthy();
      expect(tasks[0].uid.length).toBeGreaterThan(0);
      expect(tasksById.get(tasks[0].uid)).toBe(inputs[0].task);
    });

    it('should include body from task inputs', () => {
      const inputs = [
        { task: makeTask({ id: 'task-1' }), body: 'Some body' },
      ];
      const { tasks } = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('Some body');
    });

    it('should default to empty body', () => {
      const inputs = [
        withBody(makeTask({ id: 'task-1' })),
      ];
      const { tasks } = adapter.normalize(inputs, extractId);
      expect(tasks[0].body).toBe('');
    });

    it('should build tasksById map', () => {
      const task = makeTask({ description: 'Test', id: 'my-id' });
      const inputs = [{ task, body: '' }];

      const { tasksById } = adapter.normalize(inputs, extractId);
      expect(tasksById.get('my-id')).toBe(task);
    });
  });
});
