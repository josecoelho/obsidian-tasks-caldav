import { App, Notice, TFile } from 'obsidian';
import { TaskManager, ObsidianTask } from '../tasks/taskManager';
import { CalDAVClientDirect } from '../caldav/calDAVClientDirect';
import { VTODOMapper } from '../caldav/vtodoMapper';
import { SyncStorage } from '../storage/syncStorage';
import { CalDAVSettings } from '../types';
import { generateTaskId } from '../utils/taskIdGenerator';

/**
 * Minimal Sync Engine - MVP implementation
 *
 * Simple bidirectional sync:
 * 1. Pull VTODOs from CalDAV
 * 2. Create new tasks in Obsidian from CalDAV
 * 3. Push Obsidian tasks to CalDAV
 *
 * Simplifications for MVP:
 * - No conflict resolution (Obsidian wins)
 * - No delete handling yet
 * - No change detection (sync everything)
 * - Basic error handling
 */
export class SyncEngine {
    private app: App;
    private settings: CalDAVSettings;
    private taskManager: TaskManager;
    private caldavClient: CalDAVClientDirect;
    private mapper: VTODOMapper;
    private storage: SyncStorage;

    constructor(app: App, settings: CalDAVSettings) {
        this.app = app;
        this.settings = settings;
        this.taskManager = new TaskManager(app);
        this.caldavClient = new CalDAVClientDirect(settings);
        this.mapper = new VTODOMapper();
        this.storage = new SyncStorage(app);
    }

    /**
     * Initialize sync engine
     */
    async initialize(): Promise<boolean> {
        // Initialize TaskManager
        const taskManagerReady = await this.taskManager.initialize();
        if (!taskManagerReady) {
            new Notice('❌ obsidian-tasks plugin required for sync');
            return false;
        }

        // Initialize storage
        await this.storage.initialize();

        return true;
    }

    /**
     * Perform a sync (MVP: manual sync only)
     */
    async sync(): Promise<{ success: boolean; message: string }> {
        try {
            new Notice('🔄 Starting sync...');
            console.log('=== Sync Started ===');

            // Step 1: Connect to CalDAV
            new Notice('📡 Connecting to CalDAV server...');
            console.log('Connecting to CalDAV...');
            await this.caldavClient.connect();
            console.log('✅ Connected to CalDAV');

            // Step 2: Pull from CalDAV (with change detection)
            new Notice('⬇️ Pulling tasks from CalDAV...');
            const pullResult = await this.pullFromCalDAV();
            console.log(`Pull result: ${pullResult.created} created, ${pullResult.updated} updated`);

            // Step 3: Push to CalDAV (with change detection)
            new Notice('⬆️ Pushing tasks to CalDAV...');
            const pushResult = await this.pushToCalDAV();
            console.log(`Push result: ${pushResult.created} created, ${pushResult.updated} updated`);

            // Step 4: Update last sync time and save to disk
            this.storage.updateLastSyncTime();
            await this.storage.save();

            const message = `✅ Sync complete! ⬇️ ${pullResult.created} created, ${pullResult.updated} updated | ⬆️ ${pushResult.created} created, ${pushResult.updated} updated`;
            new Notice(message, 5000);
            console.log('=== Sync Complete ===');

            return { success: true, message };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const message = `❌ Sync failed: ${errorMsg}`;
            new Notice(message, 8000);
            console.error('Sync error:', error);

            return { success: false, message };
        }
    }

    /**
     * Pull VTODOs from CalDAV and create/update tasks in Obsidian
     */
    private async pullFromCalDAV(): Promise<{ created: number; updated: number }> {
        let created = 0;
        let updated = 0;

        // Get all VTODOs from CalDAV
        const vtodos = await this.caldavClient.fetchVTODOs();
        console.log(`Fetched ${vtodos.length} VTODOs from CalDAV`);

        for (const vtodo of vtodos) {
            const caldavUID = this.mapper.extractUID(vtodo.data);
            if (!caldavUID) {
                console.warn('VTODO missing UID, skipping');
                continue;
            }

            // Check if we already track this VTODO
            const existingTaskId = this.storage.getTaskIdFromCalDAV(caldavUID);

            if (existingTaskId) {
                // Check if CalDAV version is newer than last sync
                const taskMapping = this.storage.getTaskMapping(existingTaskId);
                const caldavLastModified = this.mapper.extractLastModified(vtodo.data);

                if (!taskMapping) {
                    console.warn(`Task ${existingTaskId} has no mapping, skipping`);
                    continue;
                }

                // Only update if CalDAV has been modified since last sync
                if (caldavLastModified && caldavLastModified > taskMapping.lastModifiedCalDAV) {
                    const existingTask = this.taskManager.findTaskById(existingTaskId);

                    if (!existingTask) {
                        console.warn(`Task ${existingTaskId} mapped to ${caldavUID} not found in vault, skipping`);
                        continue;
                    }

                    // Parse VTODO to get latest task data
                    const updatedTaskData = this.mapper.vtodoToTask(vtodo);

                    // Generate updated markdown from VTODO data
                    const updatedMarkdown = this.createTaskMarkdown(updatedTaskData, existingTaskId, this.settings.syncTag);

                    // Update task in vault
                    await this.taskManager.updateTaskInVault(existingTask, updatedMarkdown);
                    console.log(`Updated task ${existingTaskId} from VTODO ${caldavUID} (CalDAV modified: ${caldavLastModified})`);
                    updated++;

                    // Update CalDAV timestamp in mapping
                    this.storage.updateCalDAVTimestamp(existingTaskId, caldavLastModified);

                    // Update Obsidian content hash to match what we just wrote
                    this.storage.updateObsidianTimestamp(existingTaskId, updatedMarkdown.trim());
                }
                // Skip logging for unchanged tasks to reduce verbosity
            } else {
                // Create new task in Obsidian
                const task = this.mapper.vtodoToTask(vtodo);

                // Generate a new task ID for this task
                const taskId = generateTaskId();
                const taskLine = this.createTaskMarkdown(task, taskId, this.settings.syncTag);

                // Create task in destination file
                await this.taskManager.createTask(
                    taskLine,
                    this.settings.newTasksDestination,
                    this.settings.newTasksSection
                );

                console.log(`Created new task from VTODO ${caldavUID}: ${task.description} with ID ${taskId}`);
                created++;

                // Add mapping so we don't duplicate on next sync
                this.storage.addTaskMapping(taskId, caldavUID, this.settings.newTasksDestination);
            }
        }

        return { created, updated };
    }

    /**
     * Push Obsidian tasks to CalDAV
     */
    private async pushToCalDAV(): Promise<{ created: number; updated: number }> {
        let created = 0;
        let updated = 0;

        // Get tasks to sync from Obsidian based on tag
        const allTasks = this.taskManager.getAllTasks();
        const tasksToSync = this.filterTasksByTag(allTasks, this.settings.syncTag);
        console.log(`Found ${tasksToSync.length} tasks to sync (tag: #${this.settings.syncTag})`);

        // Process each task: ensure ID, check if already synced
        const newTasks = [];
        const existingTasks = [];

        for (const task of tasksToSync) {
            // Ensure task has ID (will add if missing, writes to file immediately)
            const taskId = await this.taskManager.ensureTaskHasId(task);

            // Check if already synced to CalDAV
            const caldavUID = this.storage.getCalDAVFromTaskId(taskId);
            if (!caldavUID) {
                // Not yet synced to CalDAV
                newTasks.push({ task, taskId });
            } else {
                // Already synced, needs update
                existingTasks.push({ task, taskId, caldavUID });
            }
        }

        console.log(`${newTasks.length} tasks need to be created in CalDAV`);
        console.log(`${existingTasks.length} tasks need to be updated in CalDAV`);

        // Create new tasks in CalDAV
        for (const { task, taskId } of newTasks) {
            try {
                // Generate CalDAV UID (use task ID as basis)
                const caldavUID = `obsidian-${taskId}`;

                // Convert to VTODO
                const obsidianTask = this.convertToObsidianTaskFormat(task);
                const vtodoData = this.mapper.taskToVTODO(obsidianTask, caldavUID);

                // Create in CalDAV
                await this.caldavClient.createVTODO(vtodoData, caldavUID);

                // Save mapping with initial content hash
                this.storage.addTaskMapping(taskId, caldavUID, task.taskLocation._tasksFile._path);

                // Store the current content as the baseline
                const currentContent = this.getTaskContentHash(task);
                this.storage.updateObsidianTimestamp(taskId, currentContent);

                console.log(`Created task ${taskId} in CalDAV as ${caldavUID}`);
                created++;

            } catch (error) {
                console.error(`Failed to create task in CalDAV: ${task.description}`, error);
                // Continue with other tasks
            }
        }

        // Update existing tasks in CalDAV
        for (const { task, taskId, caldavUID } of existingTasks) {
            try {
                // Check if Obsidian task content has changed
                const taskMapping = this.storage.getTaskMapping(taskId);
                const currentContent = this.getTaskContentHash(task);

                if (!taskMapping) {
                    console.warn(`Task ${taskId} has no mapping, skipping`);
                    continue;
                }

                // Get the last synced content from mapping
                const lastSyncedContent = taskMapping.lastModifiedObsidian;

                // Only update if task content has actually changed
                if (currentContent !== lastSyncedContent) {
                    // Fetch existing VTODO to get URL and etag
                    const existingVTODO = await this.caldavClient.fetchVTODOByUID(caldavUID);

                    if (!existingVTODO) {
                        console.warn(`VTODO ${caldavUID} not found in CalDAV, skipping update`);
                        continue;
                    }

                    // Convert to VTODO
                    const obsidianTask = this.convertToObsidianTaskFormat(task);
                    const newVTODOData = this.mapper.taskToVTODO(obsidianTask, caldavUID);

                    // Update in CalDAV
                    await this.caldavClient.updateVTODO(existingVTODO, newVTODOData);

                    console.log(`Updated task ${taskId} in CalDAV (${caldavUID}) (content changed)`);
                    updated++;

                    // Update content hash in mapping
                    this.storage.updateObsidianTimestamp(taskId, currentContent);
                }
                // Skip logging for unchanged tasks to reduce verbosity

            } catch (error) {
                console.error(`Failed to update task in CalDAV: ${task.description}`, error);
                // Continue with other tasks
            }
        }

        return { created, updated };
    }

    /**
     * Convert obsidian-tasks Task to our ObsidianTask format for mapper
     */
    private convertToObsidianTaskFormat(task: any): any {
        return {
            description: this.cleanTaskDescription(task.description),
            status: task.isDone ? 'DONE' : 'TODO',
            dueDate: task.dueDate ? task.dueDate.format('YYYY-MM-DD') : null,
            scheduledDate: task.scheduledDate ? task.scheduledDate.format('YYYY-MM-DD') : null,
            startDate: task.startDate ? task.startDate.format('YYYY-MM-DD') : null,
            completedDate: task.doneDate ? task.doneDate.format('YYYY-MM-DD') : null,
            priority: this.mapPriority(task.priority),
            recurrenceRule: task.recurrence ? task.recurrence.toText() : '',
            tags: this.cleanTags(task.tags || [])
        };
    }

    /**
     * Clean task description by removing metadata that belongs in other fields
     *
     * Note: obsidian-tasks already parses out date emojis (⏳, 📅, ✅) from the description,
     * so we only need to remove:
     * - bd-2: Tags (#tag) - already in task.tags array
     * - bd-4: Task ID ([id::xxx]) - internal Obsidian metadata
     */
    private cleanTaskDescription(description: string): string {
        let cleaned = description;

        // bd-4: Remove [id::xxx] pattern
        cleaned = cleaned.replace(/\[id::[^\]]+\]/g, '');

        // bd-2: Remove hashtags (but not # followed by numbers like #42)
        cleaned = cleaned.replace(/#[a-zA-Z][\w-]*/g, '');

        // Clean up extra whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }

    /**
     * Clean tags by removing # prefix
     * Fixes bd-1: VTODO CATEGORIES should not include # character
     */
    private cleanTags(tags: string[]): string[] {
        return tags.map(tag => tag.replace(/^#/, ''));
    }

    /**
     * Map obsidian-tasks priority to our format
     */
    private mapPriority(priority: string): string {
        // obsidian-tasks uses 1-6, we use lowest/low/medium/high/highest
        const priorityMap: Record<string, string> = {
            '1': 'highest',
            '2': 'high',
            '3': 'medium',
            '4': 'medium',
            '5': 'low',
            '6': 'lowest'
        };
        return priorityMap[priority] || 'none';
    }

    /**
     * Filter tasks by sync tag
     */
    private filterTasksByTag(tasks: any[], syncTag: string): any[] {
        if (!syncTag || syncTag.trim() === '') {
            // No tag filter, sync all tasks
            return tasks;
        }

        // Filter tasks that have the sync tag
        const tagLower = syncTag.toLowerCase().replace(/^#/, ''); // Remove leading # if present
        return tasks.filter(task => {
            if (!task.tags || task.tags.length === 0) {
                return false;
            }
            return task.tags.some((tag: string) =>
                tag.toLowerCase().replace(/^#/, '') === tagLower
            );
        });
    }

    /**
     * Create markdown task line from VTODO task
     */
    private createTaskMarkdown(task: any, taskId: string, syncTag?: string): string {
        let line = '- [ ] ';

        if (task.status === 'DONE') {
            line = '- [x] ';
        }

        line += task.description;

        // Add dates if present (use date-only format, not timestamp)
        if (task.scheduledDate) {
            const dateOnly = task.scheduledDate.split('T')[0];
            line += ` ⏳ ${dateOnly}`;
        }
        if (task.dueDate) {
            const dateOnly = task.dueDate.split('T')[0];
            line += ` 📅 ${dateOnly}`;
        }
        if (task.completedDate) {
            const dateOnly = task.completedDate.split('T')[0];
            line += ` ✅ ${dateOnly}`;
        }

        // Add sync tag if specified
        if (syncTag && syncTag.trim() !== '') {
            const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
            line += ` ${tag}`;
        }

        // Add task ID
        line += ` [id::${taskId}]`;

        return line;
    }

    /**
     * Get a hash of the task's content for change detection
     * Simple hash based on the task's markdown representation
     */
    private getTaskContentHash(task: any): string {
        // Use the task's markdown as the basis for comparison
        // This way we detect actual task changes, not just file mtime
        return task.originalMarkdown.trim();
    }

    /**
     * Get sync status
     */
    async getStatus(): Promise<string> {
        const state = this.storage.getState();
        const mapping = this.storage.getMapping();

        const lastSync = state.lastSyncTime ? new Date(state.lastSyncTime).toLocaleString() : 'Never';
        const mappedTasks = Object.keys(mapping.tasks).length;
        const conflicts = state.conflicts.length;

        return `Last sync: ${lastSync}\nMapped tasks: ${mappedTasks}\nConflicts: ${conflicts}`;
    }
}
