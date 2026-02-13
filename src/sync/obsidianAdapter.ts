import { CommonTask, TaskStatus, TaskPriority } from './types';
import { ObsidianTask } from '../tasks/taskManager';

export class ObsidianAdapter {
  /**
   * Normalize obsidian-tasks Task[] into CommonTask[].
   * Only includes tasks that have an ID and pass the sync tag filter.
   */
  normalize(tasks: ObsidianTask[], syncTag?: string): CommonTask[] {
    const filtered = this.filterByTag(tasks, syncTag);
    const result: CommonTask[] = [];

    for (const task of filtered) {
      const taskId = this.extractId(task);
      if (!taskId) continue;

      result.push(this.toCommonTask(task, taskId));
    }

    return result;
  }

  /**
   * Convert a single obsidian-tasks Task to CommonTask.
   */
  toCommonTask(task: ObsidianTask, taskId: string): CommonTask {
    return {
      uid: taskId,
      title: this.cleanDescription(task.description),
      status: this.mapStatus(task),
      dueDate: this.formatDate(task.dueDate),
      startDate: this.formatDate(task.startDate),
      scheduledDate: this.formatDate(task.scheduledDate),
      completedDate: this.formatDate(task.doneDate),
      priority: this.mapPriority(task.priority),
      tags: this.cleanTags(task.tags || []),
      recurrenceRule: task.recurrence ? task.recurrence.toText() : '',
    };
  }

  /**
   * Generate obsidian-tasks markdown from a CommonTask.
   */
  toMarkdown(task: CommonTask, taskId: string, syncTag?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    // Dates in obsidian-tasks order: start, scheduled, due, completed
    if (task.startDate) {
      line += ` 🛫 ${task.startDate}`;
    }
    if (task.scheduledDate) {
      line += ` ⏳ ${task.scheduledDate}`;
    }
    if (task.dueDate) {
      line += ` 📅 ${task.dueDate}`;
    }
    if (task.completedDate) {
      line += ` ✅ ${task.completedDate}`;
    }

    // Task ID in obsidian-tasks emoji format
    line += ` 🆔 ${taskId}`;

    // Sync tag after ID
    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    return line;
  }

  /**
   * Get the content hash for change detection (matches old SyncEngine behavior).
   */
  getContentHash(task: ObsidianTask): string {
    return task.originalMarkdown.trim();
  }

  /**
   * Extract task ID from an obsidian-tasks Task.
   * obsidian-tasks populates task.id for both 🆔 and [id::] formats.
   */
  extractId(task: ObsidianTask): string | null {
    if (task.id && task.id.length > 0) return task.id;
    return null;
  }

  /**
   * Clean description by removing metadata that belongs in other fields.
   * obsidian-tasks already strips 🆔 from description. This handles
   * [id::xxx] for backwards compat and #tags.
   */
  private cleanDescription(description: string): string {
    let cleaned = description;

    // Remove [id::xxx] (backwards compat for tasks indexed before migration)
    cleaned = cleaned.replace(/\[id::[^\]]+\]/g, '');
    // Remove hashtags (but not # followed by numbers like #42)
    cleaned = cleaned.replace(/#[a-zA-Z][\w-]*/g, '');
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  /**
   * Remove # prefix from tags.
   */
  private cleanTags(tags: string[]): string[] {
    return tags.map(tag => tag.replace(/^#/, ''));
  }

  /**
   * Map obsidian-tasks status to TaskStatus.
   */
  private mapStatus(task: ObsidianTask): TaskStatus {
    if (task.isDone) return 'DONE';
    return 'TODO';
  }

  /**
   * Map obsidian-tasks priority (1-6) to TaskPriority.
   */
  private mapPriority(priority: string): TaskPriority {
    const map: Record<string, TaskPriority> = {
      '1': 'highest',
      '2': 'high',
      '3': 'medium',
      '4': 'medium',
      '5': 'low',
      '6': 'lowest',
    };
    return map[priority] || 'none';
  }

  /**
   * Format obsidian-tasks date (moment-like with .format()) to YYYY-MM-DD string.
   */
  private formatDate(date: any): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date;
    if (typeof date.format === 'function') return date.format('YYYY-MM-DD');
    return null;
  }

  /**
   * Filter tasks by sync tag.
   */
  private filterByTag(tasks: ObsidianTask[], syncTag?: string): ObsidianTask[] {
    if (!syncTag || syncTag.trim() === '') return tasks;

    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return tasks.filter(task => {
      if (!task.tags || task.tags.length === 0) return false;
      return task.tags.some((tag: string) =>
        tag.toLowerCase().replace(/^#/, '') === tagLower
      );
    });
  }
}
