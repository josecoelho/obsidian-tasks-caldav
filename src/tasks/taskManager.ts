import { App, TFile, Vault } from 'obsidian';
import { ensureTaskId, extractTaskId } from '../utils/taskIdGenerator';

/**
 * Represents a task from obsidian-tasks plugin
 * Based on actual Task structure from obsidian-tasks
 */
export interface ObsidianTask {
    description: string;
    status: {
        configuration: {
            symbol: string;
            name: string;
            type: string;
        };
    };
    isDone: boolean;
    priority: string;
    tags: string[];
    taskLocation: {
        _tasksFile: {
            _path: string;
        };
        _lineNumber: number;
    };
    originalMarkdown: string;
    createdDate: string | null;
    startDate: string | null;
    scheduledDate: string | null;
    dueDate: string | null;
    doneDate: string | null;
    cancelledDate: string | null;
    recurrence: any | null;
    id: string;
}

/**
 * Interface for obsidian-tasks plugin
 */
interface ObsidianTasksPlugin {
    getTasks(): ObsidianTask[];
    apiV1?: any;
}

/**
 * Manages tasks from obsidian-tasks plugin
 * Handles filtering, ID injection, and CRUD operations
 */
export class TaskManager {
    private app: App;
    private tasksPlugin: ObsidianTasksPlugin | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Initialize task manager and verify obsidian-tasks is available
     */
    async initialize(): Promise<boolean> {
        // Access obsidian-tasks plugin
        const plugin = (this.app as any).plugins.plugins['obsidian-tasks-plugin'];

        if (!plugin || typeof plugin.getTasks !== 'function') {
            console.error('obsidian-tasks plugin not found or getTasks() method unavailable');
            return false;
        }

        this.tasksPlugin = plugin as ObsidianTasksPlugin;
        return true;
    }

    /**
     * Check if task manager is ready
     */
    isReady(): boolean {
        return this.tasksPlugin !== null;
    }

    /**
     * Get all tasks from obsidian-tasks cache
     */
    getAllTasks(): ObsidianTask[] {
        if (!this.tasksPlugin) {
            console.error('Task manager not initialized');
            return [];
        }

        return this.tasksPlugin.getTasks();
    }

    /**
     * Get tasks that should be synced based on query
     * @param query Sync query string (e.g., "not done", "tags include #sync")
     */
    getTasksToSync(query: string): ObsidianTask[] {
        const allTasks = this.getAllTasks();
        return this.filterTasks(allTasks, query);
    }

    /**
     * Filter tasks based on sync query
     * Supports simple queries initially:
     * - "not done" - only incomplete tasks
     * - "done" - only completed tasks
     * - "tags include #tagname" - tasks with specific tag
     * - "all" - all tasks
     */
    filterTasks(tasks: ObsidianTask[], query: string): ObsidianTask[] {
        const lowerQuery = query.toLowerCase().trim();

        // Handle "not done" query
        if (lowerQuery === 'not done') {
            return tasks.filter(task => !task.isDone);
        }

        // Handle "done" query
        if (lowerQuery === 'done') {
            return tasks.filter(task => task.isDone);
        }

        // Handle "tags include #tagname" query
        const tagMatch = lowerQuery.match(/tags?\s+include\s+#?(\S+)/);
        if (tagMatch) {
            const tagName = tagMatch[1];
            return tasks.filter(task =>
                task.tags.some(tag => tag.toLowerCase() === tagName.toLowerCase())
            );
        }

        // Handle "all" query
        if (lowerQuery === 'all') {
            return tasks;
        }

        // Default: return all non-done tasks
        console.warn(`Unsupported query: "${query}", defaulting to "not done"`);
        return tasks.filter(task => !task.isDone);
    }

    /**
     * Check if a task has an ID
     */
    taskHasId(task: ObsidianTask): boolean {
        // Check obsidian-tasks id field
        if (task.id && task.id.length > 0) {
            return true;
        }

        // Check for [id::xxx] in markdown
        const id = extractTaskId(task.originalMarkdown);
        return id !== null;
    }

    /**
     * Get task ID from task
     */
    getTaskId(task: ObsidianTask): string | null {
        // Check obsidian-tasks id field first
        if (task.id && task.id.length > 0) {
            return task.id;
        }

        // Extract from markdown
        return extractTaskId(task.originalMarkdown);
    }

    /**
     * Find a task by its ID
     * @returns The task if found, null otherwise
     */
    findTaskById(taskId: string): ObsidianTask | null {
        const allTasks = this.getAllTasks();

        for (const task of allTasks) {
            const id = this.getTaskId(task);
            if (id === taskId) {
                return task;
            }
        }

        return null;
    }

    /**
     * Ensure a task has an ID, inject if missing
     * @returns The task ID (existing or newly generated)
     */
    async ensureTaskHasId(task: ObsidianTask): Promise<string> {
        const existingId = this.getTaskId(task);
        if (existingId) {
            return existingId;
        }

        // Generate and inject new ID
        const result = ensureTaskId(task.originalMarkdown);

        if (result.modified) {
            // Update the task in the file
            await this.updateTaskInVault(task, result.text);
        }

        return result.id;
    }

    /**
     * Update a task's content in the vault
     */
    async updateTaskInVault(task: ObsidianTask, newContent: string): Promise<void> {
        const filePath = task.taskLocation._tasksFile._path;

        // Get the file
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Read current content
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        // Find the task by its original markdown (don't trust line numbers from cache)
        const originalMarkdown = task.originalMarkdown;
        const taskIndex = lines.findIndex(line => line.trim() === originalMarkdown.trim());

        if (taskIndex === -1) {
            throw new Error(`Could not find task in file: ${originalMarkdown}`);
        }

        // Update the line
        lines[taskIndex] = newContent;

        // Write back to file
        await this.app.vault.modify(file, lines.join('\n'));
    }

    /**
     * Create a new task in the destination file
     * @param taskContent The task markdown (e.g., "- [ ] New task")
     * @param destinationPath Path to the file where task should be added
     * @param section Optional section heading under which to add the task
     */
    async createTask(
        taskContent: string,
        destinationPath: string,
        section?: string
    ): Promise<void> {
        // Get or create the destination file
        let file = this.app.vault.getAbstractFileByPath(destinationPath);

        if (!file) {
            // Create new file
            await this.app.vault.create(destinationPath, taskContent + '\n');
            return;
        }

        if (!(file instanceof TFile)) {
            throw new Error(`Path is not a file: ${destinationPath}`);
        }

        // Read existing content
        let content = await this.app.vault.read(file);

        if (section) {
            // Try to find the section
            const sectionHeader = `## ${section}`;
            const lines = content.split('\n');
            const sectionIndex = lines.findIndex(line =>
                line.trim() === sectionHeader ||
                line.trim() === `# ${section}`
            );

            if (sectionIndex !== -1) {
                // Insert after section header
                lines.splice(sectionIndex + 1, 0, taskContent);
                content = lines.join('\n');
            } else {
                // Section not found, create it at the end
                content += `\n\n${sectionHeader}\n${taskContent}`;
            }
        } else {
            // Append to end of file
            content += '\n' + taskContent;
        }

        // Write back
        await this.app.vault.modify(file, content);
    }

    /**
     * Get statistics about tasks
     */
    getTaskStats(tasks: ObsidianTask[]): {
        total: number;
        done: number;
        notDone: number;
        withIds: number;
        withoutIds: number;
    } {
        const stats = {
            total: tasks.length,
            done: 0,
            notDone: 0,
            withIds: 0,
            withoutIds: 0
        };

        tasks.forEach(task => {
            if (task.isDone) {
                stats.done++;
            } else {
                stats.notDone++;
            }

            if (this.taskHasId(task)) {
                stats.withIds++;
            } else {
                stats.withoutIds++;
            }
        });

        return stats;
    }
}
