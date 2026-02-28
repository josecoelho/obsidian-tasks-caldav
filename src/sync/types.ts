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
  body: string;                 // multi-line body text, '' = no body
}

export interface SyncChange {
  type: 'create' | 'update' | 'delete' | 'complete' | 'reconcile';
  task: CommonTask;
  previousVersion?: CommonTask;
  counterpartUid?: string;
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
