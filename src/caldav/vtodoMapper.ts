/**
 * Represents a CalDAV calendar object (VTODO)
 */
export interface CalendarObject {
  data: string;
  etag?: string;
  url: string;
}

/**
 * Represents an Obsidian task extracted from obsidian-tasks API
 */
export interface ObsidianTask {
  description: string;
  status: string;
  dueDate: string | null;
  scheduledDate: string | null;
  startDate: string | null;
  completedDate: string | null;
  priority: string;
  recurrenceRule: string;
  tags: string[];
}

/**
 * Maps between Obsidian tasks and CalDAV VTODO objects
 */
export class VTODOMapper {
  /**
   * Convert Obsidian task to VTODO iCalendar string
   * @param task The Obsidian task
   * @param uid The CalDAV UID (use for updates, generate new for creates)
   * @returns VTODO iCalendar string
   */
  taskToVTODO(task: ObsidianTask, uid: string): string {
    const lines: string[] = [];

    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//Obsidian//Tasks CalDAV Sync//EN');
    lines.push('BEGIN:VTODO');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${this.formatDateTimeUTC(new Date())}`);
    lines.push(`LAST-MODIFIED:${this.formatDateTimeUTC(new Date())}`);
    lines.push(`SUMMARY:${this.escapeText(task.description)}`);

    // Status mapping
    lines.push(`STATUS:${this.mapStatusToVTODO(task.status)}`);

    // Due date
    if (task.dueDate) {
      lines.push(`DUE;VALUE=DATE:${this.formatDate(task.dueDate)}`);
    }

    // Start date (use scheduledDate or startDate)
    const startDate = task.scheduledDate || task.startDate;
    if (startDate) {
      lines.push(`DTSTART;VALUE=DATE:${this.formatDate(startDate)}`);
    }

    // Completed date
    if (task.completedDate) {
      lines.push(`COMPLETED:${this.formatDateTimeUTC(new Date(task.completedDate))}`);
      lines.push('PERCENT-COMPLETE:100');
    }

    // Priority mapping (Obsidian: lowest/low/none/medium/high/highest -> VTODO: 0-9)
    lines.push(`PRIORITY:${this.mapPriorityToVTODO(task.priority)}`);

    // Recurrence rule
    if (task.recurrenceRule) {
      lines.push(`RRULE:${task.recurrenceRule}`);
    }

    // Tags as categories
    if (task.tags.length > 0) {
      lines.push(`CATEGORIES:${task.tags.map(t => this.escapeText(t)).join(',')}`);
    }

    lines.push('END:VTODO');
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  /**
   * Convert VTODO iCalendar object to Obsidian task
   * @param vtodo The CalDAV calendar object containing VTODO
   * @returns Obsidian task object
   */
  vtodoToTask(vtodo: CalendarObject): ObsidianTask {
    const data = vtodo.data;

    return {
      description: this.extractProperty(data, 'SUMMARY') || 'Untitled Task',
      status: this.mapStatusFromVTODO(this.extractProperty(data, 'STATUS') || 'NEEDS-ACTION'),
      dueDate: this.extractDateProperty(data, 'DUE'),
      scheduledDate: this.extractDateProperty(data, 'DTSTART'),
      startDate: null,
      completedDate: this.extractDateTimeProperty(data, 'COMPLETED'),
      priority: this.mapPriorityFromVTODO(this.extractProperty(data, 'PRIORITY') || '0'),
      recurrenceRule: this.extractProperty(data, 'RRULE') || '',
      tags: this.extractCategories(data)
    };
  }

  /**
   * Extract UID from VTODO data
   */
  extractUID(data: string): string {
    const match = data.match(/^UID:(.+)$/m);
    return match ? match[1].trim() : '';
  }

  /**
   * Extract LAST-MODIFIED timestamp from VTODO data
   * Returns ISO 8601 string or null if not present
   */
  extractLastModified(data: string): string | null {
    const match = data.match(/^LAST-MODIFIED:(.+)$/m);
    if (!match) return null;

    const timestamp = match[1].trim();
    // Parse iCalendar datetime format (YYYYMMDDTHHMMSSZ)
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const hour = timestamp.substring(9, 11);
    const minute = timestamp.substring(11, 13);
    const second = timestamp.substring(13, 15);

    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  /**
   * Map Obsidian task status to VTODO status
   */
  private mapStatusToVTODO(status: string): string {
    switch (status) {
      case 'TODO':
        return 'NEEDS-ACTION';
      case 'IN_PROGRESS':
        return 'IN-PROCESS';
      case 'DONE':
        return 'COMPLETED';
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return 'NEEDS-ACTION';
    }
  }

  /**
   * Map VTODO status to Obsidian task status
   */
  private mapStatusFromVTODO(status: string): string {
    switch (status) {
      case 'NEEDS-ACTION':
        return 'TODO';
      case 'IN-PROCESS':
        return 'IN_PROGRESS';
      case 'COMPLETED':
        return 'DONE';
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return 'TODO';
    }
  }

  /**
   * Map Obsidian priority to VTODO priority (0-9, where 1 is highest)
   */
  private mapPriorityToVTODO(priority: string): number {
    switch (priority) {
      case 'highest':
        return 1;
      case 'high':
        return 3;
      case 'medium':
        return 5;
      case 'low':
        return 7;
      case 'lowest':
        return 9;
      default:
        return 0; // undefined
    }
  }

  /**
   * Map VTODO priority to Obsidian priority
   */
  private mapPriorityFromVTODO(priorityStr: string): string {
    const priority = parseInt(priorityStr);

    if (priority === 0) return 'none';
    if (priority <= 2) return 'highest';
    if (priority <= 4) return 'high';
    if (priority <= 6) return 'medium';
    if (priority <= 8) return 'low';
    return 'lowest';
  }

  /**
   * Extract a simple property value from iCalendar data
   */
  private extractProperty(data: string, property: string): string | null {
    const regex = new RegExp(`^${property}[;:](.+)$`, 'm');
    const match = data.match(regex);

    if (match) {
      // Extract value after last colon (handles parameters like DUE;VALUE=DATE:20250105)
      const fullValue = match[1];
      const colonIndex = fullValue.lastIndexOf(':');
      const value = colonIndex >= 0 ? fullValue.substring(colonIndex + 1).trim() : fullValue.trim();

      // Unescape iCalendar special characters
      return this.unescapeText(value);
    }

    return null;
  }

  /**
   * Extract date property (VALUE=DATE format)
   */
  private extractDateProperty(data: string, property: string): string | null {
    const value = this.extractProperty(data, property);
    if (!value) return null;

    // Parse YYYYMMDD format
    if (value.length === 8) {
      const year = value.substring(0, 4);
      const month = value.substring(4, 6);
      const day = value.substring(6, 8);
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  /**
   * Extract datetime property
   */
  private extractDateTimeProperty(data: string, property: string): string | null {
    const value = this.extractProperty(data, property);
    if (!value) return null;

    // Parse YYYYMMDDTHHMMSSZ format
    if (value.length >= 15 && value.includes('T')) {
      const year = value.substring(0, 4);
      const month = value.substring(4, 6);
      const day = value.substring(6, 8);
      const hour = value.substring(9, 11);
      const minute = value.substring(11, 13);
      const second = value.substring(13, 15);
      return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }

    return null;
  }

  /**
   * Extract categories (tags)
   * Special handling: split by unescaped commas, then unescape each part
   */
  private extractCategories(data: string): string[] {
    const regex = new RegExp(`^CATEGORIES[;:](.+)$`, 'm');
    const match = data.match(regex);

    if (!match) return [];

    // Extract value after last colon (handles parameters)
    const fullValue = match[1];
    const colonIndex = fullValue.lastIndexOf(':');
    const value = colonIndex >= 0 ? fullValue.substring(colonIndex + 1).trim() : fullValue.trim();

    // Split by unescaped commas: split on commas that aren't preceded by backslash
    // Use negative lookbehind: split on , that is NOT preceded by \
    const parts = value.split(/(?<!\\),/);

    // Unescape each part
    return parts.map(part => this.unescapeText(part.trim()));
  }

  /**
   * Format date as YYYYMMDD
   * For date-only strings (YYYY-MM-DD), parses without timezone conversion
   */
  private formatDate(dateInput: Date | string): string {
    // If it's already a YYYY-MM-DD string, parse it directly without timezone issues
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [year, month, day] = dateInput.split('-');
      return `${year}${month}${day}`;
    }

    // Otherwise treat as Date object (use local time)
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Format datetime as YYYYMMDDTHHMMSSZ (UTC)
   */
  private formatDateTimeUTC(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
  }

  /**
   * Escape special characters in iCalendar text
   */
  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  /**
   * Unescape special characters from iCalendar text
   */
  private unescapeText(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }
}
