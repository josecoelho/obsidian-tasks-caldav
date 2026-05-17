import { ObsidianTasksWrapper, ObsidianTask, TaskWithBody } from './obsidianTasksWrapper';
import { App, TFile } from 'obsidian';

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
};

// Mock version of ObsidianTasksPlugin with jest.Mock methods
interface MockTasksPlugin {
    getTasks: jest.Mock;
}

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
            path: 'test.md',
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

describe('ObsidianTasksWrapper', () => {
    let wrapper: ObsidianTasksWrapper;

    beforeEach(() => {
        wrapper = new ObsidianTasksWrapper(mockApp as unknown as App);
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
            const result = wrapper.filterTasks(tasks, 'not done');
            expect(result).toHaveLength(4);
            expect(result.every(t => !t.isDone)).toBe(true);
        });

        it('should filter "done" tasks', () => {
            const result = wrapper.filterTasks(tasks, 'done');
            expect(result).toHaveLength(1);
            expect(result[0].description).toBe('Done task');
        });

        it('should filter by tag with "tags include" query', () => {
            const result = wrapper.filterTasks(tasks, 'tags include #work');
            expect(result).toHaveLength(2);
            expect(result.every(t => t.tags.includes('work'))).toBe(true);
        });

        it('should filter by tag without # symbol', () => {
            const result = wrapper.filterTasks(tasks, 'tags include work');
            expect(result).toHaveLength(2);
        });

        it('should filter by tag case-insensitively', () => {
            const result = wrapper.filterTasks(tasks, 'tags include WORK');
            expect(result).toHaveLength(2);
        });

        it('should handle "tag include" (singular) syntax', () => {
            const result = wrapper.filterTasks(tasks, 'tag include urgent');
            expect(result).toHaveLength(1);
            expect(result[0].tags).toContain('urgent');
        });

        it('should return all tasks with "all" query', () => {
            const result = wrapper.filterTasks(tasks, 'all');
            expect(result).toHaveLength(5);
        });

        it('should default to "not done" for unsupported queries', () => {
            const result = wrapper.filterTasks(tasks, 'unsupported query');
            expect(result).toHaveLength(4);
            expect(result.every(t => !t.isDone)).toBe(true);
        });

        it('should handle empty task array', () => {
            const result = wrapper.filterTasks([], 'not done');
            expect(result).toHaveLength(0);
        });

        it('should be case-insensitive for queries', () => {
            const result1 = wrapper.filterTasks(tasks, 'NOT DONE');
            const result2 = wrapper.filterTasks(tasks, 'not done');
            expect(result1).toEqual(result2);
        });
    });

    describe('taskHasId', () => {
        it('should return true if task has id field', () => {
            const task = createMockTask({ id: 'abc123' });
            expect(wrapper.taskHasId(task)).toBe(true);
        });

        it('should return true when obsidian-tasks parses [id::xxx] into task.id', () => {
            const task = createMockTask({
                id: '20251106-abc',
                originalMarkdown: '- [ ] Task [id::20251106-abc]'
            });
            expect(wrapper.taskHasId(task)).toBe(true);
        });

        it('should return false if task has no ID', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task without ID'
            });
            expect(wrapper.taskHasId(task)).toBe(false);
        });
    });

    describe('getTaskId', () => {
        it('should return task.id if present', () => {
            const task = createMockTask({ id: 'abc123' });
            expect(wrapper.getTaskId(task)).toBe('abc123');
        });

        it('should return null if task.id is empty', () => {
            const task = createMockTask({
                id: '',
                originalMarkdown: '- [ ] Task without ID'
            });
            expect(wrapper.getTaskId(task)).toBeNull();
        });

        it('should return task.id when obsidian-tasks parses [id::xxx]', () => {
            const task = createMockTask({
                id: '20251106-abc',
                originalMarkdown: '- [ ] Task [id::20251106-abc]'
            });
            expect(wrapper.getTaskId(task)).toBe('20251106-abc');
        });
    });

    describe('findTaskById', () => {
        beforeEach(() => {
            // Mock the tasksPlugin with getTasks() that returns test data
            const mockTasksPlugin = {
                getTasks: jest.fn()
            };
            (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin = mockTasksPlugin;
        });

        it('should find task by obsidian-tasks id', () => {
            const task1 = createMockTask({ id: 'task-1', description: 'First task' });
            const task2 = createMockTask({ id: 'task-2', description: 'Second task' });

            const mockTasksPlugin = (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1, task2]);

            const found = wrapper.findTaskById('task-2');
            expect(found).toBe(task2);
            expect(found?.description).toBe('Second task');
        });

        it('should find task by task.id field (obsidian-tasks parses [id::xxx])', () => {
            const task1 = createMockTask({
                id: 'abc-123',
                originalMarkdown: '- [ ] Task [id::abc-123]',
                description: 'Task with ID'
            });
            const task2 = createMockTask({ id: 'other-id', description: 'Other task' });

            const mockTasksPlugin = (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1, task2]);

            const found = wrapper.findTaskById('abc-123');
            expect(found).toBe(task1);
            expect(found?.description).toBe('Task with ID');
        });

        it('should return null if task not found', () => {
            const task1 = createMockTask({ id: 'task-1' });

            const mockTasksPlugin = (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([task1]);

            const found = wrapper.findTaskById('nonexistent-id');
            expect(found).toBeNull();
        });

        it('should return null if no tasks exist', () => {
            const mockTasksPlugin = (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin;
            mockTasksPlugin.getTasks.mockReturnValue([]);

            const found = wrapper.findTaskById('any-id');
            expect(found).toBeNull();
        });
    });

    describe('getTaskStats', () => {
        it('should calculate correct statistics', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ isDone: false, originalMarkdown: '- [ ] Task 1' }),
                createMockTask({ isDone: false, id: 'abc', originalMarkdown: '- [ ] Task 2 [id::abc]' }),
                createMockTask({ isDone: true, originalMarkdown: '- [x] Task 3' }),
                createMockTask({ isDone: true, id: 'xyz', originalMarkdown: '- [x] Task 4' })
            ];

            const stats = wrapper.getTaskStats(tasks);

            expect(stats.total).toBe(4);
            expect(stats.done).toBe(2);
            expect(stats.notDone).toBe(2);
            expect(stats.withIds).toBe(2);
            expect(stats.withoutIds).toBe(2);
        });

        it('should handle empty task array', () => {
            const stats = wrapper.getTaskStats([]);

            expect(stats.total).toBe(0);
            expect(stats.done).toBe(0);
            expect(stats.notDone).toBe(0);
            expect(stats.withIds).toBe(0);
            expect(stats.withoutIds).toBe(0);
        });

        it('should handle all tasks with IDs', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ id: 'abc' }),
                createMockTask({ id: 'xyz', originalMarkdown: '- [ ] Task [id::xyz]' })
            ];

            const stats = wrapper.getTaskStats(tasks);

            expect(stats.total).toBe(2);
            expect(stats.withIds).toBe(2);
            expect(stats.withoutIds).toBe(0);
        });

        it('should handle all tasks without IDs', () => {
            const tasks: ObsidianTask[] = [
                createMockTask({ id: '', originalMarkdown: '- [ ] Task 1' }),
                createMockTask({ id: '', originalMarkdown: '- [ ] Task 2' })
            ];

            const stats = wrapper.getTaskStats(tasks);

            expect(stats.total).toBe(2);
            expect(stats.withIds).toBe(0);
            expect(stats.withoutIds).toBe(2);
        });
    });

    describe('isReady', () => {
        it('should return false before initialization', () => {
            expect(wrapper.isReady()).toBe(false);
        });
    });

    describe('getAllTasks', () => {
        it('should return empty array if not initialized', () => {
            const tasks = wrapper.getAllTasks();
            expect(tasks).toEqual([]);
        });
    });

    describe('createTask', () => {
        let mockFile: MockTFile;

        beforeEach(() => {
            mockFile = new MockTFile('tasks.md');
            jest.clearAllMocks();
            // Make isReady() return true
            (wrapper as unknown as { tasksPlugin: MockTasksPlugin }).tasksPlugin = { getTasks: jest.fn().mockReturnValue([]) };
        });

        it('should append task to existing file when no section specified', async () => {
            const fileContent = '# My Tasks\n\n- [ ] Existing task';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.createTask('- [ ] New task [id::20251107-abc]', 'tasks.md');

            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                '# My Tasks\n\n- [ ] Existing task\n- [ ] New task [id::20251107-abc]'
            );
        });

        it('should create new file when file does not exist', async () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);
            mockApp.vault.create.mockResolvedValue(undefined);

            await wrapper.createTask('- [ ] New task', 'new-file.md');

            expect(mockApp.vault.create).toHaveBeenCalledWith('new-file.md', '- [ ] New task\n');
        });

        it('should insert task under section heading', async () => {
            const fileContent = '# My Tasks\n\n## CalDAV\n- [ ] Existing CalDAV task\n\n## Other';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.createTask('- [ ] New CalDAV task', 'tasks.md', 'CalDAV');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
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

            await wrapper.createTask('- [ ] New task', 'tasks.md', 'CalDAV');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            expect(updatedContent).toBe(
                '# My Tasks\n\n- [ ] Existing task\n\n## CalDAV\n- [ ] New task'
            );
        });

        it('should match h1 heading for section', async () => {
            const fileContent = '# CalDAV\n- [ ] Existing task';

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.createTask('- [ ] New task', 'tasks.md', 'CalDAV');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('# CalDAV');
            expect(lines[1]).toBe('- [ ] New task');
            expect(lines[2]).toBe('- [ ] Existing task');
        });

        it('should throw on non-file path', async () => {
            // Return a plain object (not instanceof TFile)
            mockApp.vault.getAbstractFileByPath.mockReturnValue({});

            await expect(
                wrapper.createTask('- [ ] Task', 'not-a-file')
            ).rejects.toThrow('Path is not a file: not-a-file');
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
                    path: 'test.md',
                    _lineNumber: 6 // Intentionally wrong line number (simulating stale cache)
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Target task to update [id::20251107-abc]');

            // Should find task at line 5 (index 5) not line 6
            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                expect.stringContaining('- [ ] Target task to update [id::20251107-abc]')
            );

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
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
                    path: 'test.md',
                    _lineNumber: 10 // Stale line number - file has changed
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Target task [id::xyz]');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
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
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task with spaces [id::abc]');

            expect(mockApp.vault.modify).toHaveBeenCalled();
            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            expect(updatedContent).toBe('- [ ] Task with spaces [id::abc]');
        });

        it('should throw error if task not found in file', async () => {
            const fileContent = `- [ ] Different task
- [ ] Another different task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task that does not exist',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);

            await expect(
                wrapper.updateTaskInVault(task, '- [ ] Task that does not exist [id::abc]')
            ).rejects.toThrow('Could not find task in file: - [ ] Task that does not exist');
        });

        it('should throw error if file not found', async () => {
            const task = createMockTask({
                taskLocation: {
                    path: 'nonexistent.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            await expect(
                wrapper.updateTaskInVault(task, '- [ ] Task [id::abc]')
            ).rejects.toThrow('File not found: nonexistent.md');
        });

        it('should replace task with existing notes when updating', async () => {
            const fileContent = `- [ ] Task with notes
    - Old note one
    - Old note two
- [ ] Next task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task with notes',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task with notes 🆔 abc\n    - New note');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('- [ ] Task with notes 🆔 abc');
            expect(lines[1]).toBe('    - New note');
            expect(lines[2]).toBe('- [ ] Next task');
        });

        it('should remove notes when updating to noteless content', async () => {
            const fileContent = `- [ ] Task with notes
    - Old note one
    - Old note two
- [ ] Next task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task with notes',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task with notes 🆔 abc');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('- [ ] Task with notes 🆔 abc');
            expect(lines[1]).toBe('- [ ] Next task');
        });

        it('should add notes to task that had none', async () => {
            const fileContent = `- [ ] Task without notes
- [ ] Next task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task without notes',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task without notes 🆔 abc\n    - New note');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('- [ ] Task without notes 🆔 abc');
            expect(lines[1]).toBe('    - New note');
            expect(lines[2]).toBe('- [ ] Next task');
        });

        it('should not treat non-bullet indented lines as notes', async () => {
            const fileContent = `- [ ] Task
    Not a bullet line
- [ ] Next task`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 1
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task 🆔 abc');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
            const lines = updatedContent.split('\n');
            expect(lines[0]).toBe('- [ ] Task 🆔 abc');
            // Non-bullet indented line should be preserved
            expect(lines[1]).toBe('    Not a bullet line');
            expect(lines[2]).toBe('- [ ] Next task');
        });

        it('should not create duplicate tasks when adding ID', async () => {
            // This test simulates the bug that was fixed
            const fileContent = `# Tasks

- [ ] Task without ID #sync

More content`;

            const task = createMockTask({
                originalMarkdown: '- [ ] Task without ID #sync',
                taskLocation: {
                    path: 'test.md',
                    _lineNumber: 5 // Wrong line - file has changed
                }
            });

            mockApp.vault.getAbstractFileByPath.mockReturnValue(mockFile);
            mockApp.vault.read.mockResolvedValue(fileContent);
            mockApp.vault.modify.mockResolvedValue(undefined);

            await wrapper.updateTaskInVault(task, '- [ ] Task without ID #sync [id::20251107-abc]');

            const updatedContent = (mockApp.vault.modify.mock.calls[0] as [unknown, string])[1];
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

    describe('filterByTag', () => {
        function withBody(task: ObsidianTask, body: string = ''): TaskWithBody {
            return { task, body };
        }

        it('should filter tasks by sync tag', () => {
            const inputs: TaskWithBody[] = [
                withBody(createMockTask({ description: 'Task 1', tags: ['#sync'] })),
                withBody(createMockTask({ description: 'Task 2', tags: ['#work'] })),
                withBody(createMockTask({ description: 'Task 3', tags: ['#sync', '#work'] })),
            ];

            const result = wrapper.filterByTag(inputs, 'sync');
            expect(result).toHaveLength(2);
            expect(result[0].task.description).toBe('Task 1');
            expect(result[1].task.description).toBe('Task 3');
        });

        it('should return all tasks when syncTag is empty', () => {
            const inputs: TaskWithBody[] = [
                withBody(createMockTask({ tags: ['#work'] })),
                withBody(createMockTask({ tags: [] })),
            ];

            expect(wrapper.filterByTag(inputs, '')).toHaveLength(2);
            expect(wrapper.filterByTag(inputs, undefined)).toHaveLength(2);
        });

        it('should handle case-insensitive tag matching', () => {
            const inputs: TaskWithBody[] = [
                withBody(createMockTask({ tags: ['#SYNC'] })),
                withBody(createMockTask({ tags: ['#Sync'] })),
            ];

            expect(wrapper.filterByTag(inputs, 'sync')).toHaveLength(2);
        });

        it('should handle syncTag with # prefix', () => {
            const inputs: TaskWithBody[] = [
                withBody(createMockTask({ tags: ['#sync'] })),
            ];

            expect(wrapper.filterByTag(inputs, '#sync')).toHaveLength(1);
        });

        it('should exclude tasks with no tags', () => {
            const inputs: TaskWithBody[] = [
                withBody(createMockTask({ tags: [] })),
            ];

            expect(wrapper.filterByTag(inputs, 'sync')).toHaveLength(0);
        });
    });

    describe('extractBodyFromFile', () => {
        it('should extract indented bullet lines below a task (4-space indent)', () => {
            const content = '- [ ] Task\n    - Note one\n    - Note two\nNext line';
            expect(wrapper.extractBodyFromFile(content, 0)).toBe('Note one\nNote two');
        });

        it('should extract with 2-space indent', () => {
            const content = '- [ ] Task\n  - Note one\n  - Note two';
            expect(wrapper.extractBodyFromFile(content, 0)).toBe('Note one\nNote two');
        });

        it('should extract with tab indent', () => {
            const content = '- [ ] Task\n\t- Note one\n\t- Note two';
            expect(wrapper.extractBodyFromFile(content, 0)).toBe('Note one\nNote two');
        });

        it('should stop at non-indented line', () => {
            const content = '- [ ] Task\n    - Note one\nNot a note\n    - Not included';
            expect(wrapper.extractBodyFromFile(content, 0)).toBe('Note one');
        });

        it('should return empty string when no body', () => {
            const content = '- [ ] Task\n- [ ] Next task';
            expect(wrapper.extractBodyFromFile(content, 0)).toBe('');
        });

        it('should handle task in middle of file', () => {
            const content = '# Header\n- [ ] First task\n- [ ] Target task\n    - Note for target\n- [ ] Other task';
            expect(wrapper.extractBodyFromFile(content, 2)).toBe('Note for target');
        });
    });

    describe('extractId', () => {
        it('should return task.id when present', () => {
            const task = createMockTask({ id: 'from-field' });
            expect(wrapper.extractId(task)).toBe('from-field');
        });

        it('should return null when task.id is empty', () => {
            const task = createMockTask({ id: '' });
            expect(wrapper.extractId(task)).toBeNull();
        });
    });

    describe('getAllTasksWithBody', () => {
        let mockPlugin: MockTasksPlugin;

        beforeEach(() => {
            jest.clearAllMocks();
            mockPlugin = { getTasks: jest.fn().mockReturnValue([]) };
            (mockApp.plugins.plugins as Record<string, unknown>)['obsidian-tasks-plugin'] = mockPlugin;
            wrapper.initialize();
        });

        it('should return tasks paired with their body text', async () => {
            const task = createMockTask({
                originalMarkdown: '- [ ] My task',
                taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
            });
            mockPlugin.getTasks.mockReturnValue([task]);

            const file = new MockTFile('Tasks.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('- [ ] My task\n    - Note line 1\n    - Note line 2\n');

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].task).toBe(task);
            expect(result[0].body).toBe('Note line 1\nNote line 2');
        });

        it('should return empty body when task has no indented lines', async () => {
            const task = createMockTask({
                originalMarkdown: '- [ ] Simple task',
                taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
            });
            mockPlugin.getTasks.mockReturnValue([task]);

            const file = new MockTFile('Tasks.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('- [ ] Simple task\n- [ ] Another task\n');

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].body).toBe('');
        });

        it('should return empty body when file is not found', async () => {
            const task = createMockTask({
                taskLocation: { path: 'Missing.md', _lineNumber: 1 },
            });
            mockPlugin.getTasks.mockReturnValue([task]);
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].body).toBe('');
        });

        it('should group tasks by file to avoid re-reading', async () => {
            const task1 = createMockTask({
                originalMarkdown: '- [ ] Task 1',
                taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
            });
            const task2 = createMockTask({
                originalMarkdown: '- [ ] Task 2',
                taskLocation: { path: 'Tasks.md', _lineNumber: 3 },
            });
            mockPlugin.getTasks.mockReturnValue([task1, task2]);

            const file = new MockTFile('Tasks.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('- [ ] Task 1\n- [ ] Task 2\n');

            await wrapper.getAllTasksWithBody();

            // File should only be read once despite two tasks
            expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
        });

        it('should return empty body when file read throws', async () => {
            const task = createMockTask({
                taskLocation: { path: 'Error.md', _lineNumber: 1 },
            });
            mockPlugin.getTasks.mockReturnValue([task]);

            const file = new MockTFile('Error.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockRejectedValue(new Error('Read failed'));

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].body).toBe('');
        });

        it('skips a task with no resolvable path instead of aborting the whole sync', async () => {
            const goodTask = createMockTask({
                originalMarkdown: '- [ ] Good task',
                taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
            });
            const brokenTask = createMockTask({
                originalMarkdown: '- [ ] Broken task',
                taskLocation: {} as ObsidianTask['taskLocation'],
            });
            mockPlugin.getTasks.mockReturnValue([goodTask, brokenTask]);

            const file = new MockTFile('Tasks.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('- [ ] Good task\n    - Body\n');
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].task).toBe(goodTask);
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('resolves body via the public taskLocation.path accessor (issue #73)', async () => {
            const task = createMockTask({
                originalMarkdown: '- [ ] Nextcloud task',
                taskLocation: { path: 'Tasks.md', _lineNumber: 1 },
            });
            mockPlugin.getTasks.mockReturnValue([task]);

            const file = new MockTFile('Tasks.md');
            mockApp.vault.getAbstractFileByPath.mockReturnValue(file);
            mockApp.vault.read.mockResolvedValue('- [ ] Nextcloud task\n    - Body line\n');

            const result = await wrapper.getAllTasksWithBody();

            expect(result).toHaveLength(1);
            expect(result[0].body).toBe('Body line');
            expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('Tasks.md');
        });
    });

});


