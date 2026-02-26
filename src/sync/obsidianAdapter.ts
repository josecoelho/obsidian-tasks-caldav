import { CommonTask, SyncChange } from './types';
import { ObsidianTask, TaskWithBody, ObsidianTasksWrapper } from '../tasks/obsidianTasksWrapper';
import { ObsidianMapper } from '../tasks/obsidianMapper';
import { generateTaskId } from '../utils/taskIdGenerator';

// Re-export for backwards compatibility
export type { TaskWithBody } from '../tasks/obsidianTasksWrapper';

export interface NormalizeResult {
  tasks: CommonTask[];
  tasksById: Map<string, ObsidianTask>;
}

export class ObsidianAdapter {
  private mapper: ObsidianMapper;

  constructor(mapper?: ObsidianMapper) {
    this.mapper = mapper ?? new ObsidianMapper();
  }

  /**
   * Normalize pre-filtered TaskWithBody[] into CommonTask[].
   * Assigns IDs internally: uses existing ID from task.id, or generates
   * an in-memory ID via generateTaskId().
   */
  normalize(
    inputs: TaskWithBody[],
    extractId: (task: ObsidianTask) => string | null,
  ): NormalizeResult {
    const tasks: CommonTask[] = [];
    const tasksById = new Map<string, ObsidianTask>();

    for (const { task, body } of inputs) {
      const taskId = extractId(task) ?? generateTaskId();
      tasksById.set(taskId, task);
      tasks.push(this.mapper.toCommonTask(task, taskId, body));
    }

    return { tasks, tasksById };
  }

  /**
   * Apply sync changes to the Obsidian vault (creates, updates, deletes).
   */
  async applyChanges(
    changes: SyncChange[],
    wrapper: ObsidianTasksWrapper,
    tasksById: Map<string, ObsidianTask>,
    settings: { syncTag?: string; newTasksDestination: string; newTasksSection?: string },
  ): Promise<Array<{ taskId: string; caldavUID: string; sourceFile: string }>> {
    const createdMappings: Array<{ taskId: string; caldavUID: string; sourceFile: string }> = [];

    for (const change of changes) {
      try {
        switch (change.type) {
          case 'create': {
            const taskId = generateTaskId();
            const taskWithId: CommonTask = { ...change.task, uid: taskId };
            const markdown = this.mapper.toMarkdown(taskWithId, settings.syncTag);

            await wrapper.createTask(
              markdown,
              settings.newTasksDestination,
              settings.newTasksSection,
            );

            createdMappings.push({
              taskId,
              caldavUID: change.task.uid,
              sourceFile: settings.newTasksDestination,
            });
            break;
          }

          case 'update': {
            const existingTask = tasksById.get(change.task.uid)
              ?? wrapper.findTaskById(change.task.uid);
            if (!existingTask) continue;

            const markdown = this.mapper.toMarkdown(change.task, settings.syncTag);
            await wrapper.updateTaskInVault(existingTask, markdown);
            break;
          }

          case 'delete': {
            // Return mapping removal info — SyncEngine handles storage
            break;
          }
        }
      } catch (error) {
        console.error(`Failed to apply ${change.type} for task ${change.task.uid}:`, error);
      }
    }

    return createdMappings;
  }

  /**
   * Write IDs back to vault for tasks that had in-memory IDs generated during normalize.
   * Only called after sync succeeds, so IDs are only persisted when sync completes.
   */
  async writeBackIds(
    obsidianTasks: CommonTask[],
    tasksById: Map<string, ObsidianTask>,
    wrapper: ObsidianTasksWrapper,
    settings: { syncTag?: string },
  ): Promise<void> {
    for (const task of obsidianTasks) {
      const original = tasksById.get(task.uid);
      if (!original) continue;
      // Only write back if the original task had no ID
      if (wrapper.extractId(original)) continue;

      try {
        const markdown = this.mapper.toMarkdown(task, settings.syncTag);
        await wrapper.updateTaskInVault(original, markdown);
      } catch (error) {
        console.error(`[ObsidianAdapter] Failed to write back ID for task ${task.uid}:`, error);
      }
    }
  }
}
