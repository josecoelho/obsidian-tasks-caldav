import { SyncEngine } from './syncEngine';
import { CalDAVSettings } from '../types';

// Mock App
const mockApp = {
    vault: {
        getAbstractFileByPath: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        create: jest.fn()
    },
    plugins: {
        plugins: {
            'obsidian-tasks-plugin': {
                getTasks: jest.fn()
            }
        }
    }
} as any;

const mockSettings: CalDAVSettings = {
    serverUrl: 'https://caldav.example.com',
    username: 'testuser',
    password: 'testpass',
    calendarName: 'Tasks',
    syncTag: 'sync',
    syncInterval: 5,
    newTasksDestination: 'Inbox.md',
    newTasksSection: '',
    requireManualConflictResolution: false,
    autoResolveObsidianWins: true,
    syncCompletedTasks: false,
    deleteBehavior: 'ask'
};

describe('SyncEngine', () => {
    let syncEngine: SyncEngine;

    beforeEach(() => {
        syncEngine = new SyncEngine(mockApp, mockSettings);
        jest.clearAllMocks();
    });

    describe('Tag filtering', () => {
        it('should filter tasks by sync tag', () => {
            const tasks = [
                { description: 'Task 1', tags: ['sync', 'work'], isDone: false },
                { description: 'Task 2', tags: ['personal'], isDone: false },
                { description: 'Task 3', tags: ['sync'], isDone: false },
                { description: 'Task 4', tags: [], isDone: false }
            ];

            // Access private method for testing via any cast
            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(2);
            expect(filtered[0].description).toBe('Task 1');
            expect(filtered[1].description).toBe('Task 3');
        });

        it('should handle tags with # prefix', () => {
            const tasks = [
                { description: 'Task 1', tags: ['#sync'], isDone: false },
                { description: 'Task 2', tags: ['sync'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(2);
        });

        it('should be case-insensitive when filtering tags', () => {
            const tasks = [
                { description: 'Task 1', tags: ['SYNC'], isDone: false },
                { description: 'Task 2', tags: ['sync'], isDone: false },
                { description: 'Task 3', tags: ['Sync'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(3);
        });

        it('should return all tasks when syncTag is empty', () => {
            const tasks = [
                { description: 'Task 1', tags: ['work'], isDone: false },
                { description: 'Task 2', tags: [], isDone: false },
                { description: 'Task 3', tags: ['personal'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, '');

            expect(filtered).toHaveLength(3);
        });

        it('should return empty array for tasks without sync tag', () => {
            const tasks = [
                { description: 'Task 1', tags: ['work'], isDone: false },
                { description: 'Task 2', tags: ['personal'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(0);
        });

        it('should handle tasks with no tags array', () => {
            const tasks = [
                { description: 'Task 1', tags: null, isDone: false },
                { description: 'Task 2', tags: undefined, isDone: false },
                { description: 'Task 3', tags: ['sync'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(1);
            expect(filtered[0].description).toBe('Task 3');
        });

        it('should filter tasks with multiple tags correctly', () => {
            const tasks = [
                { description: 'Task 1', tags: ['work', 'sync', 'urgent'], isDone: false },
                { description: 'Task 2', tags: ['work', 'urgent'], isDone: false },
                { description: 'Task 3', tags: ['sync'], isDone: false }
            ];

            const filtered = (syncEngine as any).filterTasksByTag(tasks, 'sync');

            expect(filtered).toHaveLength(2);
            expect(filtered[0].description).toBe('Task 1');
            expect(filtered[1].description).toBe('Task 3');
        });
    });

    describe('Priority mapping', () => {
        it('should map obsidian-tasks priority to CalDAV format', () => {
            const priorities = [
                { input: '1', expected: 'highest' },
                { input: '2', expected: 'high' },
                { input: '3', expected: 'medium' },
                { input: '4', expected: 'medium' },
                { input: '5', expected: 'low' },
                { input: '6', expected: 'lowest' }
            ];

            priorities.forEach(({ input, expected }) => {
                const result = (syncEngine as any).mapPriority(input);
                expect(result).toBe(expected);
            });
        });

        it('should return "none" for unknown priority values', () => {
            const result = (syncEngine as any).mapPriority('unknown');
            expect(result).toBe('none');
        });

        it('should handle empty priority', () => {
            const result = (syncEngine as any).mapPriority('');
            expect(result).toBe('none');
        });
    });

    describe('Description cleaning (bd-2, bd-4)', () => {
        it('should remove [id::xxx] from description (bd-4)', () => {
            const result = (syncEngine as any).cleanTaskDescription('Buy groceries [id::test-001]');
            expect(result).toBe('Buy groceries');
        });

        it('should remove hashtags from description (bd-2)', () => {
            const result = (syncEngine as any).cleanTaskDescription('Buy groceries #sync #shopping');
            expect(result).toBe('Buy groceries');
        });

        it('should remove tags and ID together', () => {
            const result = (syncEngine as any).cleanTaskDescription('Buy groceries #sync [id::test-001]');
            expect(result).toBe('Buy groceries');
        });

        it('should handle multiple tags', () => {
            const result = (syncEngine as any).cleanTaskDescription('Complete project #work #urgent [id::proj-123]');
            expect(result).toBe('Complete project');
        });

        it('should preserve description text with special characters', () => {
            const input = 'Review @john\'s PR #42 from 2025-11-14 [id::rev-001] #sync';
            const result = (syncEngine as any).cleanTaskDescription(input);
            // Should keep "@john's PR #42 from 2025-11-14" but remove #sync and [id::rev-001]
            expect(result).toBe('Review @john\'s PR #42 from 2025-11-14');
        });

        it('should clean up extra whitespace', () => {
            const messy = 'Task   with    spaces  #tag   [id::123]';
            const result = (syncEngine as any).cleanTaskDescription(messy);
            expect(result).toBe('Task with spaces');
        });

        it('should handle description with only metadata', () => {
            const result = (syncEngine as any).cleanTaskDescription('#sync [id::test-001]');
            expect(result).toBe('');
        });

        it('should handle empty description', () => {
            const result = (syncEngine as any).cleanTaskDescription('');
            expect(result).toBe('');
        });

        it('should preserve recurrence rules and other text', () => {
            const input = 'trocar óleo 0W-20 every 10k  🔁 every 6 months #luna [id::test]';
            const result = (syncEngine as any).cleanTaskDescription(input);
            expect(result).toBe('trocar óleo 0W-20 every 10k 🔁 every 6 months');
        });

        it('should preserve markdown links', () => {
            const input = 'Task with [link](https://example.com) #sync [id::123]';
            const result = (syncEngine as any).cleanTaskDescription(input);
            expect(result).toBe('Task with [link](https://example.com)');
        });

        it('should preserve Obsidian metadata markers', () => {
            const input = 'Task %%[some_id:: value]%% #sync [id::123]';
            const result = (syncEngine as any).cleanTaskDescription(input);
            expect(result).toBe('Task %%[some_id:: value]%%');
        });
    });

    describe('Tag cleaning (bd-1)', () => {
        it('should remove # prefix from tags', () => {
            const tags = ['#sync', '#work', '#urgent'];
            const result = (syncEngine as any).cleanTags(tags);
            expect(result).toEqual(['sync', 'work', 'urgent']);
        });

        it('should handle tags without # prefix', () => {
            const tags = ['sync', 'work'];
            const result = (syncEngine as any).cleanTags(tags);
            expect(result).toEqual(['sync', 'work']);
        });

        it('should handle mixed tags (with and without #)', () => {
            const tags = ['#sync', 'work', '#urgent'];
            const result = (syncEngine as any).cleanTags(tags);
            expect(result).toEqual(['sync', 'work', 'urgent']);
        });

        it('should handle empty array', () => {
            const result = (syncEngine as any).cleanTags([]);
            expect(result).toEqual([]);
        });

        it('should preserve tag names with hyphens and underscores', () => {
            const tags = ['#my-tag', '#another_tag'];
            const result = (syncEngine as any).cleanTags(tags);
            expect(result).toEqual(['my-tag', 'another_tag']);
        });
    });

    describe('Task markdown creation', () => {
        it('should create markdown with TODO status', () => {
            const task = {
                description: 'Test task',
                status: 'TODO',
                dueDate: null,
                scheduledDate: null,
                completedDate: null
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id-123', 'sync');

            expect(markdown).toBe('- [ ] Test task #sync [id::test-id-123]');
        });

        it('should create markdown with DONE status', () => {
            const task = {
                description: 'Completed task',
                status: 'DONE',
                dueDate: null,
                scheduledDate: null,
                completedDate: null
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id-123', 'sync');

            expect(markdown).toBe('- [x] Completed task #sync [id::test-id-123]');
        });

        it('should include due date', () => {
            const task = {
                description: 'Task with due date',
                status: 'TODO',
                dueDate: '2025-01-15T10:00:00Z',
                scheduledDate: null,
                completedDate: null
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id', 'sync');

            expect(markdown).toContain('📅 2025-01-15');
            expect(markdown).not.toContain('T10:00:00Z');
        });

        it('should include scheduled date', () => {
            const task = {
                description: 'Task with scheduled date',
                status: 'TODO',
                dueDate: null,
                scheduledDate: '2025-01-10T08:00:00Z',
                completedDate: null
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id', 'sync');

            expect(markdown).toContain('⏳ 2025-01-10');
        });

        it('should include completed date', () => {
            const task = {
                description: 'Completed task',
                status: 'DONE',
                dueDate: null,
                scheduledDate: null,
                completedDate: '2025-01-05T14:30:00Z'
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id', 'sync');

            expect(markdown).toContain('✅ 2025-01-05');
        });

        it('should include all dates when present', () => {
            const task = {
                description: 'Task with all dates',
                status: 'DONE',
                dueDate: '2025-01-15',
                scheduledDate: '2025-01-10',
                completedDate: '2025-01-12'
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id', 'sync');

            expect(markdown).toContain('⏳ 2025-01-10');
            expect(markdown).toContain('📅 2025-01-15');
            expect(markdown).toContain('✅ 2025-01-12');
        });

        it('should add # prefix to tag if missing', () => {
            const task = {
                description: 'Task',
                status: 'TODO',
                dueDate: null,
                scheduledDate: null,
                completedDate: null
            };

            const markdownWithoutHash = (syncEngine as any).createTaskMarkdown(task, 'test-id', 'sync');
            const markdownWithHash = (syncEngine as any).createTaskMarkdown(task, 'test-id', '#sync');

            expect(markdownWithoutHash).toContain('#sync');
            expect(markdownWithHash).toContain('#sync');
        });

        it('should work without sync tag', () => {
            const task = {
                description: 'Task without tag',
                status: 'TODO',
                dueDate: null,
                scheduledDate: null,
                completedDate: null
            };

            const markdown = (syncEngine as any).createTaskMarkdown(task, 'test-id-456', '');

            expect(markdown).toBe('- [ ] Task without tag [id::test-id-456]');
            expect(markdown).not.toContain('#');
        });
    });

    describe('pushToCalDAV - Update Logic (with content-based change detection)', () => {
        let mockTaskManager: any;
        let mockCalDAVClient: any;
        let mockStorage: any;
        let mockMapper: any;

        beforeEach(() => {
            // Create mocks for dependencies
            mockTaskManager = {
                getAllTasks: jest.fn(),
                ensureTaskHasId: jest.fn()
            };
            mockCalDAVClient = {
                createVTODO: jest.fn(),
                updateVTODO: jest.fn(),
                fetchVTODOByUID: jest.fn()
            };
            mockStorage = {
                getCalDAVFromTaskId: jest.fn(),
                addTaskMapping: jest.fn(),
                getTaskMapping: jest.fn(),
                updateObsidianTimestamp: jest.fn(),
                updateCalDAVTimestamp: jest.fn()
            };
            mockMapper = {
                taskToVTODO: jest.fn()
            };

            // Inject mocks into syncEngine
            (syncEngine as any).taskManager = mockTaskManager;
            (syncEngine as any).caldavClient = mockCalDAVClient;
            (syncEngine as any).storage = mockStorage;
            (syncEngine as any).mapper = mockMapper;
        });

        it('should create new tasks in CalDAV when not yet synced', async () => {
            const task = {
                description: 'New task',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] New task #sync',
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            mockTaskManager.getAllTasks.mockReturnValue([task]);
            mockTaskManager.ensureTaskHasId.mockResolvedValue('test-id-001');
            mockStorage.getCalDAVFromTaskId.mockReturnValue(null); // Not yet synced
            mockMapper.taskToVTODO.mockReturnValue('VTODO-DATA');

            const result = await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.createVTODO).toHaveBeenCalledWith('VTODO-DATA', 'obsidian-test-id-001');
            expect(mockCalDAVClient.updateVTODO).not.toHaveBeenCalled();
            expect(mockStorage.addTaskMapping).toHaveBeenCalledWith('test-id-001', 'obsidian-test-id-001', 'test.md');
            expect(mockStorage.updateObsidianTimestamp).toHaveBeenCalledWith('test-id-001', '- [ ] New task #sync');
            expect(result.created).toBe(1);
            expect(result.updated).toBe(0);
        });

        it('should update existing tasks in CalDAV when content has changed', async () => {
            const task = {
                description: 'Existing task - modified',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] Existing task - modified #sync', // Current content
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const existingVTODO = {
                data: 'OLD-VTODO-DATA',
                url: 'https://caldav.example.com/calendar/task.ics',
                etag: 'etag-123'
            };

            const taskMapping = {
                caldavUID: 'obsidian-test-id-001',
                sourceFile: 'test.md',
                lastSyncedObsidian: '2025-01-01T00:00:00.000Z',
                lastSyncedCalDAV: '2025-01-01T00:00:00.000Z',
                lastModifiedObsidian: '- [ ] Existing task #sync', // Old content (no "- modified")
                lastModifiedCalDAV: '2025-01-01T00:00:00.000Z'
            };

            mockTaskManager.getAllTasks.mockReturnValue([task]);
            mockTaskManager.ensureTaskHasId.mockResolvedValue('test-id-001');
            mockStorage.getCalDAVFromTaskId.mockReturnValue('obsidian-test-id-001'); // Already synced
            mockStorage.getTaskMapping.mockReturnValue(taskMapping);
            mockCalDAVClient.fetchVTODOByUID.mockResolvedValue(existingVTODO);
            mockMapper.taskToVTODO.mockReturnValue('NEW-VTODO-DATA');

            const result = await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.fetchVTODOByUID).toHaveBeenCalledWith('obsidian-test-id-001');
            expect(mockCalDAVClient.updateVTODO).toHaveBeenCalledWith(existingVTODO, 'NEW-VTODO-DATA');
            expect(mockCalDAVClient.createVTODO).not.toHaveBeenCalled();
            expect(mockStorage.updateObsidianTimestamp).toHaveBeenCalledWith('test-id-001', '- [ ] Existing task - modified #sync');
            expect(result.created).toBe(0);
            expect(result.updated).toBe(1);
        });

        it('should handle mix of new and existing tasks', async () => {
            const newTask = {
                description: 'New task',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] New task #sync',
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const existingTask = {
                description: 'Existing task',
                tags: ['sync'],
                isDone: true,
                originalMarkdown: '- [x] Existing task #sync', // Changed from [ ] to [x]
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const existingVTODO = {
                data: 'OLD-VTODO-DATA',
                url: 'https://caldav.example.com/calendar/task.ics',
                etag: 'etag-123'
            };

            const taskMapping = {
                caldavUID: 'obsidian-existing-id-002',
                sourceFile: 'test.md',
                lastSyncedObsidian: '2025-01-01T00:00:00.000Z',
                lastSyncedCalDAV: '2025-01-01T00:00:00.000Z',
                lastModifiedObsidian: '- [ ] Existing task #sync', // Old content (not done)
                lastModifiedCalDAV: '2025-01-01T00:00:00.000Z'
            };

            mockTaskManager.getAllTasks.mockReturnValue([newTask, existingTask]);
            mockTaskManager.ensureTaskHasId
                .mockResolvedValueOnce('new-id-001')
                .mockResolvedValueOnce('existing-id-002');
            mockStorage.getCalDAVFromTaskId
                .mockReturnValueOnce(null) // New task - not synced
                .mockReturnValueOnce('obsidian-existing-id-002'); // Existing task
            mockStorage.getTaskMapping.mockReturnValue(taskMapping);
            mockCalDAVClient.fetchVTODOByUID.mockResolvedValue(existingVTODO);
            mockMapper.taskToVTODO
                .mockReturnValueOnce('NEW-VTODO-DATA')
                .mockReturnValueOnce('UPDATED-VTODO-DATA');

            const result = await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.createVTODO).toHaveBeenCalledTimes(1);
            expect(mockCalDAVClient.createVTODO).toHaveBeenCalledWith('NEW-VTODO-DATA', 'obsidian-new-id-001');
            expect(mockCalDAVClient.updateVTODO).toHaveBeenCalledTimes(1);
            expect(mockCalDAVClient.updateVTODO).toHaveBeenCalledWith(existingVTODO, 'UPDATED-VTODO-DATA');
            expect(result.created).toBe(1);
            expect(result.updated).toBe(1);
        });

        it('should skip update if VTODO not found in CalDAV', async () => {
            const task = {
                description: 'Orphaned task',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] Orphaned task - modified #sync',
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const taskMapping = {
                caldavUID: 'obsidian-orphan-id',
                sourceFile: 'test.md',
                lastSyncedObsidian: '2025-01-01T00:00:00.000Z',
                lastSyncedCalDAV: '2025-01-01T00:00:00.000Z',
                lastModifiedObsidian: '- [ ] Orphaned task #sync', // Old content
                lastModifiedCalDAV: '2025-01-01T00:00:00.000Z'
            };

            mockTaskManager.getAllTasks.mockReturnValue([task]);
            mockTaskManager.ensureTaskHasId.mockResolvedValue('orphan-id');
            mockStorage.getCalDAVFromTaskId.mockReturnValue('obsidian-orphan-id');
            mockStorage.getTaskMapping.mockReturnValue(taskMapping);
            mockCalDAVClient.fetchVTODOByUID.mockResolvedValue(null); // VTODO not found

            const result = await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.fetchVTODOByUID).toHaveBeenCalledWith('obsidian-orphan-id');
            expect(mockCalDAVClient.updateVTODO).not.toHaveBeenCalled();
            expect(result.created).toBe(0);
            expect(result.updated).toBe(0);
        });

        it('should continue processing other tasks if one update fails', async () => {
            const task1 = {
                description: 'Task that will fail',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] Task that will fail - v2 #sync',
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const task2 = {
                description: 'Task that will succeed',
                tags: ['sync'],
                isDone: false,
                originalMarkdown: '- [ ] Task that will succeed - v2 #sync',
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            const existingVTODO = {
                data: 'OLD-VTODO-DATA',
                url: 'https://caldav.example.com/calendar/task.ics',
                etag: 'etag-123'
            };

            const taskMapping = {
                caldavUID: '',
                sourceFile: 'test.md',
                lastSyncedObsidian: '2025-01-01T00:00:00.000Z',
                lastSyncedCalDAV: '2025-01-01T00:00:00.000Z',
                lastModifiedObsidian: '- [ ] Old content #sync', // Different from both
                lastModifiedCalDAV: '2025-01-01T00:00:00.000Z'
            };

            mockTaskManager.getAllTasks.mockReturnValue([task1, task2]);
            mockTaskManager.ensureTaskHasId
                .mockResolvedValueOnce('fail-id')
                .mockResolvedValueOnce('success-id');
            mockStorage.getCalDAVFromTaskId
                .mockReturnValueOnce('obsidian-fail-id')
                .mockReturnValueOnce('obsidian-success-id');
            mockStorage.getTaskMapping.mockReturnValue(taskMapping);
            mockCalDAVClient.fetchVTODOByUID.mockResolvedValue(existingVTODO);
            mockMapper.taskToVTODO
                .mockReturnValueOnce('FAIL-VTODO-DATA')
                .mockReturnValueOnce('SUCCESS-VTODO-DATA');
            mockCalDAVClient.updateVTODO
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce(undefined);

            const result = await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.updateVTODO).toHaveBeenCalledTimes(2);
            expect(result.created).toBe(0);
            expect(result.updated).toBe(1); // Only the successful one
        });

        it('should use correct CalDAV UID for new tasks', async () => {
            const task = {
                description: 'New task with specific ID',
                tags: ['sync'],
                isDone: false,
                taskLocation: { _tasksFile: { _path: 'test.md' } }
            };

            mockTaskManager.getAllTasks.mockReturnValue([task]);
            mockTaskManager.ensureTaskHasId.mockResolvedValue('my-custom-id-123');
            mockStorage.getCalDAVFromTaskId.mockReturnValue(null);
            mockMapper.taskToVTODO.mockReturnValue('VTODO-DATA');

            await (syncEngine as any).pushToCalDAV();

            expect(mockCalDAVClient.createVTODO).toHaveBeenCalledWith('VTODO-DATA', 'obsidian-my-custom-id-123');
        });
    });
});
