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
   * Convert a CommonTask to a VTODO iCalendar string.
   *
   * @param task The common task
   * @param uid The CalDAV UID (reused on update, freshly generated on create)
   * @param existingData The untouched server VTODO body on the update/complete
   *   path. When present the plugin mutates only its own properties on the
   *   parsed component tree and lets every foreign property and sub-component
   *   (VALARM, RELATED-TO, X-*, VTIMEZONE, …) pass through verbatim. When
   *   absent a fresh VTODO is built from scratch.
   * @returns VTODO iCalendar string
   */
  taskToVTODO(task: Omit<CommonTask, 'uid'>, uid: string, existingData?: string): string {
    return existingData
      ? this.mergeIntoExisting(task, existingData)
      : this.buildFreshVTODO(task, uid);
  }

  private buildFreshVTODO(task: Omit<CommonTask, 'uid'>, uid: string): string {
    const calendar = new ICAL.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('version', '2.0');
    calendar.updatePropertyWithValue('prodid', '-//Obsidian//Tasks CalDAV Sync//EN');

    const vtodo = new ICAL.Component('vtodo');
    calendar.addSubcomponent(vtodo);
    vtodo.updatePropertyWithValue('uid', uid);
    this.applyOwnedProperties(vtodo, task, false);

    return calendar.toString();
  }

  /**
   * Round-trip write: parse the server body, mutate only the plugin-owned
   * properties on its VTODO component, and serialize. Because every edit is
   * scoped to the VTODO component, a sibling VTIMEZONE rule's DTSTART can never
   * be mistaken for the task's DTSTART, and foreign lines/sub-components are
   * preserved and folded by ical.js rather than hand-spliced.
   */
  private mergeIntoExisting(task: Omit<CommonTask, 'uid'>, existingData: string): string {
    // ICAL.parse returns jCal typed as `any`; a component's jCal is an array.
    const root = new ICAL.Component(ICAL.parse(existingData) as unknown[]);
    const vtodo = root.name === 'vtodo' ? root : (root.getFirstSubcomponent('vtodo') ?? root);
    this.applyOwnedProperties(vtodo, task, true);
    return root.toString();
  }

  /**
   * Set every plugin-owned property on the VTODO component. On the update path
   * (`isUpdate`) the server's value is preserved for the few properties the
   * plugin can't fully own: STATUS while the task is still open, PERCENT-COMPLETE
   * while it isn't completing, and the time-of-day/TZID of DUE and DTSTART.
   */
  private applyOwnedProperties(vtodo: ICAL.Component, task: Omit<CommonTask, 'uid'>, isUpdate: boolean): void {
    const now = ICAL.Time.fromJSDate(new Date(), true);
    vtodo.updatePropertyWithValue('dtstamp', now);
    vtodo.updatePropertyWithValue('last-modified', now);
    vtodo.updatePropertyWithValue('summary', task.title);

    this.setOrRemove(vtodo, 'description', this.buildDescription(task.body, task.obsidianUrl));

    // Obsidian vault link. When set, this plugin owns the URL property — any
    // value previously set by another CalDAV client is overwritten. When unset
    // the plugin isn't managing URL, so a foreign URL is left untouched.
    if (task.obsidianUrl) {
      vtodo.updatePropertyWithValue('url', task.obsidianUrl);
    }

    this.applyStatus(vtodo, task.status, isUpdate);
    // DUE and DTSTART carry the plugin's date-only values; DTSTART is the
    // scheduled date (⏳) that CalDAV clients plan by. The start date (🛫) has
    // no CalDAV counterpart and never syncs.
    this.applyDate(vtodo, 'due', task.dueDate);
    this.applyDate(vtodo, 'dtstart', task.scheduledDate);
    this.applyCompletion(vtodo, task.completedDate);
    vtodo.updatePropertyWithValue('priority', this.mapPriorityToVTODO(task.priority));
    this.applyRecurrence(vtodo, task.recurrenceRule);
    this.applyCategories(vtodo, task.tags);
  }

  private setOrRemove(vtodo: ICAL.Component, name: string, value: string): void {
    if (value) {
      vtodo.updatePropertyWithValue(name, value);
    } else {
      vtodo.removeAllProperties(name);
    }
  }

  /**
   * An open task (TODO) never overwrites the server's STATUS on update:
   * obsidian-tasks has no in-progress checkbox, so IN-PROCESS is kept as-is
   * and NEEDS-ACTION passes through. Only terminal states are written
   * (DONE→COMPLETED, CANCELLED→CANCELLED). A fresh VTODO always states TODO as
   * NEEDS-ACTION since there is nothing to preserve.
   */
  private applyStatus(vtodo: ICAL.Component, status: CommonTask['status'], isUpdate: boolean): void {
    if (isUpdate && status === 'TODO') return;
    vtodo.updatePropertyWithValue('status', this.mapStatusToVTODO(status));
  }

  /**
   * Write a date-only value, preserving the time-of-day and TZID of an existing
   * DATE-TIME property so a server's `DUE;TZID=…:…T…` keeps its clock time and
   * zone and is only moved to the new calendar day. The existing property is
   * read off the VTODO component, never a document-wide search, so a sibling
   * VTIMEZONE rule's DTSTART cannot be picked up. A date-only or absent existing
   * value is written as VALUE=DATE; removing the date removes the property.
   */
  private applyDate(vtodo: ICAL.Component, name: string, date: string | null): void {
    if (!date) {
      vtodo.removeAllProperties(name);
      return;
    }

    const existing = vtodo.getFirstProperty(name);
    const existingTime = existing?.getFirstValue();
    if (existing && existingTime instanceof ICAL.Time && !existingTime.isDate) {
      const [year, month, day] = date.split('-').map(Number);
      existingTime.year = year;
      existingTime.month = month;
      existingTime.day = day;
      existing.setValue(existingTime);
      return;
    }

    vtodo.removeAllProperties(name);
    vtodo.updatePropertyWithValue(name, this.toDateValue(date));
  }

  /**
   * On completion, anchor and format the completion instant ourselves (issue
   * #43) — ical.js only serializes the already-resolved UTC instant — and force
   * PERCENT-COMPLETE to 100. While the task is open, COMPLETED is cleared but
   * PERCENT-COMPLETE is left untouched so a server's in-progress value survives.
   */
  private applyCompletion(vtodo: ICAL.Component, completedDate: string | null): void {
    if (!completedDate) {
      vtodo.removeAllProperties('completed');
      return;
    }
    vtodo.updatePropertyWithValue(
      'completed',
      ICAL.Time.fromJSDate(this.toCompletedInstant(completedDate), true),
    );
    vtodo.removeAllProperties('percent-complete');
    vtodo.updatePropertyWithValue('percent-complete', 100);
  }

  private applyRecurrence(vtodo: ICAL.Component, rule: string): void {
    vtodo.removeAllProperties('rrule');
    if (rule) {
      vtodo.addProperty(this.buildRecurrenceProperty(rule, vtodo));
    }
  }

  private applyCategories(vtodo: ICAL.Component, tags: string[]): void {
    vtodo.removeAllProperties('categories');
    if (tags.length === 0) return;
    const categories = new ICAL.Property('categories', vtodo);
    categories.setValues(tags);
    vtodo.addProperty(categories);
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
      case 'DONE':
        return 'COMPLETED';
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return 'NEEDS-ACTION';
    }
  }

  /**
   * Map VTODO status to Obsidian task status. IN-PROCESS maps to TODO because
   * obsidian-tasks has no in-progress checkbox: mapping it to a distinct state
   * created a permanent phantom diff that rewrote NEEDS-ACTION over the server's
   * IN-PROCESS on every sync. The write path preserves IN-PROCESS instead.
   */
  private mapStatusFromVTODO(status: string): string {
    switch (status) {
      case 'NEEDS-ACTION':
        return 'TODO';
      case 'IN-PROCESS':
        return 'TODO';
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
