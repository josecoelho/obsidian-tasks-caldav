/**
 * Mock implementation of obsidian-tasks API for testing
 */

import { TasksApiV1 } from '../src/types/obsidianTasksApi';

export class MockTasksApiV1 implements TasksApiV1 {
    private mockTasks: Map<string, string> = new Map();

    async createTaskLineModal(): Promise<string> {
        // Return a mock task for testing
        return '- [ ] Mock task created';
    }

    async editTaskLineModal(taskLine: string): Promise<string> {
        // Return the edited version (for testing, just add " (edited)")
        return taskLine + ' (edited)';
    }

    executeToggleTaskDoneCommand(line: string, path: string): string {
        // Toggle between [ ] and [x]
        if (line.includes('- [ ]')) {
            return line.replace('- [ ]', '- [x]');
        } else if (line.includes('- [x]')) {
            return line.replace('- [x]', '- [ ]');
        }
        return line;
    }

    // Test helpers
    setMockTask(path: string, task: string): void {
        this.mockTasks.set(path, task);
    }

    getMockTask(path: string): string | undefined {
        return this.mockTasks.get(path);
    }

    clearMocks(): void {
        this.mockTasks.clear();
    }
}

/**
 * Factory for creating mock API
 */
export function createMockTasksApi(): TasksApiV1 {
    return new MockTasksApiV1();
}
