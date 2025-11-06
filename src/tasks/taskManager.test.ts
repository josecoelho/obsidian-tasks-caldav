import { TaskManager, ObsidianTask } from './taskManager';

// Mock App for testing
const mockApp = {
    vault: {
        getAbstractFileByPath: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        create: jest.fn()
    },
    plugins: {
        plugins: {}
    }
} as any;

// Helper to create mock task
function createMockTask(overrides: Partial<ObsidianTask> = {}): ObsidianTask {
    return {
        description: 'Test task',
        status: {
            configuration: {
                symbol: ' ',
                name: 'Todo',
                type: 'TODO'
            }
        },
        isDone: false,
        priority: '3',
        tags: [],
        taskLocation: {
            _tasksFile: {
                _path: 'test.md'
            },
            _lineNumber: 1
        },
        originalMarkdown: '- [ ] Test task',
        createdDate: null,
        startDate: null,
        scheduledDate: null,
        dueDate: null,
        doneDate: null,
        cancelledDate: null,
        recurrence: null,
        id: '',
        ...overrides
    };
}

describe('TaskManager', () => {
    let taskManager: TaskManager;

    beforeEach(() => {
        taskManager = new TaskManager(mockApp);
    });

    describe('filterTasks', () => {
        const tasks: ObsidianTask[] = [
            createMockTask({ description: 'Not done task 1', isDone: false }),
            createMockTask({ description: 'Not done task 2', isDone: false }),
            createMockTask({ description: 'Done task', isDone: true }),
            createMockTask({ description: 'Task with tag', isDone: false, tags: ['work'] }),
            createMockTask({ description: 'Task with multiple tags', isDone: false, tags: ['work', 'urgent'] })
        ];

        it('should filter "not done" tasks', () => {
            const result = taskManager.filterTasks(tasks, 'not done');
            expect(result).toHaveLength(4);
            expect(result.every(t => !t.isDone)).toBe(true);
        });

        it('should filter "done" tasks', () => {
            const result = taskManager.filterTasks(tasks, 'done');
            expect(result).toHaveLength(1);
            expect(result[0].description).toBe('Done task');
        });

        it('should filter by tag with "tags include" query', () => {
            const result = taskManager.filterTasks(tasks, 'tags include #work');
            expect(result).toHaveLength(2);
            expect(result.every(t => t.tags.includes('work'))).toBe(true);
        });

        it('should filter by tag without # symbol', () => {
            const result = taskManager.filterTasks(tasks, 'tags include work');
            expect(result).toHaveLength(2);
        });

        it('should filter by tag case-insensitively', () => {
            const result = taskManager.filterTasks(tasks, 'tags include WORK');
            expect(result).toHaveLength(2);
        });

        it('should handle "tag include" (singular) syntax', () => {
            const result = taskManager.filterTasks(tasks, 'tag include urgent');
            expect(result).toHaveLength(1);
            expect(result[0].tags).toContain('urgent');
        });

        it('should return all tasks with "all" query', () => {
            const result = taskManager.filterTasks(tasks, 'all');
            expect(result).toHaveLength(5);
        });

        it('should default to "not done" for unsupported queries', () => {
            const result = taskManager.filterTasks(tasks, 'unsupported query');
            expect(result).toHaveLength(4);
            expect(result.every(t => !t.isDone)).toBe(true);
        });

        it('should handle empty task array', () => {
            const result = taskManager.filterTasks([], 'not done');
            expect(result).toHaveLength(0);
        });

        it('should be case-insensitive for queries', () => {
            const result1 = taskManager.filterTasks(tasks, 'NOT DONE');
            const result2 = taskManager.filterTasks(tasks, 'not done');
            expect(result1).toEqual(result2);
        });
    });

    describe('taskHasId', () => {
        it('should return true if task has obsidian-tasks id field', () => {
            const task = createMockTask({ id: 'abc123' });
            expect(taskManager.taskHasId(task)).toBe(true);
        });

        it('should return true if task has [id::xxx] in markdown', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task [id::20251106-abc]'
            });
            expect(taskManager.taskHasId(task)).toBe(true);
        });

        it('should return false if task has no ID', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task without ID'
            });
            expect(taskManager.taskHasId(task)).toBe(false);
        });

        it('should prefer obsidian-tasks id field over markdown', () => {
            const task = createMockTask({
                id: 'obsidian-id',
                originalMarkdown: '- [ ] Task [id::markdown-id]'
            });
            expect(taskManager.taskHasId(task)).toBe(true);
        });
    });

    describe('getTaskId', () => {
        it('should return obsidian-tasks id if present', () => {
            const task = createMockTask({ id: 'abc123' });
            expect(taskManager.getTaskId(task)).toBe('abc123');
        });

        it('should extract id from markdown if obsidian-tasks id is empty', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task [id::20251106-abc]'
            });
            expect(taskManager.getTaskId(task)).toBe('20251106-abc');
        });

        it('should return null if no ID found', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task without ID'
            });
            expect(taskManager.getTaskId(task)).toBeNull();
        });

        it('should prefer obsidian-tasks id over markdown id', () => {
            const task = createMockTask({
                id: 'obsidian-id',
                originalMarkdown: '- [ ] Task [id::markdown-id]'
            });
            expect(taskManager.getTaskId(task)).toBe('obsidian-id');
        });
    });

    describe('getTaskStats', () => {
        it('should calculate correct statistics', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ isDone: false, originalMarkdown: '- [ ] Task 1' }),
                createMockTask({ isDone: false, originalMarkdown: '- [ ] Task 2 [id::abc]' }),
                createMockTask({ isDone: true, originalMarkdown: '- [x] Task 3' }),
                createMockTask({ isDone: true, id: 'xyz', originalMarkdown: '- [x] Task 4' })
            ];

            const stats = taskManager.getTaskStats(tasks);

            expect(stats.total).toBe(4);
            expect(stats.done).toBe(2);
            expect(stats.notDone).toBe(2);
            expect(stats.withIds).toBe(2);
            expect(stats.withoutIds).toBe(2);
        });

        it('should handle empty task array', () => {
            const stats = taskManager.getTaskStats([]);

            expect(stats.total).toBe(0);
            expect(stats.done).toBe(0);
            expect(stats.notDone).toBe(0);
            expect(stats.withIds).toBe(0);
            expect(stats.withoutIds).toBe(0);
        });

        it('should handle all tasks with IDs', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ id: 'abc' }),
                createMockTask({ originalMarkdown: '- [ ] Task [id::xyz]' })
            ];

            const stats = taskManager.getTaskStats(tasks);

            expect(stats.total).toBe(2);
            expect(stats.withIds).toBe(2);
            expect(stats.withoutIds).toBe(0);
        });

        it('should handle all tasks without IDs', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ id: '', originalMarkdown: '- [ ] Task 1' }),
                createMockTask({ id: '', originalMarkdown: '- [ ] Task 2' })
            ];

            const stats = taskManager.getTaskStats(tasks);

            expect(stats.total).toBe(2);
            expect(stats.withIds).toBe(0);
            expect(stats.withoutIds).toBe(2);
        });
    });

    describe('isReady', () => {
        it('should return false before initialization', () => {
            expect(taskManager.isReady()).toBe(false);
        });
    });

    describe('getAllTasks', () => {
        it('should return empty array if not initialized', () => {
            const tasks = taskManager.getAllTasks();
            expect(tasks).toEqual([]);
        });
    });
});
