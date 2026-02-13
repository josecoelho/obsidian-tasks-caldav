import { CommonTask, TaskStatus, TaskPriority, SyncChange } from './types';
import { VTODOMapper, CalendarObject, ObsidianTask } from '../caldav/vtodoMapper';
import { CalDAVClientDirect } from '../caldav/calDAVClientDirect';

export class CalDAVAdapter {
  private mapper: VTODOMapper;

  constructor(mapper?: VTODOMapper) {
    this.mapper = mapper ?? new VTODOMapper();
  }

  /**
   * Normalize VTODOs into CommonTask[], using the UID mapping to resolve
   * CalDAV UIDs to Obsidian task IDs where a mapping exists.
   */
  normalize(vtodos: CalendarObject[], uidMapping: Map<string, string>): CommonTask[] {
    const tasks: CommonTask[] = [];

    for (const vtodo of vtodos) {
      const caldavUID = this.mapper.extractUID(vtodo.data);
      if (!caldavUID) continue;

      const obsidianTaskId = uidMapping.get(caldavUID);
      const uid = obsidianTaskId ?? caldavUID;

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
      uid,
      title: parsed.description,
      status: parsed.status as TaskStatus,
      dueDate: parsed.dueDate,
      startDate: parsed.startDate,
      scheduledDate: parsed.scheduledDate,
      completedDate: parsed.completedDate ? parsed.completedDate.split('T')[0] : null,
      priority: parsed.priority as TaskPriority,
      tags: parsed.tags,
      recurrenceRule: parsed.recurrenceRule,
      notes: parsed.notes,
    };
  }

  /**
   * Convert a CommonTask back to a VTODO iCal string.
   */
  fromCommonTask(task: CommonTask, caldavUID: string): string {
    const obsidianTask: ObsidianTask = {
      description: task.title,
      status: task.status,
      dueDate: task.dueDate,
      startDate: task.startDate,
      scheduledDate: task.scheduledDate,
      completedDate: task.completedDate,
      priority: task.priority,
      tags: task.tags,
      recurrenceRule: task.recurrenceRule,
      notes: task.notes,
    };

    return this.mapper.taskToVTODO(obsidianTask, caldavUID);
  }

  /**
   * Apply a set of sync changes to the CalDAV server.
   */
  async applyChanges(changes: SyncChange[], client: CalDAVClientDirect, uidMapping: Map<string, string>): Promise<void> {
    for (const change of changes) {
      const caldavUID = this.resolveCaldavUID(change.task.uid, uidMapping);

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
   * If already a CalDAV UID (not in mapping), use it directly.
   */
  private resolveCaldavUID(taskUid: string, uidMapping: Map<string, string>): string {
    // uidMapping is caldavUID -> taskId, so we need the reverse
    for (const [caldavUID, taskId] of uidMapping.entries()) {
      if (taskId === taskUid) return caldavUID;
    }
    // Not mapped — this is a new task from Obsidian, generate CalDAV UID
    return `obsidian-${taskUid}`;
  }
}
