import { CommonTask, SyncChange } from './types';
import { VTODOMapper, CalendarObject } from '../caldav/vtodoMapper';
import { CalDAVClient } from '../caldav/calDAVClientDirect';
import { IdMapping } from '../types';

export class CalDAVAdapter {
  private mapper: VTODOMapper;

  constructor(mapper?: VTODOMapper) {
    this.mapper = mapper ?? new VTODOMapper();
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
  async applyChanges(changes: SyncChange[], client: CalDAVClient, idMapping: IdMapping): Promise<void> {
    for (const change of changes) {
      const caldavUID = this.resolveCaldavUid(change.task.uid, idMapping);

      switch (change.type) {
        case 'create': {
          const vtodoData = this.fromCommonTask(change.task, caldavUID);
          await client.createVTODO(vtodoData, caldavUID);
          break;
        }
        case 'update': {
          const existing = await client.fetchVTODOByUID(caldavUID);
          if (!existing) {
            console.error(`[CalDAVAdapter] VTODO ${caldavUID} not found for update, skipping`);
            continue;
          }
          const newData = this.fromCommonTask(change.task, caldavUID);
          await client.updateVTODO(existing, newData);
          break;
        }
        case 'delete': {
          await client.deleteVTODOByUID(caldavUID);
          break;
        }
      }
    }
  }

  /**
   * Resolve an Obsidian task UID to the corresponding CalDAV UID.
   */
  private resolveCaldavUid(taskUid: string, idMapping: IdMapping): string {
    return idMapping.taskIdToCaldavUid[taskUid] ?? `obsidian-${taskUid}`;
  }
}
