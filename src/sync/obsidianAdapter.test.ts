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

  describe('toCommonTask', () => {
    it('should convert a basic obsidian task', () => {
      const task = makeTask();
      const common = adapter.toCommonTask(task, '20250105-a4f');

      expect(common.uid).toBe('20250105-a4f');
      expect(common.title).toBe('Buy groceries');
      expect(common.status).toBe('TODO');
      expect(common.priority).toBe('none');
      expect(common.dueDate).toBeNull();
      expect(common.tags).toEqual(['sync']);
      expect(common.body).toBe('');
    });

    it('should include body when provided', () => {
      const task = makeTask();
      const common = adapter.toCommonTask(task, '20250105-a4f', 'Some body here');
      expect(common.body).toBe('Some body here');
    });

    it('should map done status', () => {
      const task = makeTask({ isDone: true });
      expect(adapter.toCommonTask(task, 'id').status).toBe('DONE');
    });

    it('should map priorities', () => {
      expect(adapter.toCommonTask(makeTask({ priority: '1' }), 'id').priority).toBe('highest');
      expect(adapter.toCommonTask(makeTask({ priority: '2' }), 'id').priority).toBe('high');
      expect(adapter.toCommonTask(makeTask({ priority: '3' }), 'id').priority).toBe('medium');
      expect(adapter.toCommonTask(makeTask({ priority: '4' }), 'id').priority).toBe('medium');
      expect(adapter.toCommonTask(makeTask({ priority: '5' }), 'id').priority).toBe('low');
      expect(adapter.toCommonTask(makeTask({ priority: '6' }), 'id').priority).toBe('lowest');
      expect(adapter.toCommonTask(makeTask({ priority: '' }), 'id').priority).toBe('none');
    });

    it('should clean description of tags and IDs', () => {
      const task = makeTask({
        description: 'Buy groceries #sync #shopping [id::test-001]',
      });
      const common = adapter.toCommonTask(task, 'test-001');
      expect(common.title).toBe('Buy groceries');
    });

    it('should clean # prefix from tags', () => {
      const task = makeTask({ tags: ['#sync', '#work', 'plain'] });
      expect(adapter.toCommonTask(task, 'id').tags).toEqual(['sync', 'work', 'plain']);
    });

    it('should format moment-like dates', () => {
      const mockDate = { format: (fmt: string) => '2025-01-15' };
      const task = makeTask({
        dueDate: mockDate,
        scheduledDate: mockDate,
        startDate: mockDate,
        doneDate: mockDate,
      });

      const common = adapter.toCommonTask(task, 'id');
      expect(common.dueDate).toBe('2025-01-15');
      expect(common.scheduledDate).toBe('2025-01-15');
      expect(common.startDate).toBe('2025-01-15');
      expect(common.completedDate).toBe('2025-01-15');
    });

    it('should handle string dates', () => {
      const task = makeTask({ dueDate: '2025-01-15' });
      expect(adapter.toCommonTask(task, 'id').dueDate).toBe('2025-01-15');
    });

    it('should extract recurrence rule from toText()', () => {
      const task = makeTask({
        recurrence: { toText: () => 'every day' },
      });
      expect(adapter.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=DAILY');
    });

    it('should extract weekly recurrence with day', () => {
      const task = makeTask({
        recurrence: { toText: () => 'every week on Monday' },
      });
      expect(adapter.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('should strip "when done" from recurrence text', () => {
      const task = makeTask({
        recurrence: { toText: () => 'every day when done' },
      });
      expect(adapter.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=DAILY');
    });

    it('should return empty recurrence for unparseable text', () => {
      const task = makeTask({
        recurrence: { toText: () => 'something unparseable' },
      });
      expect(adapter.toCommonTask(task, 'id').recurrenceRule).toBe('');
    });

    it('should map non-done status to TODO (IN_PROGRESS/CANCELLED not preserved)', () => {
      // obsidian-tasks only has isDone boolean, so IN_PROGRESS/CANCELLED from CalDAV
      // both map to TODO. This is a known limitation of the Obsidian data model.
      const task = makeTask({ isDone: false });
      expect(adapter.toCommonTask(task, 'id').status).toBe('TODO');
    });
  });

  describe('normalize', () => {
    it('should map pre-filtered inputs to CommonTask[]', () => {
      const inputs = [
        { ...withBody(makeTask({ description: 'Task 1' })), taskId: 'id-1' },
        { ...withBody(makeTask({ description: 'Task 2' })), taskId: 'id-2' },
      ];

      const { tasks } = adapter.normalize(inputs);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].uid).toBe('id-1');
      expect(tasks[1].uid).toBe('id-2');
    });

    it('should use provided taskId (no longer generates IDs)', () => {
      const inputs = [
        { ...withBody(makeTask({ id: '' })), taskId: 'assigned-id' },
      ];

      const { tasks, tasksById } = adapter.normalize(inputs);
      expect(tasks[0].uid).toBe('assigned-id');
      expect(tasksById.get('assigned-id')).toBe(inputs[0].task);
    });

    it('should include body from task inputs', () => {
      const inputs = [
        { task: makeTask({ id: 'task-1' }), body: 'Some body', taskId: 'task-1' },
      ];
      const { tasks } = adapter.normalize(inputs);
      expect(tasks[0].body).toBe('Some body');
    });

    it('should default to empty body', () => {
      const inputs = [
        { ...withBody(makeTask()), taskId: 'task-1' },
      ];
      const { tasks } = adapter.normalize(inputs);
      expect(tasks[0].body).toBe('');
    });

    it('should build tasksById map', () => {
      const task = makeTask({ description: 'Test' });
      const inputs = [{ task, body: '', taskId: 'my-id' }];

      const { tasksById } = adapter.normalize(inputs);
      expect(tasksById.get('my-id')).toBe(task);
    });
  });

  describe('getContentHash', () => {
    it('should return trimmed original markdown', () => {
      const task = makeTask({ originalMarkdown: '  - [ ] Task  ' });
      expect(adapter.getContentHash(task)).toBe('- [ ] Task');
    });
  });

  describe('toTaskFields', () => {
    it('should reverse-map a TODO CommonTask', () => {
      const common = {
        uid: 'task-123',
        title: 'Buy groceries',
        status: 'TODO' as const,
        dueDate: '2025-01-15',
        startDate: '2025-01-08',
        scheduledDate: '2025-01-10',
        completedDate: null,
        priority: 'high' as const,
        tags: ['sync', 'shopping'],
        recurrenceRule: '',
        body: '',
      };

      const fields = adapter.toTaskFields(common);
      expect(fields.description).toBe('Buy groceries');
      expect(fields.id).toBe('task-123');
      expect(fields.isDone).toBe(false);
      expect(fields.priority).toBe('2');
      expect(fields.tags).toEqual(['#sync', '#shopping']);
      expect(fields.dueDate).toBe('2025-01-15');
      expect(fields.startDate).toBe('2025-01-08');
      expect(fields.scheduledDate).toBe('2025-01-10');
      expect(fields.doneDate).toBeNull();
    });

    it('should reverse-map a DONE CommonTask', () => {
      const common = {
        uid: 'task-456',
        title: 'Done task',
        status: 'DONE' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: '2025-01-20',
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const fields = adapter.toTaskFields(common);
      expect(fields.isDone).toBe(true);
      expect(fields.doneDate).toBe('2025-01-20');
      expect(fields.priority).toBe('0');
      expect(fields.tags).toEqual([]);
    });

    it('should reverse-map all priorities', () => {
      const base = {
        uid: 'id', title: 'T', status: 'TODO' as const,
        dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
        tags: [], recurrenceRule: '', body: '',
      };

      expect(adapter.toTaskFields({ ...base, priority: 'highest' }).priority).toBe('1');
      expect(adapter.toTaskFields({ ...base, priority: 'high' }).priority).toBe('2');
      expect(adapter.toTaskFields({ ...base, priority: 'medium' }).priority).toBe('3');
      expect(adapter.toTaskFields({ ...base, priority: 'low' }).priority).toBe('5');
      expect(adapter.toTaskFields({ ...base, priority: 'lowest' }).priority).toBe('6');
      expect(adapter.toTaskFields({ ...base, priority: 'none' }).priority).toBe('0');
    });

    it('should add # prefix to tags', () => {
      const common = {
        uid: 'id', title: 'T', status: 'TODO' as const,
        dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
        priority: 'none' as const, tags: ['work', 'urgent'], recurrenceRule: '', body: '',
      };

      expect(adapter.toTaskFields(common).tags).toEqual(['#work', '#urgent']);
    });
  });
});
