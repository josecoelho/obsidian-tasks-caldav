import { ObsidianMapper } from './obsidianMapper';
import { ObsidianTask } from './obsidianTasksWrapper';
import { CommonTask } from '../sync/types';

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

describe('ObsidianMapper', () => {
  const mapper = new ObsidianMapper();

  describe('toCommonTask', () => {
    it('should convert a basic obsidian task', () => {
      const task = makeTask();
      const common = mapper.toCommonTask(task, '20250105-a4f');

      expect(common.uid).toBe('20250105-a4f');
      expect(common.title).toBe('Buy groceries');
      expect(common.status).toBe('TODO');
      expect(common.priority).toBe('none');
      expect(common.dueDate).toBeNull();
      expect(common.tags).toEqual(['sync']);
      expect(common.body).toBe('');
    });

    it('should include body when provided', () => {
      const common = mapper.toCommonTask(makeTask(), '20250105-a4f', 'Some body here');
      expect(common.body).toBe('Some body here');
    });

    it('should map done status', () => {
      const task = makeTask({ isDone: true });
      expect(mapper.toCommonTask(task, 'id').status).toBe('DONE');
    });

    it('should map priorities', () => {
      expect(mapper.toCommonTask(makeTask({ priority: '1' }), 'id').priority).toBe('highest');
      expect(mapper.toCommonTask(makeTask({ priority: '2' }), 'id').priority).toBe('high');
      expect(mapper.toCommonTask(makeTask({ priority: '3' }), 'id').priority).toBe('medium');
      expect(mapper.toCommonTask(makeTask({ priority: '5' }), 'id').priority).toBe('low');
      expect(mapper.toCommonTask(makeTask({ priority: '6' }), 'id').priority).toBe('lowest');
      expect(mapper.toCommonTask(makeTask({ priority: '' }), 'id').priority).toBe('none');
    });

    it('should clean description of tags and IDs', () => {
      const task = makeTask({
        description: 'Buy groceries #sync #shopping [id::test-001]',
      });
      expect(mapper.toCommonTask(task, 'test-001').title).toBe('Buy groceries');
    });

    it('should clean # prefix from tags', () => {
      const task = makeTask({ tags: ['#sync', '#work', 'plain'] });
      expect(mapper.toCommonTask(task, 'id').tags).toEqual(['sync', 'work', 'plain']);
    });

    it('should format moment-like dates', () => {
      const mockDate = { format: () => '2025-01-15' };
      const task = makeTask({
        dueDate: mockDate,
        scheduledDate: mockDate,
        startDate: mockDate,
        doneDate: mockDate,
      });

      const common = mapper.toCommonTask(task, 'id');
      expect(common.dueDate).toBe('2025-01-15');
      expect(common.scheduledDate).toBe('2025-01-15');
      expect(common.startDate).toBe('2025-01-15');
      expect(common.completedDate).toBe('2025-01-15');
    });

    it('should handle string dates', () => {
      const task = makeTask({ dueDate: '2025-01-15' });
      expect(mapper.toCommonTask(task, 'id').dueDate).toBe('2025-01-15');
    });

    it('should extract recurrence rule from toText()', () => {
      const task = makeTask({ recurrence: { toText: () => 'every day' } });
      expect(mapper.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=DAILY');
    });

    it('should strip "when done" from recurrence text', () => {
      const task = makeTask({ recurrence: { toText: () => 'every day when done' } });
      expect(mapper.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=DAILY');
    });

    it('should return empty recurrence for unparseable text', () => {
      const task = makeTask({ recurrence: { toText: () => 'something unparseable' } });
      expect(mapper.toCommonTask(task, 'id').recurrenceRule).toBe('');
    });
  });

  describe('toMarkdown', () => {
    const baseTask: CommonTask = {
      uid: 'test-id', title: 'Test task', status: 'TODO',
      dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
      priority: 'none', tags: [], recurrenceRule: '', body: '',
    };

    it('should create markdown with TODO status', () => {
      expect(mapper.toMarkdown(baseTask, 'sync'))
        .toBe('- [ ] Test task 🆔 test-id #sync');
    });

    it('should create markdown with DONE status', () => {
      const task = { ...baseTask, status: 'DONE' as const };
      expect(mapper.toMarkdown(task, 'sync'))
        .toBe('- [x] Test task 🆔 test-id #sync');
    });

    it('should include all dates in correct order', () => {
      const task: CommonTask = {
        ...baseTask, status: 'DONE',
        dueDate: '2025-01-15', startDate: '2025-01-08',
        scheduledDate: '2025-01-10', completedDate: '2025-01-12',
      };
      const md = mapper.toMarkdown(task, 'sync');
      expect(md).toContain('🛫 2025-01-08');
      expect(md).toContain('⏳ 2025-01-10');
      expect(md).toContain('📅 2025-01-15');
      expect(md).toContain('✅ 2025-01-12');
      expect(md.indexOf('🛫')).toBeLessThan(md.indexOf('⏳'));
      expect(md.indexOf('⏳')).toBeLessThan(md.indexOf('📅'));
    });

    it('should work without sync tag', () => {
      const md = mapper.toMarkdown(baseTask, '');
      expect(md).toBe('- [ ] Test task 🆔 test-id');
      expect(md).not.toContain('#');
    });

    it('should add # prefix to tag if missing', () => {
      expect(mapper.toMarkdown(baseTask, 'sync')).toContain('#sync');
      expect(mapper.toMarkdown(baseTask, '#sync')).toContain('#sync');
    });

    it('should include recurrence rule as human-readable text', () => {
      const task = { ...baseTask, recurrenceRule: 'FREQ=DAILY', dueDate: '2026-02-15' };
      const md = mapper.toMarkdown(task, 'sync');
      expect(md).toContain('🔁 every day');
      expect(md).not.toContain('FREQ=DAILY');
    });

    it('should place recurrence before ID and tag', () => {
      const task = { ...baseTask, recurrenceRule: 'FREQ=DAILY', dueDate: '2026-02-15' };
      const md = mapper.toMarkdown(task, 'sync');
      expect(md.indexOf('🔁')).toBeLessThan(md.indexOf('🆔'));
      expect(md.indexOf('🆔')).toBeLessThan(md.indexOf('#sync'));
    });

    it('should skip recurrence for unparseable RRULE', () => {
      const task = { ...baseTask, recurrenceRule: 'INVALID_RRULE' };
      expect(mapper.toMarkdown(task, 'sync')).not.toContain('🔁');
    });

    it('should append body as indented bullets', () => {
      const task = { ...baseTask, uid: 'id', title: 'Task with body', body: 'First note\nSecond note' };
      expect(mapper.toMarkdown(task, 'sync'))
        .toBe('- [ ] Task with body 🆔 id #sync\n    - First note\n    - Second note');
    });

    it('should not append body lines when body is empty', () => {
      const md = mapper.toMarkdown(baseTask, 'sync');
      expect(md).not.toContain('\n');
    });

    it('should include non-sync tags in markdown output', () => {
      const task = { ...baseTask, tags: ['sync', 'shopping', 'errands'] };
      const md = mapper.toMarkdown(task, 'sync');
      expect(md).toContain('#shopping');
      expect(md).toContain('#errands');
    });

    it('should not duplicate the sync tag', () => {
      const task = { ...baseTask, tags: ['sync', 'shopping'] };
      const md = mapper.toMarkdown(task, 'sync');
      const syncCount = (md.match(/#sync/g) || []).length;
      expect(syncCount).toBe(1);
    });

    it('should place non-sync tags before date emojis', () => {
      const task = { ...baseTask, tags: ['sync', 'shopping'], dueDate: '2025-01-15' };
      const md = mapper.toMarkdown(task, 'sync');
      expect(md.indexOf('#shopping')).toBeLessThan(md.indexOf('📅'));
    });
  });

});
