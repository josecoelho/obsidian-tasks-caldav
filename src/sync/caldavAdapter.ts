import { CommonTask, SyncChange } from './types';
import { VTODOMapper, CalendarObject } from '../caldav/vtodoMapper';
import { CalDAVClient } from '../caldav/calDAVClientDirect';
import { IdMapping } from '../types';
import {
  injectTagIdentifier,
  normalizeTagIdentifier,
  stripTagIdentifier,
} from '../utils/tagIdentifier';

export class CalDAVAdapter {
  private mapper: VTODOMapper;
  private client: CalDAVClient;
  private caldavCategory: string;

  constructor(client: CalDAVClient, caldavCategory: string = '', mapper?: VTODOMapper) {
    this.client = client;
    this.caldavCategory = caldavCategory;
    this.mapper = mapper ?? new VTODOMapper();
  }

  /**
   * Full pipeline: connect → fetch → normalize → filter → strip identifier.
   * Returns CommonTasks with the configured caldavCategory removed from
   * `tags`, so the diff layer sees only user-content tags.
   */
  async fetchTasks(idMapping: IdMapping): Promise<CommonTask[]> {
    await this.client.connect();
    const vtodos = await this.client.fetchVTODOs();
    const allTasks = this.normalize(vtodos, idMapping);
    const filtered = this.filterByCategory(allTasks);
    return filtered.map((t) => ({
      ...t,
      tags: stripTagIdentifier(t.tags, this.caldavCategory),
    }));
  }

  /**
   * Normalize VTODOs into CommonTask[]. The server identity always lands in
   * `caldavId`; `uid` holds the mapped Obsidian task ID, or '' when the task
   * has no local identity yet (the sync engine assigns one at discovery). The
   * raw CalDAV UID is never used as a `uid` — the two keyspaces stay separate.
   */
  normalize(vtodos: CalendarObject[], idMapping: IdMapping): CommonTask[] {
    const tasks: CommonTask[] = [];

    for (const vtodo of vtodos) {
      const caldavId = this.mapper.extractUID(vtodo.data);
      if (!caldavId) continue;

      const uid = idMapping.caldavUidToTaskId[caldavId] ?? '';
      tasks.push(this.toCommonTask(vtodo, uid));
    }

    return tasks;
  }

  /**
   * Convert a single VTODO CalendarObject to a CommonTask. `uid` is the
   * Obsidian task ID ('' when unmapped); `caldavId` is the server identity,
   * derived here straight from the VTODO so it is always populated.
   */
  toCommonTask(vtodo: CalendarObject, uid: string): CommonTask {
    const parsed = this.mapper.vtodoToTask(vtodo);

    return {
      ...parsed,
      uid,
      caldavId: this.mapper.extractUID(vtodo.data),
      completedDate: parsed.completedDate ? this.toLocalDate(parsed.completedDate) : null,
    };
  }

  /**
   * COMPLETED is stored as a UTC datetime, but Obsidian completion is a
   * date-only value in the user's local zone. Convert the instant to the
   * user's local calendar date so a task completed just after local midnight
   * is not recorded as the previous day. See issue #43.
   */
  private toLocalDate(isoDateTime: string): string {
    const d = new Date(isoDateTime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Convert a CommonTask back to a VTODO iCal string. Injects the configured
   * caldavCategory into the outgoing CATEGORIES so the task stays identifiable
   * on the server even if user content tags don't include it. On update/complete
   * `existingData` is the untouched server body; the mapper mutates only
   * plugin-owned properties and lets foreign properties pass through.
   */
  fromCommonTask(task: CommonTask, caldavUID: string, existingData?: string): string {
    const tags = injectTagIdentifier(task.tags, this.caldavCategory);
    return this.mapper.taskToVTODO({ ...task, tags }, caldavUID, existingData);
  }

  /**
   * Apply a set of sync changes to the CalDAV server.
   * `onApplied` is called after each change is processed.
   */
  async applyChanges(changes: SyncChange[], idMapping: IdMapping, onApplied?: () => void): Promise<void> {
    for (const change of changes) {
      const caldavUID = this.resolveCaldavUid(change.task.uid, idMapping);

      switch (change.type) {
        case 'create': {
          const vtodoData = this.fromCommonTask(change.task, caldavUID);
          await this.client.createVTODO(vtodoData, caldavUID);
          break;
        }
        case 'update': {
          const existing = await this.client.fetchVTODOByUID(caldavUID);
          if (!existing) {
            console.error(`[CalDAVAdapter] VTODO ${caldavUID} not found for update, skipping`);
            continue;
          }
          const newData = this.fromCommonTask(change.task, caldavUID, existing.data);
          await this.client.updateVTODO(existing, newData);
          break;
        }
        case 'complete': {
          const existing = await this.client.fetchVTODOByUID(caldavUID);
          if (!existing) {
            console.error(`[CalDAVAdapter] VTODO ${caldavUID} not found for complete, skipping`);
            continue;
          }
          const completedTask: CommonTask = {
            ...change.task,
            recurrenceRule: '',
          };
          const newData = this.fromCommonTask(completedTask, caldavUID, existing.data);
          await this.client.updateVTODO(existing, newData);
          break;
        }
        case 'delete': {
          await this.client.deleteVTODOByUID(caldavUID);
          break;
        }
        case 'reconcile':
          break;
      }
      onApplied?.();
    }
  }

  private filterByCategory(tasks: CommonTask[]): CommonTask[] {
    const id = normalizeTagIdentifier(this.caldavCategory);
    if (!id) return tasks;
    return tasks.filter((task) =>
      task.tags.some((tag) => normalizeTagIdentifier(tag) === id)
    );
  }

  /**
   * Resolve an Obsidian task UID to the corresponding CalDAV UID.
   */
  private resolveCaldavUid(taskUid: string, idMapping: IdMapping): string {
    return idMapping.taskIdToCaldavUid[taskUid] ?? taskUid;
  }
}
