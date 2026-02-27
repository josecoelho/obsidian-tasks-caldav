// CalDAV connection settings
export interface CalDAVSettings {
  serverUrl: string;
  username: string;
  password: string;
  calendarName: string;
  syncTag: string; // Tag for sync filtering (e.g., "sync"). Empty = sync all tasks.
  syncInterval: number; // minutes
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
}

export const DEFAULT_CALDAV_SETTINGS: CalDAVSettings = {
  serverUrl: '',
  username: '',
  password: '',
  calendarName: '',
  syncTag: 'sync', // Default to #sync tag
  syncInterval: 5,
  newTasksDestination: 'Inbox.md',
  newTasksSection: undefined,
  requireManualConflictResolution: true,
  autoResolveObsidianWins: false,
  syncCompletedTasks: false,
  deleteBehavior: 'ask'
};

/** Lean bidirectional identity mapping between Obsidian task IDs and CalDAV UIDs. */
export interface IdMapping {
  taskIdToCaldavUid: Record<string, string>;
  caldavUidToTaskId: Record<string, string>;
}

// Conflict info
export interface ConflictInfo {
  taskId: string;
  detectedAt: string;
  obsidianVersion: string;
  caldavVersion: string;
}

export interface SyncState {
  lastSyncTime: string;
  conflicts: ConflictInfo[];
}
