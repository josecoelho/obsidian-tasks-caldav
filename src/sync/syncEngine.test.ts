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
});
