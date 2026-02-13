export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'none' | 'lowest' | 'low' | 'medium' | 'high' | 'highest';

export interface CommonTask {
  uid: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;       // 'YYYY-MM-DD'
  startDate: string | null;     // 'YYYY-MM-DD'
  scheduledDate: string | null; // 'YYYY-MM-DD'
  completedDate: string | null; // 'YYYY-MM-DD'
  priority: TaskPriority;
  tags: string[];               // without # prefix
  recurrenceRule: string;       // RRULE string or ''
}

export interface SyncChange {
  type: 'create' | 'update' | 'delete';
  task: CommonTask;
  previousVersion?: CommonTask;
}

export interface Changeset {
  toObsidian: SyncChange[];
  toCalDAV: SyncChange[];
  conflicts: Conflict[];
}

export interface Conflict {
  uid: string;
  obsidianVersion: CommonTask;
  caldavVersion: CommonTask;
  baselineVersion: CommonTask;
}

export type ConflictStrategy = 'caldav-wins' | 'obsidian-wins';
