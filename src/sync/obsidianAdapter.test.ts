import { ObsidianAdapter, TaskWithBody } from './obsidianAdapter';
import { ObsidianTask } from '../tasks/taskManager';

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
    it('should filter by sync tag', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ description: 'Task 1', tags: ['#sync'] })),
        withBody(makeTask({ description: 'Task 2', tags: ['#work'], id: '20250105-b00', originalMarkdown: '- [ ] Task 2 🆔 20250105-b00 #work' })),
        withBody(makeTask({ description: 'Task 3', tags: ['#sync', '#work'], id: '20250105-c00', originalMarkdown: '- [ ] Task 3 🆔 20250105-c00 #sync #work' })),
      ];

      const { tasks } = adapter.normalize(inputs, 'sync');
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('Task 1');
      expect(tasks[1].title).toBe('Task 3');
    });

    it('should return all tasks when syncTag is empty', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ description: 'Task 1', tags: ['#work'], id: 'id1', originalMarkdown: '- [ ] Task 1 🆔 id1 #work' })),
        withBody(makeTask({ description: 'Task 2', tags: [], id: 'id2', originalMarkdown: '- [ ] Task 2 🆔 id2' })),
      ];

      const { tasks } = adapter.normalize(inputs, '');
      expect(tasks).toHaveLength(2);
    });

    it('should generate IDs for tasks without them', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ id: '', originalMarkdown: '- [ ] No ID #sync' })),
      ];

      const { tasks, tasksById } = adapter.normalize(inputs, 'sync');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].uid).toMatch(/^\d{8}-[0-9a-f]{3}$/);
      // tasksById should map the generated ID to the original task
      expect(tasksById.get(tasks[0].uid)).toBe(inputs[0].task);
    });

    it('should preserve existing IDs', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ id: '20250105-a4f' })),
      ];

      const { tasks, tasksById } = adapter.normalize(inputs, 'sync');
      expect(tasks[0].uid).toBe('20250105-a4f');
      expect(tasksById.get('20250105-a4f')).toBe(inputs[0].task);
    });

    it('should handle case-insensitive tag matching', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ tags: ['#SYNC'], id: 'id1', originalMarkdown: '- [ ] Task 🆔 id1 #SYNC' })),
        withBody(makeTask({ tags: ['#Sync'], id: 'id2', originalMarkdown: '- [ ] Task 🆔 id2 #Sync' })),
      ];

      const { tasks } = adapter.normalize(inputs, 'sync');
      expect(tasks).toHaveLength(2);
    });

    it('should handle syncTag with # prefix', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ tags: ['#sync'] })),
      ];

      const { tasks } = adapter.normalize(inputs, '#sync');
      expect(tasks).toHaveLength(1);
    });

    it('should include body from task inputs', () => {
      const inputs: TaskWithBody[] = [
        { task: makeTask({ id: 'task-1', tags: ['#sync'] }), body: 'Some body' },
      ];
      const { tasks } = adapter.normalize(inputs, 'sync');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].body).toBe('Some body');
    });

    it('should default to empty body', () => {
      const inputs: TaskWithBody[] = [
        withBody(makeTask({ id: 'task-1', tags: ['#sync'] })),
      ];
      const { tasks } = adapter.normalize(inputs, 'sync');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].body).toBe('');
    });
  });

  describe('toMarkdown', () => {
    it('should create markdown with TODO status', () => {
      const task = {
        uid: 'test-id',
        title: 'Test task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      expect(adapter.toMarkdown(task, 'test-id', 'sync'))
        .toBe('- [ ] Test task 🆔 test-id #sync');
    });

    it('should create markdown with DONE status', () => {
      const task = {
        uid: 'test-id',
        title: 'Done task',
        status: 'DONE' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      expect(adapter.toMarkdown(task, 'test-id', 'sync'))
        .toBe('- [x] Done task 🆔 test-id #sync');
    });

    it('should include all dates in correct order', () => {
      const task = {
        uid: 'id',
        title: 'Task',
        status: 'DONE' as const,
        dueDate: '2025-01-15',
        startDate: '2025-01-08',
        scheduledDate: '2025-01-10',
        completedDate: '2025-01-12',
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).toContain('🛫 2025-01-08');
      expect(md).toContain('⏳ 2025-01-10');
      expect(md).toContain('📅 2025-01-15');
      expect(md).toContain('✅ 2025-01-12');
      // Verify order: start before scheduled before due
      const startIdx = md.indexOf('🛫');
      const schedIdx = md.indexOf('⏳');
      const dueIdx = md.indexOf('📅');
      expect(startIdx).toBeLessThan(schedIdx);
      expect(schedIdx).toBeLessThan(dueIdx);
    });

    it('should work without sync tag', () => {
      const task = {
        uid: 'id',
        title: 'No tag',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const md = adapter.toMarkdown(task, 'id', '');
      expect(md).toBe('- [ ] No tag 🆔 id');
      expect(md).not.toContain('#');
    });

    it('should add # prefix to tag if missing', () => {
      const task = {
        uid: 'id',
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
      };

      const without = adapter.toMarkdown(task, 'id', 'sync');
      const with_ = adapter.toMarkdown(task, 'id', '#sync');
      expect(without).toContain('#sync');
      expect(with_).toContain('#sync');
    });

    it('should not include priority in markdown (known limitation)', () => {
      const task = {
        uid: 'id',
        title: 'High priority task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'high' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      // Priority is not mapped to obsidian-tasks emoji format — data is lost in CalDAV→Obsidian direction
      expect(md).not.toContain('⏫');
      expect(md).not.toContain('🔼');
    });

    it('should include recurrence rule as human-readable text', () => {
      const task = {
        uid: 'id',
        title: 'Recurring task',
        status: 'TODO' as const,
        dueDate: '2026-02-15',
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: 'FREQ=DAILY',
        body: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).toContain('🔁 every day');
      // RRULE format should NOT appear in markdown
      expect(md).not.toContain('FREQ=DAILY');
    });

    it('should include weekly recurrence with day', () => {
      const task = {
        uid: 'id',
        title: 'Weekly task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        body: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).toContain('🔁 every week on Monday');
    });

    it('should place recurrence before ID and tag', () => {
      const task = {
        uid: 'id',
        title: 'Task',
        status: 'TODO' as const,
        dueDate: '2026-02-15',
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: 'FREQ=DAILY',
        body: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      const recIdx = md.indexOf('🔁');
      const idIdx = md.indexOf('🆔');
      const tagIdx = md.indexOf('#sync');
      expect(recIdx).toBeLessThan(idIdx);
      expect(idIdx).toBeLessThan(tagIdx);
    });

    it('should skip recurrence for unparseable RRULE', () => {
      const task = {
        uid: 'id',
        title: 'Task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: 'INVALID_RRULE',
        body: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).not.toContain('🔁');
    });

    it('should append body as indented bullets', () => {
      const task = {
        uid: 'id',
        title: 'Task with body',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: 'First note\nSecond note',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).toBe('- [ ] Task with body 🆔 id #sync\n    - First note\n    - Second note');
    });

    it('should not append body lines when body is empty', () => {
      const task = {
        uid: 'id',
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
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      expect(md).toBe('- [ ] Task 🆔 id #sync');
      expect(md).not.toContain('\n');
    });
  });

  describe('extractBodyFromFile', () => {
    it('should extract indented bullet lines below a task (4-space indent)', () => {
      const content = '- [ ] Task\n    - Note one\n    - Note two\nNext line';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('Note one\nNote two');
    });

    it('should extract with 2-space indent', () => {
      const content = '- [ ] Task\n  - Note one\n  - Note two';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('Note one\nNote two');
    });

    it('should extract with tab indent', () => {
      const content = '- [ ] Task\n\t- Note one\n\t- Note two';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('Note one\nNote two');
    });

    it('should stop at non-indented line', () => {
      const content = '- [ ] Task\n    - Note one\nNot a note\n    - Not included';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('Note one');
    });

    it('should stop at end of file', () => {
      const content = '- [ ] Task\n    - Note one\n    - Note two';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('Note one\nNote two');
    });

    it('should return empty string when no notes', () => {
      const content = '- [ ] Task\n- [ ] Next task';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('');
    });

    it('should handle task in middle of file', () => {
      const content = '# Header\n- [ ] First task\n- [ ] Target task\n    - Note for target\n- [ ] Other task';
      const notes = adapter.extractBodyFromFile(content, 2);
      expect(notes).toBe('Note for target');
    });

    it('should not treat non-bullet indented lines as notes', () => {
      const content = '- [ ] Task\n    Not a bullet line\n    - Actual note';
      const notes = adapter.extractBodyFromFile(content, 0);
      expect(notes).toBe('');
    });
  });

  describe('extractId', () => {
    it('should prefer task.id field', () => {
      const task = makeTask({ id: 'from-field' });
      expect(adapter.extractId(task)).toBe('from-field');
    });

    it('should return null when task.id is empty', () => {
      const task = makeTask({ id: '' });
      expect(adapter.extractId(task)).toBeNull();
    });
  });

  describe('getContentHash', () => {
    it('should return trimmed original markdown', () => {
      const task = makeTask({ originalMarkdown: '  - [ ] Task  ' });
      expect(adapter.getContentHash(task)).toBe('- [ ] Task');
    });
  });
});
