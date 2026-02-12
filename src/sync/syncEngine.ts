import { App, Notice } from 'obsidian';
import { TaskManager, ObsidianTask } from '../tasks/taskManager';
import { CalDAVClientDirect } from '../caldav/calDAVClientDirect';
import { SyncStorage } from '../storage/syncStorage';
import { CalDAVSettings } from '../types';
import { CalDAVAdapter } from './caldavAdapter';
import { ObsidianAdapter } from './obsidianAdapter';
import { diff } from './diff';
import { CommonTask, Conflict, ConflictStrategy, SyncChange } from './types';
import { generateTaskId } from '../utils/taskIdGenerator';

export interface SyncResult {
  success: boolean;
  message: string;
  created: { toObsidian: number; toCalDAV: number };
  updated: { toObsidian: number; toCalDAV: number };
  deleted: { toObsidian: number; toCalDAV: number };
  conflicts: number;
  details: {
    toObsidian: SyncChange[];
    toCalDAV: SyncChange[];
    conflictDetails: Conflict[];
    obsidianTasks?: CommonTask[];
    caldavTasks?: CommonTask[];
    baselineTasks?: CommonTask[];
  };
}

export class SyncEngine {
  private app: App;
  private settings: CalDAVSettings;
  private taskManager: TaskManager;
  private caldavClient: CalDAVClientDirect;
  private storage: SyncStorage;
  private caldavAdapter: CalDAVAdapter;
  private obsidianAdapter: ObsidianAdapter;

  constructor(app: App, settings: CalDAVSettings) {
    this.app = app;
    this.settings = settings;
    this.taskManager = new TaskManager(app);
    this.caldavClient = new CalDAVClientDirect(settings);
    this.storage = new SyncStorage(app);
    this.caldavAdapter = new CalDAVAdapter();
    this.obsidianAdapter = new ObsidianAdapter();
  }

  async initialize(): Promise<boolean> {
    const taskManagerReady = await this.taskManager.initialize();
    if (!taskManagerReady) {
      new Notice('obsidian-tasks plugin required for sync');
      return false;
    }

    await this.storage.initialize();
    return true;
  }

  async sync(dryRun: boolean = false): Promise<SyncResult> {
    try {
      const mode = dryRun ? '[DRY RUN] ' : '';
      new Notice(`${mode}Starting sync...`);
      console.log(`=== ${mode}Sync Started ===`);

      // 1. Connect to CalDAV
      new Notice(`${mode}Connecting to CalDAV server...`);
      await this.caldavClient.connect();

      // 2. Fetch CalDAV tasks → normalize to CommonTask[]
      const vtodos = await this.caldavClient.fetchVTODOs();
      const uidMapping = this.buildUidMapping();
      const caldavTasks = this.caldavAdapter.normalize(vtodos, uidMapping);
      console.log(`[Sync] CalDAV: ${caldavTasks.length} tasks`, caldavTasks.map(t => `${t.uid}: ${t.description}`));

      // 3. Get Obsidian tasks → filter by sync tag → inject IDs only on matching tasks
      const allObsidianTasks = this.taskManager.getAllTasks();
      const syncTagFiltered = this.filterBySyncTag(allObsidianTasks);
      for (const task of syncTagFiltered) {
        await this.taskManager.ensureTaskHasId(task);
      }
      const obsidianTasks = this.obsidianAdapter.normalize(
        this.taskManager.getAllTasks(), // Re-fetch after ID injection
        this.settings.syncTag,
      );
      console.log(`[Sync] Obsidian: ${obsidianTasks.length} tasks`, obsidianTasks.map(t => `${t.uid}: ${t.description}`));

      // 4. Load baseline — if empty, seed from already-mapped tasks so the
      //    first sync with this engine doesn't duplicate everything.
      let baseline = this.storage.getBaseline();
      if (baseline.length === 0 && Object.keys(this.storage.getMapping().tasks).length > 0) {
        baseline = this.seedBaselineFromMapping(obsidianTasks, caldavTasks);
        console.log(`Seeded baseline from existing mapping: ${baseline.length} tasks`);
      } else {
        console.log(`Baseline has ${baseline.length} tasks`);
      }

      // 5. Diff
      const strategy: ConflictStrategy = this.settings.autoResolveObsidianWins
        ? 'obsidian-wins'
        : 'caldav-wins';
      const changeset = diff(obsidianTasks, caldavTasks, baseline, strategy);

      console.log(`[Sync] Baseline: ${baseline.length} tasks`, baseline.map(t => `${t.uid}: ${t.description}`));
      console.log(`[Sync] Changeset: toObsidian=${changeset.toObsidian.length}, toCalDAV=${changeset.toCalDAV.length}, conflicts=${changeset.conflicts.length}`);
      for (const c of changeset.toObsidian) {
        console.log(`[Sync]   → Obsidian: ${c.type} "${c.task.description}" (uid: ${c.task.uid})`);
      }
      for (const c of changeset.toCalDAV) {
        console.log(`[Sync]   → CalDAV: ${c.type} "${c.task.description}" (uid: ${c.task.uid})`);
      }

      const result: SyncResult = {
        success: true,
        message: '',
        created: { toObsidian: 0, toCalDAV: 0 },
        updated: { toObsidian: 0, toCalDAV: 0 },
        deleted: { toObsidian: 0, toCalDAV: 0 },
        conflicts: changeset.conflicts.length,
        details: {
          toObsidian: changeset.toObsidian,
          toCalDAV: changeset.toCalDAV,
          conflictDetails: changeset.conflicts,
          obsidianTasks,
          caldavTasks,
          baselineTasks: baseline,
        },
      };

      // Count changes by type
      for (const change of changeset.toObsidian) {
        result[change.type === 'create' ? 'created' : change.type === 'update' ? 'updated' : 'deleted'].toObsidian++;
      }
      for (const change of changeset.toCalDAV) {
        result[change.type === 'create' ? 'created' : change.type === 'update' ? 'updated' : 'deleted'].toCalDAV++;
      }

      if (dryRun) {
        result.message = `Dry run complete! Would sync:\n` +
          `From CalDAV: ${result.created.toObsidian} created, ${result.updated.toObsidian} updated, ${result.deleted.toObsidian} deleted\n` +
          `To CalDAV: ${result.created.toCalDAV} created, ${result.updated.toCalDAV} updated, ${result.deleted.toCalDAV} deleted\n` +
          `Conflicts: ${result.conflicts}\n\nNo changes were made.`;
        new Notice(result.message, 10000);
        console.log('=== Dry Run Complete ===');
        return result;
      }

      // 6. Apply changes to Obsidian
      await this.applyObsidianChanges(changeset.toObsidian);

      // 7. Apply changes to CalDAV
      await this.caldavAdapter.applyChanges(changeset.toCalDAV, this.caldavClient, uidMapping);

      // 8. Update mappings for new tasks
      this.updateMappingsAfterSync(changeset);

      // 9. Save new baseline (union of current state after applying changes)
      const newBaseline = this.computeNewBaseline(obsidianTasks, caldavTasks, changeset);
      this.storage.setBaseline(newBaseline);

      // 10. Save state
      this.storage.updateLastSyncTime();
      await this.storage.save();

      result.message = `Sync complete! ` +
        `From CalDAV: ${result.created.toObsidian}+${result.updated.toObsidian}+${result.deleted.toObsidian} | ` +
        `To CalDAV: ${result.created.toCalDAV}+${result.updated.toCalDAV}+${result.deleted.toCalDAV}`;
      new Notice(result.message, 5000);
      console.log('=== Sync Complete ===');

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const message = `Sync failed: ${errorMsg}`;
      new Notice(message, 8000);
      console.error('Sync error:', error);
      return {
        success: false,
        message,
        created: { toObsidian: 0, toCalDAV: 0 },
        updated: { toObsidian: 0, toCalDAV: 0 },
        deleted: { toObsidian: 0, toCalDAV: 0 },
        conflicts: 0,
        details: { toObsidian: [], toCalDAV: [], conflictDetails: [] },
      };
    }
  }

  async getStatus(): Promise<string> {
    const state = this.storage.getState();
    const mapping = this.storage.getMapping();
    const baseline = this.storage.getBaseline();

    const lastSync = state.lastSyncTime ? new Date(state.lastSyncTime).toLocaleString() : 'Never';
    const mappedTasks = Object.keys(mapping.tasks).length;
    const baselineTasks = baseline.length;
    const conflicts = state.conflicts.length;

    return `Last sync: ${lastSync}\nMapped tasks: ${mappedTasks}\nBaseline tasks: ${baselineTasks}\nConflicts: ${conflicts}`;
  }

  /**
   * Filter tasks by the configured sync tag.
   * Only these tasks should get IDs injected and be synced.
   */
  private filterBySyncTag(tasks: ObsidianTask[]): ObsidianTask[] {
    const syncTag = this.settings.syncTag;
    if (!syncTag || syncTag.trim() === '') return tasks;

    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return tasks.filter(task => {
      if (!task.tags || task.tags.length === 0) return false;
      return task.tags.some((tag: string) =>
        tag.toLowerCase().replace(/^#/, '') === tagLower
      );
    });
  }

  /**
   * Seed baseline from existing mapping data.
   * Used on first sync with the new engine to avoid duplicating
   * tasks that were already synced by the old engine.
   * For each mapped task, use whichever side has it — preferring
   * Obsidian (since it's the source of truth for content).
   */
  private seedBaselineFromMapping(obsidianTasks: CommonTask[], caldavTasks: CommonTask[]): CommonTask[] {
    const mapping = this.storage.getMapping();
    const obsidianByUid = new Map(obsidianTasks.map(t => [t.uid, t]));
    const caldavByUid = new Map(caldavTasks.map(t => [t.uid, t]));
    const baseline: CommonTask[] = [];

    for (const taskId of Object.keys(mapping.tasks)) {
      const obs = obsidianByUid.get(taskId);
      const cal = caldavByUid.get(taskId);
      if (obs) {
        baseline.push(obs);
      } else if (cal) {
        baseline.push(cal);
      }
    }

    return baseline;
  }

  /**
   * Build CalDAV UID → Obsidian task ID mapping from storage.
   */
  private buildUidMapping(): Map<string, string> {
    const mapping = this.storage.getMapping();
    const uidMap = new Map<string, string>();

    for (const [taskId, taskMapping] of Object.entries(mapping.tasks)) {
      uidMap.set(taskMapping.caldavUID, taskId);
    }

    return uidMap;
  }

  /**
   * Apply changes to Obsidian vault (creates, updates, deletes).
   */
  private async applyObsidianChanges(changes: SyncChange[]): Promise<void> {
    for (const change of changes) {
      try {
        switch (change.type) {
          case 'create': {
            const taskId = generateTaskId();
            const markdown = this.obsidianAdapter.toMarkdown(
              change.task,
              taskId,
              this.settings.syncTag,
            );

            await this.taskManager.createTask(
              markdown,
              this.settings.newTasksDestination,
              this.settings.newTasksSection,
            );

            // Add mapping: the task's uid from CalDAV becomes mapped to new obsidian task ID
            this.storage.addTaskMapping(taskId, change.task.uid, this.settings.newTasksDestination);
            console.log(`Created task ${taskId} from CalDAV ${change.task.uid}`);
            break;
          }

          case 'update': {
            const existingTask = this.taskManager.findTaskById(change.task.uid);
            if (!existingTask) {
              console.warn(`Task ${change.task.uid} not found in vault for update`);
              continue;
            }

            const markdown = this.obsidianAdapter.toMarkdown(
              change.task,
              change.task.uid,
              this.settings.syncTag,
            );

            await this.taskManager.updateTaskInVault(existingTask, markdown);
            console.log(`Updated task ${change.task.uid} in Obsidian`);
            break;
          }

          case 'delete': {
            // For now, log the delete. Full delete from vault requires careful handling.
            // Remove from mapping so it won't be synced back.
            this.storage.removeTaskMapping(change.task.uid);
            console.log(`Deleted task ${change.task.uid} from sync (removed mapping)`);
            break;
          }
        }
      } catch (error) {
        console.error(`Failed to apply ${change.type} for task ${change.task.uid}:`, error);
      }
    }
  }

  /**
   * Update mappings after sync to track newly created tasks.
   */
  private updateMappingsAfterSync(changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] }): void {
    // For tasks created on CalDAV side, the mapping was already added in applyObsidianChanges.

    // For tasks created on CalDAV from Obsidian, add mapping.
    for (const change of changeset.toCalDAV) {
      if (change.type === 'create') {
        const caldavUID = `obsidian-${change.task.uid}`;
        const existingTask = this.taskManager.findTaskById(change.task.uid);
        const sourceFile = existingTask
          ? existingTask.taskLocation._tasksFile._path
          : this.settings.newTasksDestination;
        this.storage.addTaskMapping(change.task.uid, caldavUID, sourceFile);
      }

      if (change.type === 'delete') {
        this.storage.removeTaskMapping(change.task.uid);
      }
    }

    // Handle Obsidian-side deletes (already done in applyObsidianChanges)
  }

  /**
   * Compute the new baseline after applying changes.
   * The baseline should reflect the "agreed upon" state of both sides.
   */
  private computeNewBaseline(
    obsidianTasks: CommonTask[],
    caldavTasks: CommonTask[],
    changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
  ): CommonTask[] {
    const baselineMap = new Map<string, CommonTask>();

    // Start with current obsidian state (this is what Obsidian has now, pre-apply)
    for (const task of obsidianTasks) {
      baselineMap.set(task.uid, task);
    }

    // Merge in CalDAV tasks (covers tasks only on CalDAV)
    for (const task of caldavTasks) {
      if (!baselineMap.has(task.uid)) {
        baselineMap.set(task.uid, task);
      }
    }

    // Apply the changeset to get the "after sync" state
    for (const change of changeset.toObsidian) {
      if (change.type === 'create' || change.type === 'update') {
        baselineMap.set(change.task.uid, change.task);
      } else if (change.type === 'delete') {
        baselineMap.delete(change.task.uid);
      }
    }

    for (const change of changeset.toCalDAV) {
      if (change.type === 'create' || change.type === 'update') {
        baselineMap.set(change.task.uid, change.task);
      } else if (change.type === 'delete') {
        baselineMap.delete(change.task.uid);
      }
    }

    return Array.from(baselineMap.values());
  }
}
