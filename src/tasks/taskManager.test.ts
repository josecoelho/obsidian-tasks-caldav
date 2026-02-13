import { TaskManager, ObsidianTask } from './taskManager';
import { TFile } from 'obsidian';

// Mock TFile class
class MockTFile extends TFile {
    constructor(path: string) {
        // @ts-ignore - minimal mock for testing
        super();
        this.path = path;
    }
}

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

    describe('findTaskById', () => {
        beforeEach(() => {
            // Mock the tasksPlugin with getTasks() that returns test data
            const mockTasksPlugin = {
                getTasks: jest.fn()
            };
            (taskManager as any).tasksPlugin = mockTasksPlugin;
        });

        it('should find task by obsidian-tasks id', () => {
            const task1 = createMockTask({ id: 'task-1', description: 'First task' });
            const task2 = createMockTask({ id: 'task-2', description: 'Second task' });

            const mockTasksPlugin = (taskManager as any).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1, task2]);

            const found = taskManager.findTaskById('task-2');
            expect(found).toBe(task2);
            expect(found?.description).toBe('Second task');
        });

        it('should find task by markdown id', () => {
            const task1 = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task [id::abc-123]',
                description: 'Task with markdown ID'
            });
            const task2 = createMockTask({ id: 'other-id', description: 'Other task' });

            const mockTasksPlugin = (taskManager as any).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1, task2]);

            const found = taskManager.findTaskById('abc-123');
            expect(found).toBe(task1);
            expect(found?.description).toBe('Task with markdown ID');
        });

        it('should return null if task not found', () => {
            const task1 = createMockTask({ id: 'task-1' });

            const mockTasksPlugin = (taskManager as any).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1]);

            const found = taskManager.findTaskById('nonexistent-id');
            expect(found).toBeNull();
        });

        it('should return null if no tasks exist', () => {
            const mockTasksPlugin = (taskManager as any).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([]);

            const found = taskManager.findTaskById('any-id');
            expect(found).toBeNull();
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

    describe('createTask', () => {
        let mockFile: MockTFile;

        beforeEach(() => {
            mockFile = new MockTFile('tasks.md');
            jest.clearAllMocks();
            // Make isReady() return true
            (taskManager as any).tasksPlugin = { getTasks: jest.fn().mockReturnValue([]) };
        });

        it('should append task to existing file when no section specified', async () => {
            const fileContent = '# My Tasks\n\n- [ ] Existing task';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.createTask('- [ ] New task [id::20251107-abc]', 'tasks.md');

            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                '# My Tasks\n\n- [ ] Existing task\n- [ ] New task [id::20251107-abc]'
            );
        });

        it('should create new file when file does not exist', async () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
            mockApp.vault.create.mockResolvedValue(undefined);

            await taskManager.createTask('- [ ] New task', 'new-file.md');

            expect(mockApp.vault.create).toHaveBeenCalledWith('new-file.md', '- [ ] New task\n');
        });

        it('should insert task under section heading', async () => {
            const fileContent = '# My Tasks\n\n## CalDAV\n- [ ] Existing CalDAV task\n\n## Other';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.createTask('- [ ] New CalDAV task', 'tasks.md', 'CalDAV');

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            const lines = updatedContent.split('\n');
            // Section heading is at index 2, task should be inserted at index 3
            expect(lines[2]).toBe('## CalDAV');
            expect(lines[3]).toBe('- [ ] New CalDAV task');
            expect(lines[4]).toBe('- [ ] Existing CalDAV task');
        });

        it('should create section when heading not found', async () => {
            const fileContent = '# My Tasks\n\n- [ ] Existing task';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.createTask('- [ ] New task', 'tasks.md', 'CalDAV');

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            expect(updatedContent).toBe(
                '# My Tasks\n\n- [ ] Existing task\n\n## CalDAV\n- [ ] New task'
            );
        });

        it('should match h1 heading for section', async () => {
            const fileContent = '# CalDAV\n- [ ] Existing task';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.createTask('- [ ] New task', 'tasks.md', 'CalDAV');

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('# CalDAV');
            expect(lines[1]).toBe('- [ ] New task');
            expect(lines[2]).toBe('- [ ] Existing task');
        });

        it('should throw on non-file path', async () => {
            // Return a plain object (not instanceof TFile)
            mockApp.vault.getAbstractFileByPath.mockReturnValue({});

            await expect(
                taskManager.createTask('- [ ] Task', 'not-a-file')
            ).rejects.toThrow('Path is not a file: not-a-file');
        });
    });

    describe('ensureTaskHasId', () => {
        let mockFile: MockTFile;

        beforeEach(() => {
            mockFile = new MockTFile('test.md');
            jest.clearAllMocks();
        });

        it('should return existing ID without updating vault', async () => {
            const task = createMockTask({
                id: 'existing-id-123',
                originalMarkdown: '- [ ] Task with ID [id::existing-id-123]',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 1
                }
            });

            const result = await taskManager.ensureTaskHasId(task);

            expect(result).toBe('existing-id-123');
            expect(mockApp.vault.modify).not.toHaveBeenCalled();
        });

        it('should generate and inject new ID when task has none', async () => {
            const fileContent = '- [ ] Task without ID';

            const task = createMockTask({
                id: '',
                description: 'Task without ID',
                originalMarkdown: '- [ ] Task without ID',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            const result = await taskManager.ensureTaskHasId(task);

            // Should return a non-empty ID
            expect(result).toBeTruthy();
            expect(result.length).toBeGreaterThan(0);

            // Should have called updateTaskInVault (which calls vault.modify)
            expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);

            // The modified content should contain the new ID
            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            expect(updatedContent).toContain(`🆔 ${result}`);
        });
    });

    describe('updateTaskInVault', () => {
        let mockFile: MockTFile;

        beforeEach(() => {
            mockFile = new MockTFile('test.md');
            jest.clearAllMocks();
        });

        it('should find task by exact markdown text and update it', async () => {
            const fileContent = `# Header

Some text

- [ ] First task
- [ ] Target task to update
- [ ] Another task

More text`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Target task to update',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 6 // Intentionally wrong line number (simulating stale cache)
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.updateTaskInVault(task, '- [ ] Target task to update [id::20251107-abc]');

            // Should find task at line 5 (index 5) not line 6
            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                expect.stringContaining('- [ ] Target task to update [id::20251107-abc]')
            );

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            const lines = updatedContent.split('\n');
            expect(lines[5]).toBe('- [ ] Target task to update [id::20251107-abc]');
            expect(lines[4]).toBe('- [ ] First task');
            expect(lines[6]).toBe('- [ ] Another task');
        });

        it('should update task even when cached line number is stale', async () => {
            // Simulate scenario where file was modified after cache was built
            const fileContent = `- [ ] Task A
- [ ] Task B
- [ ] Task C
- [ ] Target task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Target task',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 10 // Stale line number - file has changed
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.updateTaskInVault(task, '- [ ] Target task [id::xyz]');

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            const lines = updatedContent.split('\n');

            // Should find and update at actual line 3 (index 3), not line 10
            expect(lines[3]).toBe('- [ ] Target task [id::xyz]');
            expect(lines[0]).toBe('- [ ] Task A');
            expect(lines[1]).toBe('- [ ] Task B');
            expect(lines[2]).toBe('- [ ] Task C');
        });

        it('should handle tasks with whitespace differences', async () => {
            const fileContent = `- [ ] Task with spaces    `;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task with spaces',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.updateTaskInVault(task, '- [ ] Task with spaces [id::abc]');

            expect(mockApp.vault.modify).toHaveBeenCalled();
            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            expect(updatedContent).toBe('- [ ] Task with spaces [id::abc]');
        });

        it('should throw error if task not found in file', async () => {
            const fileContent = `- [ ] Different task
- [ ] Another different task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task that does not exist',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);

            await expect(
                taskManager.updateTaskInVault(task, '- [ ] Task that does not exist [id::abc]')
            ).rejects.toThrow('Could not find task in file: - [ ] Task that does not exist');
        });

        it('should throw error if file not found', async () => {
            const task = createMockTask({
                taskLocation: {
                    _tasksFile: { _path: 'nonexistent.md' },
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            await expect(
                taskManager.updateTaskInVault(task, '- [ ] Task [id::abc]')
            ).rejects.toThrow('File not found: nonexistent.md');
        });

        it('should not create duplicate tasks when adding ID', async () => {
            // This test simulates the bug that was fixed
            const fileContent = `# Tasks

- [ ] Task without ID #sync

More content`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task without ID #sync',
                taskLocation: {
                    _tasksFile: { _path: 'test.md' },
                    _lineNumber: 5 // Wrong line - file has changed
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await taskManager.updateTaskInVault(task, '- [ ] Task without ID #sync [id::20251107-abc]');

            const updatedContent = mockApp.vault.modify.mock.calls[0][1];
            const lines = updatedContent.split('\n');

            // Should have exactly one task with ID, not duplicate
            const tasksWithId = lines.filter((line: string) => line.includes('[id::20251107-abc]'));
            expect(tasksWithId).toHaveLength(1);

            // Original task should be replaced, not remain
            const tasksWithoutId = lines.filter((line: string) =>
                line.trim() === '- [ ] Task without ID #sync'
            );
            expect(tasksWithoutId).toHaveLength(0);
        });
    });
});
