import { RRule } from 'rrule';
import { CommonTask, TaskStatus, TaskPriority } from './types';
import { ObsidianTask, TaskWithBody } from '../tasks/obsidianTasksWrapper';

// Re-export for backwards compatibility
export type { TaskWithBody } from '../tasks/obsidianTasksWrapper';

export interface NormalizeResult {
  tasks: CommonTask[];
  tasksById: Map<string, ObsidianTask>;
}

export class ObsidianAdapter {
  /**
   * Normalize pre-filtered TaskWithBody[] into CommonTask[].
   * Each input must already have a taskId assigned.
   * Pure field mapping — no filtering or ID generation.
   */
  normalize(inputs: Array<TaskWithBody & { taskId: string }>): NormalizeResult {
    const tasks: CommonTask[] = [];
    const tasksById = new Map<string, ObsidianTask>();

    for (const { task, body, taskId } of inputs) {
      tasksById.set(taskId, task);
      tasks.push(this.toCommonTask(task, taskId, body));
    }

    return { tasks, tasksById };
  }

  /**
   * Convert a single obsidian-tasks Task to CommonTask.
   * @param body Optional body text (defaults to '')
   */
  toCommonTask(task: ObsidianTask, taskId: string, body: string = ''): CommonTask {
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
      recurrenceRule: task.recurrence ? this.extractRecurrenceRule(task.recurrence) : '',
      body,
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

    // Recurrence rule in obsidian-tasks format
    if (task.recurrenceRule) {
      const text = this.rruleToText(task.recurrenceRule);
      if (text) {
        line += ` 🔁 ${text}`;
      }
    }

    // Task ID in obsidian-tasks emoji format
    line += ` 🆔 ${taskId}`;

    // Sync tag after ID
    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    // Body as indented bullet lines
    if (task.body) {
      const bodyLines = task.body.split('\n').map(l => `    - ${l}`);
      line += '\n' + bodyLines.join('\n');
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
   * Reverse-map a CommonTask to obsidian-tasks constructor fields.
   * Useful when building or updating an ObsidianTask from CalDAV data.
   */
  toTaskFields(common: CommonTask): {
    description: string;
    id: string;
    isDone: boolean;
    priority: string;
    tags: string[];
    dueDate: string | null;
    startDate: string | null;
    scheduledDate: string | null;
    doneDate: string | null;
  } {
    return {
      description: common.title,
      id: common.uid,
      isDone: common.status === 'DONE',
      priority: this.reversePriority(common.priority),
      tags: common.tags.map(t => `#${t}`),
      dueDate: common.dueDate,
      startDate: common.startDate,
      scheduledDate: common.scheduledDate,
      doneDate: common.completedDate,
    };
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
   * Reverse-map TaskPriority to obsidian-tasks priority string (1-6).
   */
  private reversePriority(priority: TaskPriority): string {
    const map: Record<TaskPriority, string> = {
      'highest': '1',
      'high': '2',
      'medium': '3',
      'low': '5',
      'lowest': '6',
      'none': '0',
    };
    return map[priority] || '0';
  }

  /**
   * Extract RRULE string from obsidian-tasks Recurrence object.
   * Uses rrule.js to parse the human-readable text from toText(),
   * avoiding access to obsidian-tasks private properties.
   */
  private extractRecurrenceRule(recurrence: { toText(): string }): string {
    try {
      const text = recurrence.toText();
      if (!text) return '';
      // Strip "when done" suffix — obsidian-tasks specific, not part of RRULE
      const cleanText = text.replace(/\s+when\s+done\s*$/i, '');
      const rule = RRule.fromText(cleanText);
      return rule.toString().replace(/^RRULE:/, '');
    } catch {
      return '';
    }
  }

  /**
   * Convert an RRULE string (e.g. "FREQ=DAILY") to obsidian-tasks
   * human-readable format (e.g. "every day").
   */
  private rruleToText(rruleStr: string): string {
    try {
      const rule = RRule.fromString(`RRULE:${rruleStr}`);
      return rule.toText();
    } catch {
      return '';
    }
  }

  /**
   * Format obsidian-tasks date (moment-like with .format()) to YYYY-MM-DD string.
   */
  private formatDate(date: string | { format(fmt: string): string } | null | undefined): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date;
    if (typeof date.format === 'function') return date.format('YYYY-MM-DD');
    return null;
  }

}
