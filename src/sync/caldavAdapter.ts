import { CommonTask, SyncChange } from './types';
import { VTODOMapper, CalendarObject } from '../caldav/vtodoMapper';
import { CalDAVClient } from '../caldav/calDAVClientDirect';
import { IdMapping } from '../types';

export class CalDAVAdapter {
  private mapper: VTODOMapper;
  private client: CalDAVClient;

  constructor(client: CalDAVClient, mapper?: VTODOMapper) {
    this.client = client;
    this.mapper = mapper ?? new VTODOMapper();
  }

  /**
   * Full pipeline: connect → fetch → normalize → filter.
   * SyncEngine calls this and gets back CommonTask[].
   */
  async fetchTasks(syncTag: string | undefined, idMapping: IdMapping): Promise<CommonTask[]> {
    await this.client.connect();
    const vtodos = await this.client.fetchVTODOs();
    const allTasks = this.normalize(vtodos, idMapping);
    return this.filterByTag(allTasks, syncTag);
  }

  /**
   * Normalize VTODOs into CommonTask[], using IdMapping to resolve
   * CalDAV UIDs to Obsidian task IDs where a mapping exists.
   */
  normalize(vtodos: CalendarObject[], idMapping: IdMapping): CommonTask[] {
    const tasks: CommonTask[] = [];

    for (const vtodo of vtodos) {
      const caldavUid = this.mapper.extractUID(vtodo.data);
      if (!caldavUid) continue;

      const uid = idMapping.caldavUidToTaskId[caldavUid] ?? caldavUid;
      tasks.push(this.toCommonTask(vtodo, uid));
    }

    return tasks;
  }

  /**
   * Convert a single VTODO CalendarObject to a CommonTask.
   */
  toCommonTask(vtodo: CalendarObject, uid: string): CommonTask {
    const parsed = this.mapper.vtodoToTask(vtodo);

    return {
      ...parsed,
      uid,
      // Truncate completedDate to date-only (vtodo returns full datetime)
      completedDate: parsed.completedDate ? parsed.completedDate.split('T')[0] : null,
    };
  }

  /**
   * Convert a CommonTask back to a VTODO iCal string.
   */
  fromCommonTask(task: CommonTask, caldavUID: string): string {
    return this.mapper.taskToVTODO(task, caldavUID);
  }

  /**
   * Apply a set of sync changes to the CalDAV server.
   */
  async applyChanges(changes: SyncChange[], idMapping: IdMapping): Promise<void> {
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
          const newData = this.fromCommonTask(change.task, caldavUID);
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
          const newData = this.fromCommonTask(completedTask, caldavUID);
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
    }
  }

  /**
   * Filter tasks by sync tag. Only include tasks whose tags contain the sync tag.
   */
  private filterByTag(tasks: CommonTask[], syncTag?: string): CommonTask[] {
    if (!syncTag || syncTag.trim() === '') return tasks;
    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return tasks.filter((task) =>
      task.tags.some((tag) => tag.toLowerCase() === tagLower)
    );
  }

  /**
   * Resolve an Obsidian task UID to the corresponding CalDAV UID.
   */
  private resolveCaldavUid(taskUid: string, idMapping: IdMapping): string {
    return idMapping.taskIdToCaldavUid[taskUid] ?? taskUid;
  }
}
