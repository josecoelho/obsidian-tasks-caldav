export interface CalendarMapping {
  tag: string;
  calendarName: string;
  serverUrl: string;
  username: string;
  password: string;
}

export interface CalDAVSettings {
  calendars: CalendarMapping[];
  syncInterval: number;
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
}

export const DEFAULT_CALDAV_SETTINGS: CalDAVSettings = {
  calendars: [],
  syncInterval: 5,
  newTasksDestination: 'Inbox.md',
  newTasksSection: undefined,
  requireManualConflictResolution: true,
  autoResolveObsidianWins: false,
  syncCompletedTasks: false,
  deleteBehavior: 'ask',
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
