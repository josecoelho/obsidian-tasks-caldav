import { ObsidianAdapter } from './obsidianAdapter';

function makeTask(overrides: Partial<any> = {}): any {
  return {
    description: 'Buy groceries',
    status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
    isDone: false,
    priority: '0',
    tags: ['#sync'],
    taskLocation: { _tasksFile: { _path: 'Tasks.md' }, _lineNumber: 1 },
    originalMarkdown: '- [ ] Buy groceries %%[id::20250105-a4f]%% #sync',
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

describe('ObsidianAdapter', () => {
  const adapter = new ObsidianAdapter();

  describe('toCommonTask', () => {
    it('should convert a basic obsidian task', () => {
      const task = makeTask();
      const common = adapter.toCommonTask(task, '20250105-a4f');

      expect(common.uid).toBe('20250105-a4f');
      expect(common.description).toBe('Buy groceries');
      expect(common.status).toBe('TODO');
      expect(common.priority).toBe('none');
      expect(common.dueDate).toBeNull();
      expect(common.tags).toEqual(['sync']);
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
        description: 'Buy groceries #sync #shopping %%[id::test-001]%%',
      });
      const common = adapter.toCommonTask(task, 'test-001');
      expect(common.description).toBe('Buy groceries');
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

    it('should extract recurrence rule', () => {
      const task = makeTask({ recurrence: { toText: () => 'FREQ=DAILY;COUNT=5' } });
      expect(adapter.toCommonTask(task, 'id').recurrenceRule).toBe('FREQ=DAILY;COUNT=5');
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
      const tasks = [
        makeTask({ description: 'Task 1', tags: ['#sync'] }),
        makeTask({ description: 'Task 2', tags: ['#work'], id: '20250105-b00', originalMarkdown: '- [ ] Task 2 %%[id::20250105-b00]%% #work' }),
        makeTask({ description: 'Task 3', tags: ['#sync', '#work'], id: '20250105-c00', originalMarkdown: '- [ ] Task 3 %%[id::20250105-c00]%% #sync #work' }),
      ];

      const result = adapter.normalize(tasks, 'sync');
      expect(result).toHaveLength(2);
      expect(result[0].description).toBe('Task 1');
      expect(result[1].description).toBe('Task 3');
    });

    it('should return all tasks when syncTag is empty', () => {
      const tasks = [
        makeTask({ description: 'Task 1', tags: ['#work'], id: 'id1', originalMarkdown: '- [ ] Task 1 %%[id::id1]%% #work' }),
        makeTask({ description: 'Task 2', tags: [], id: 'id2', originalMarkdown: '- [ ] Task 2 %%[id::id2]%%' }),
      ];

      const result = adapter.normalize(tasks, '');
      expect(result).toHaveLength(2);
    });

    it('should skip tasks without IDs', () => {
      const tasks = [
        makeTask({ id: '', originalMarkdown: '- [ ] No ID #sync' }),
      ];

      const result = adapter.normalize(tasks, 'sync');
      expect(result).toHaveLength(0);
    });

    it('should handle case-insensitive tag matching', () => {
      const tasks = [
        makeTask({ tags: ['#SYNC'], id: 'id1', originalMarkdown: '- [ ] Task %%[id::id1]%% #SYNC' }),
        makeTask({ tags: ['#Sync'], id: 'id2', originalMarkdown: '- [ ] Task %%[id::id2]%% #Sync' }),
      ];

      const result = adapter.normalize(tasks, 'sync');
      expect(result).toHaveLength(2);
    });

    it('should handle syncTag with # prefix', () => {
      const tasks = [
        makeTask({ tags: ['#sync'] }),
      ];

      const result = adapter.normalize(tasks, '#sync');
      expect(result).toHaveLength(1);
    });
  });

  describe('toMarkdown', () => {
    it('should create markdown with TODO status', () => {
      const task = {
        uid: 'test-id',
        description: 'Test task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
      };

      expect(adapter.toMarkdown(task, 'test-id', 'sync'))
        .toBe('- [ ] Test task %%[id::test-id]%% #sync');
    });

    it('should create markdown with DONE status', () => {
      const task = {
        uid: 'test-id',
        description: 'Done task',
        status: 'DONE' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
      };

      expect(adapter.toMarkdown(task, 'test-id', 'sync'))
        .toBe('- [x] Done task %%[id::test-id]%% #sync');
    });

    it('should include all dates in correct order', () => {
      const task = {
        uid: 'id',
        description: 'Task',
        status: 'DONE' as const,
        dueDate: '2025-01-15',
        startDate: '2025-01-08',
        scheduledDate: '2025-01-10',
        completedDate: '2025-01-12',
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
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
        description: 'No tag',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
      };

      const md = adapter.toMarkdown(task, 'id', '');
      expect(md).toBe('- [ ] No tag %%[id::id]%%');
      expect(md).not.toContain('#');
    });

    it('should add # prefix to tag if missing', () => {
      const task = {
        uid: 'id',
        description: 'Task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
      };

      const without = adapter.toMarkdown(task, 'id', 'sync');
      const with_ = adapter.toMarkdown(task, 'id', '#sync');
      expect(without).toContain('#sync');
      expect(with_).toContain('#sync');
    });

    it('should not include priority in markdown (known limitation)', () => {
      const task = {
        uid: 'id',
        description: 'High priority task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'high' as const,
        tags: [],
        recurrenceRule: '',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      // Priority is not mapped to obsidian-tasks emoji format — data is lost in CalDAV→Obsidian direction
      expect(md).not.toContain('⏫');
      expect(md).not.toContain('🔼');
    });

    it('should not include recurrence rule in markdown (known limitation)', () => {
      const task = {
        uid: 'id',
        description: 'Recurring task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: 'FREQ=DAILY',
      };
      const md = adapter.toMarkdown(task, 'id', 'sync');
      // Recurrence rules are not mapped to obsidian-tasks format — data is lost
      expect(md).not.toContain('🔁');
      expect(md).not.toContain('FREQ=DAILY');
    });
  });

  describe('extractId', () => {
    it('should prefer task.id field', () => {
      const task = makeTask({ id: 'from-field' });
      expect(adapter.extractId(task)).toBe('from-field');
    });

    it('should fall back to extracting from markdown', () => {
      const task = makeTask({ id: '', originalMarkdown: '- [ ] Task %%[id::from-md]%%' });
      expect(adapter.extractId(task)).toBe('from-md');
    });

    it('should return null when no ID present', () => {
      const task = makeTask({ id: '', originalMarkdown: '- [ ] No ID task' });
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
