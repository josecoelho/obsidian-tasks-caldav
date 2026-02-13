import { RRule } from 'rrule';
import { CommonTask, TaskStatus, TaskPriority } from './types';
import { ObsidianTask } from '../tasks/taskManager';

export class ObsidianAdapter {
  /**
   * Normalize obsidian-tasks Task[] into CommonTask[].
   * Only includes tasks that have an ID and pass the sync tag filter.
   * @param notesMap Optional map of taskId -> notes text (extracted from vault files)
   */
  normalize(tasks: ObsidianTask[], syncTag?: string, notesMap?: Map<string, string>): CommonTask[] {
    const filtered = this.filterByTag(tasks, syncTag);
    const result: CommonTask[] = [];

    for (const task of filtered) {
      const taskId = this.extractId(task);
      if (!taskId) continue;

      const notes = notesMap?.get(taskId) ?? '';
      result.push(this.toCommonTask(task, taskId, notes));
    }

    return result;
  }

  /**
   * Convert a single obsidian-tasks Task to CommonTask.
   * @param notes Optional notes text (defaults to '')
   */
  toCommonTask(task: ObsidianTask, taskId: string, notes: string = ''): CommonTask {
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
      notes,
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

    // Notes as indented bullet lines
    if (task.notes) {
      const noteLines = task.notes.split('\n').map(l => `    - ${l}`);
      line += '\n' + noteLines.join('\n');
    }

    return line;
  }

  /**
   * Extract indented bullet notes from file content below a task line.
   * Notes are lines matching /^(?:\s{2,}|\t)- (.*)$/ immediately after the task.
   * Returns joined lines with \n, or '' if no notes found.
   */
  extractNotesFromFile(fileContent: string, taskLineIndex: number): string {
    const lines = fileContent.split('\n');
    const noteLines: string[] = [];

    for (let i = taskLineIndex + 1; i < lines.length; i++) {
      const match = lines[i].match(/^(?:\s{2,}|\t)- (.*)$/);
      if (!match) break;
      noteLines.push(match[1]);
    }

    return noteLines.join('\n');
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
   * Extract RRULE string from obsidian-tasks Recurrence object.
   * Uses rrule.js to parse the human-readable text from toText(),
   * avoiding access to obsidian-tasks private properties.
   */
  private extractRecurrenceRule(recurrence: any): string {
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
