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
  /**
   * Note: the obsidian-tasks global filter is intentionally not re-added here.
   * obsidian-tasks strips it from `task.tags` (and `cleanDescription` drops
   * any stray text form). `toMarkdown` re-emits it on writeback so the
   * rewritten line stays recognised under the filter — issue #93.
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
  toMarkdown(
    task: CommonTask,
    syncTag?: string,
    format: 'emoji' | 'dataview' = 'emoji',
    globalFilter?: string,
  ): string {
    return format === 'dataview'
      ? this.toDataviewMarkdown(task, syncTag, globalFilter)
      : this.toEmojiMarkdown(task, syncTag, globalFilter);
  }

  private toEmojiMarkdown(task: CommonTask, syncTag?: string, globalFilter?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = this.bareTagName(syncTag);
    const globalFilterName = this.bareTagName(globalFilter);
    for (const tag of this.nonReservedTags(task.tags, syncTagName, globalFilterName)) {
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

    line += this.trailingTagSuffix(syncTagName, globalFilterName);

    return this.appendBody(line, task.body);
  }

  private toDataviewMarkdown(task: CommonTask, syncTag?: string, globalFilter?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = this.bareTagName(syncTag);
    const globalFilterName = this.bareTagName(globalFilter);
    for (const tag of this.nonReservedTags(task.tags, syncTagName, globalFilterName)) {
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

    line += this.trailingTagSuffix(syncTagName, globalFilterName);

    return this.appendBody(line, task.body);
  }

  private bareTagName(tag: string | undefined): string {
    return tag?.replace(/^#/, '').trim() ?? '';
  }

  /**
   * Drop tags that we re-emit explicitly (sync tag + global filter) so the
   * suffix renders them exactly once. Comparisons are case-insensitive — both
   * obsidian-tasks and Obsidian itself treat tags case-insensitively.
   */
  private nonReservedTags(tags: string[], syncTagName: string, globalFilterName: string): string[] {
    const reserved = new Set(
      [syncTagName, globalFilterName].filter(Boolean).map(t => t.toLowerCase()),
    );
    return tags.filter(t => !reserved.has(t.toLowerCase()));
  }

  /**
   * Trailing global filter + sync tag suffix. Global filter goes first so
   * obsidian-tasks recognises the line; sync tag last (existing convention).
   * Skips the global filter if it equals the sync tag (case-insensitive) to
   * avoid duplication.
   */
  private trailingTagSuffix(syncTagName: string, globalFilterName: string): string {
    let out = '';
    if (globalFilterName && globalFilterName.toLowerCase() !== syncTagName.toLowerCase()) {
      out += ` #${globalFilterName}`;
    }
    if (syncTagName) {
      out += ` #${syncTagName}`;
    }
    return out;
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
