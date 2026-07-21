/**
 * Represents a CalDAV calendar object (VTODO)
 */
export interface CalendarObject {
  data: string;
  etag?: string;
  url: string;
}

import ICAL from 'ical.js';
import { CommonTask } from '../sync/types';
import { extractInlineTags, stripInlineTags } from '../utils/inlineTags';

/** Fields returned by vtodoToTask — everything except uid, which is extracted separately */
type VTODOTaskFields = Omit<CommonTask, 'uid'>;

/**
 * The RRULE value serializer from ical.js' iCalendar design set. We drive it
 * directly (instead of the `ICAL.Recur` object) so the rule survives as a
 * verbatim string: `Recur.toString()` reorders parts, but `fromICAL`/`toICAL`
 * preserve the author's original order. `design.*.value` is typed `any`, so we
 * pin the two functions we use to a concrete shape here.
 */
interface RecurValueDesign {
  fromICAL(value: string): object;
  toICAL(value: object): string;
}
const RECUR_DESIGN = (ICAL.design.icalendar.value as Record<string, RecurValueDesign>).recur;

/**
 * Maps between CommonTask fields and CalDAV VTODO iCalendar format.
 *
 * Parsing and serialization are delegated to ical.js (the Thunderbird engine):
 * it owns line folding/unfolding, text escaping, VALUE=DATE handling and
 * component scoping, so task fields are only ever read from the VTODO
 * component — never from a sibling VTIMEZONE or a nested VALARM.
 */
export class VTODOMapper {
  /**
   * Convert a CommonTask to VTODO iCalendar string.
   * @param task The common task
   * @param uid The CalDAV UID (use for updates, generate new for creates)
   * @returns VTODO iCalendar string
   */
  taskToVTODO(task: Omit<CommonTask, 'uid'>, uid: string): string {
    const calendar = new ICAL.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('version', '2.0');
    calendar.updatePropertyWithValue('prodid', '-//Obsidian//Tasks CalDAV Sync//EN');

    const vtodo = new ICAL.Component('vtodo');
    calendar.addSubcomponent(vtodo);

    const now = ICAL.Time.fromJSDate(new Date(), true);
    vtodo.updatePropertyWithValue('uid', uid);
    vtodo.updatePropertyWithValue('dtstamp', now);
    vtodo.updatePropertyWithValue('last-modified', now);
    vtodo.updatePropertyWithValue('summary', task.title);

    const description = this.buildDescription(task.body, task.obsidianUrl);
    if (description) {
      vtodo.updatePropertyWithValue('description', description);
    }

    // Obsidian vault link. When set, this plugin owns the URL property —
    // any value previously set by another CalDAV client will be overwritten.
    if (task.obsidianUrl) {
      vtodo.updatePropertyWithValue('url', task.obsidianUrl);
    }

    vtodo.updatePropertyWithValue('status', this.mapStatusToVTODO(task.status));

    if (task.dueDate) {
      vtodo.updatePropertyWithValue('due', this.toDateValue(task.dueDate));
    }

    // DTSTART carries the scheduled date (⏳) — the field CalDAV clients plan
    // by. The start date (🛫) has no CalDAV counterpart and never syncs.
    if (task.scheduledDate) {
      vtodo.updatePropertyWithValue('dtstart', this.toDateValue(task.scheduledDate));
    }

    if (task.completedDate) {
      // Anchor and format the completion instant ourselves (issue #43) — ical.js
      // only serializes the already-resolved UTC instant, it does no timezone math.
      vtodo.updatePropertyWithValue(
        'completed',
        ICAL.Time.fromJSDate(this.toCompletedInstant(task.completedDate), true),
      );
      vtodo.updatePropertyWithValue('percent-complete', 100);
    }

    vtodo.updatePropertyWithValue('priority', this.mapPriorityToVTODO(task.priority));

    if (task.recurrenceRule) {
      vtodo.addProperty(this.buildRecurrenceProperty(task.recurrenceRule, vtodo));
    }

    if (task.tags.length > 0) {
      const categories = new ICAL.Property('categories', vtodo);
      categories.setValues(task.tags);
      vtodo.addProperty(categories);
    }

    return calendar.toString();
  }

  /**
   * Convert VTODO iCalendar object to CommonTask fields (minus uid).
   * @param vtodo The CalDAV calendar object containing VTODO
   */
  vtodoToTask(vtodo: CalendarObject): VTODOTaskFields {
    const component = this.parseVTODO(vtodo.data);

    // Inline #tags in SUMMARY (written by older plugin versions or other
    // clients) move into tags[], so corrupted tasks heal instead of gaining
    // a duplicate tag on every sync — issue #114.
    const summary = this.stringValue(component, 'summary');

    return {
      title: stripInlineTags(summary) || 'Untitled Task',
      status: this.mapStatusFromVTODO(this.stringValue(component, 'status') || 'NEEDS-ACTION') as CommonTask['status'],
      dueDate: this.extractDate(component, 'due'),
      scheduledDate: this.extractDate(component, 'dtstart'),
      startDate: null,
      completedDate: this.extractDateTime(component, 'completed'),
      priority: this.mapPriorityFromVTODO(this.stringValue(component, 'priority') || '0') as CommonTask['priority'],
      recurrenceRule: this.extractRecurrence(component),
      tags: this.dedupeTags([...this.extractCategories(component), ...extractInlineTags(summary)]),
      body: this.stripObsidianLinks(this.stringValue(component, 'description')),
    };
  }

  /**
   * Extract UID from VTODO data
   */
  extractUID(data: string): string {
    return this.stringValue(this.parseVTODO(data), 'uid');
  }

  /**
   * Extract LAST-MODIFIED timestamp from VTODO data
   * Returns ISO 8601 string or null if not present
   */
  extractLastModified(data: string): string | null {
    return this.extractDateTime(this.parseVTODO(data), 'last-modified');
  }

  /**
   * Parse iCalendar data and return its VTODO component. Accepts both a full
   * VCALENDAR wrapper and a bare VTODO. Falls back to an empty component so
   * callers still read defaults from VTODO-less input.
   */
  private parseVTODO(data: string): ICAL.Component {
    // ICAL.parse returns jCal typed as `any`; a component's jCal is an array.
    const root = new ICAL.Component(ICAL.parse(data) as unknown[]);
    if (root.name === 'vtodo') return root;
    return root.getFirstSubcomponent('vtodo') ?? new ICAL.Component('vtodo');
  }

  /** First property value as a string, '' when the property is absent. */
  private stringValue(component: ICAL.Component, name: string): string {
    const value = component.getFirstPropertyValue(name);
    return value === null ? '' : String(value);
  }

  /** A date-only ICAL.Time from a 'YYYY-MM-DD' string, emitted as VALUE=DATE. */
  private toDateValue(date: string): ICAL.Time {
    const [year, month, day] = date.split('-').map(Number);
    return ICAL.Time.fromData({ year, month, day, isDate: true });
  }

  /**
   * Read a date property as 'YYYY-MM-DD', taking only the calendar-day portion
   * of VALUE=DATE, TZID and datetime forms alike.
   */
  private extractDate(component: ICAL.Component, name: string): string | null {
    const time = component.getFirstPropertyValue(name);
    if (!(time instanceof ICAL.Time)) return null;
    return `${this.pad(time.year, 4)}-${this.pad(time.month, 2)}-${this.pad(time.day, 2)}`;
  }

  /** Read a datetime property as 'YYYY-MM-DDTHH:MM:SSZ' from its wall-clock components. */
  private extractDateTime(component: ICAL.Component, name: string): string | null {
    const time = component.getFirstPropertyValue(name);
    if (!(time instanceof ICAL.Time) || time.isDate) return null;
    return (
      `${this.pad(time.year, 4)}-${this.pad(time.month, 2)}-${this.pad(time.day, 2)}` +
      `T${this.pad(time.hour, 2)}:${this.pad(time.minute, 2)}:${this.pad(time.second, 2)}Z`
    );
  }

  /**
   * The RRULE is stored and round-tripped as a verbatim string (issue #8): the
   * plugin translates natural-language recurrence elsewhere and never mutates
   * the rule, so read it straight from the value serializer rather than an
   * `ICAL.Recur` object (whose `toString()` reorders the parts).
   */
  private extractRecurrence(component: ICAL.Component): string {
    const property = component.getFirstProperty('rrule');
    if (!property) return '';
    return RECUR_DESIGN.toICAL(property.jCal[3] as object);
  }

  private buildRecurrenceProperty(rule: string, parent: ICAL.Component): ICAL.Property {
    return new ICAL.Property(['rrule', {}, 'recur', RECUR_DESIGN.fromICAL(rule)], parent);
  }

  /**
   * Extract categories (tags). ical.js unescapes and splits multi-value
   * CATEGORIES; multiple CATEGORIES lines are concatenated, as servers emit both.
   */
  private extractCategories(component: ICAL.Component): string[] {
    return component.getAllProperties('categories').flatMap((property) => property.getValues() as string[]);
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

  /** Case-insensitive, order-preserving dedupe — Obsidian treats tags case-insensitively. */
  private dedupeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
  }

  /**
   * Resolve a CommonTask completedDate to the instant written as COMPLETED.
   * Obsidian completion is date-only (✅ YYYY-MM-DD) with no time; anchor it
   * at local noon so the UTC timestamp maps back to the same local calendar
   * day in any timezone (round-trip safe). A full datetime is already an
   * instant and is preserved as-is. See issue #43.
   */
  private toCompletedInstant(completedDate: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
      const [year, month, day] = completedDate.split('-').map(Number);
      return new Date(year, month - 1, day, 12, 0, 0);
    }
    return new Date(completedDate);
  }

  private buildDescription(body: string, obsidianUrl?: string): string {
    if (!obsidianUrl && !body) return '';
    if (!obsidianUrl) return body;
    if (!body) return obsidianUrl;
    return `${obsidianUrl}\n\n${body}`;
  }

  private stripObsidianLinks(body: string): string {
    const lines = body.split('\n');
    const filtered = lines.filter(line => !line.match(/^obsidian:\/\/open\?vault=/));
    return filtered.join('\n').replace(/^\n+/, '');
  }
}
