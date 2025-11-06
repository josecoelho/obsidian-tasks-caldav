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

// Task mapping
export interface TaskMapping {
  caldavUID: string;
  sourceFile: string;
  lastSyncedObsidian: string;
  lastSyncedCalDAV: string;
  lastModifiedObsidian: string;
  lastModifiedCalDAV: string;
}

export interface MappingData {
  tasks: Record<string, TaskMapping>; // taskId -> mapping
  caldavToTask: Record<string, string>; // caldavUID -> taskId
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
