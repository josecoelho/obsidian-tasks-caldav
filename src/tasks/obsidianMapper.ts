import { RRule } from 'rrule';
import { CommonTask, TaskStatus, TaskPriority } from '../sync/types';
import { ObsidianTask } from './obsidianTasksWrapper';

/**
 * Maps between obsidian-tasks Task objects and CommonTask.
 * Parallel to VTODOMapper on the CalDAV side.
 *
 * We cannot instantiate obsidian-tasks Task objects — they come from
 * the plugin's in-memory cache (read-only). For writing, we generate
 * markdown strings directly.
 */
export class ObsidianMapper {
  /**
   * Parse: ObsidianTask → CommonTask.
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
   * Serialize: CommonTask → obsidian-tasks markdown string.
   * Uses task.uid for the id field. `format` defaults to 'emoji' so
   * existing callers are unaffected.
   */
  toMarkdown(task: CommonTask, syncTag?: string, format: 'emoji' | 'dataview' = 'emoji'): string {
    return format === 'dataview'
      ? this.toDataviewMarkdown(task, syncTag)
      : this.toEmojiMarkdown(task, syncTag);
  }

  private toEmojiMarkdown(task: CommonTask, syncTag?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = syncTag?.replace(/^#/, '').trim();
    const nonSyncTags = task.tags.filter(t => t !== syncTagName);
    for (const tag of nonSyncTags) {
      line += ` #${tag}`;
    }

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

    if (task.recurrenceRule) {
      const text = this.rruleToText(task.recurrenceRule);
      if (text) {
        line += ` 🔁 ${text}`;
      }
    }

    line += ` 🆔 ${task.uid}`;

    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    return this.appendBody(line, task.body);
  }

  private toDataviewMarkdown(task: CommonTask, syncTag?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = syncTag?.replace(/^#/, '').trim();
    const nonSyncTags = task.tags.filter(t => t !== syncTagName);
    for (const tag of nonSyncTags) {
      line += ` #${tag}`;
    }

    // Dates in obsidian-tasks order: start, scheduled, due, completed
    if (task.startDate) {
      line += ` [start:: ${task.startDate}]`;
    }
    if (task.scheduledDate) {
      line += ` [scheduled:: ${task.scheduledDate}]`;
    }
    if (task.dueDate) {
      line += ` [due:: ${task.dueDate}]`;
    }
    if (task.completedDate) {
      line += ` [completion:: ${task.completedDate}]`;
    }

    if (task.recurrenceRule) {
      const text = this.rruleToText(task.recurrenceRule);
      if (text) {
        line += ` [repeat:: ${text}]`;
      }
    }

    line += ` [id:: ${task.uid}]`;

    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    return this.appendBody(line, task.body);
  }

  /** Append the task body as indented bullet lines, if any. */
  private appendBody(line: string, body: string): string {
    if (!body) return line;
    const bodyLines = body.split('\n').map(l => `    - ${l}`);
    return line + '\n' + bodyLines.join('\n');
  }

  /**
   * Clean description by removing metadata that belongs in other fields.
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

  private cleanTags(tags: string[]): string[] {
    return tags.map(tag => tag.replace(/^#/, ''));
  }

  private mapStatus(task: ObsidianTask): TaskStatus {
    if (task.isDone) return 'DONE';
    return 'TODO';
  }

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
   * Format obsidian-tasks date (moment-like with .format()) to YYYY-MM-DD string.
   */
  private formatDate(date: string | { format(fmt: string): string } | null | undefined): string | null {
    if (!date) return null;
    if (typeof date === 'string') return date;
    if (typeof date.format === 'function') return date.format('YYYY-MM-DD');
    return null;
  }

  /**
   * Convert an RRULE string to obsidian-tasks human-readable format.
   */
  private rruleToText(rruleStr: string): string {
    try {
      const rule = RRule.fromString(`RRULE:${rruleStr}`);
      return rule.toText();
    } catch {
      return '';
    }
  }
}
