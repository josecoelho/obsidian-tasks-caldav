export interface CalendarMapping {
  obsidianTag: string;
  caldavCategory: string;
  /** Internal: legacy name-match key, storage key, and label. Empty for URL-pinned calendars. */
  calendarName: string;
  /** Internal: legacy discovery base and storage key. Empty for URL-pinned calendars. */
  serverUrl: string;
  username: string;
  password: string;
  /**
   * Exact CalDAV collection URL. When set, the client talks to this collection
   * directly and skips discovery + name-matching. When empty, the mapping is a
   * legacy by-name calendar that discovers and matches by `calendarName`.
   */
  calendarUrl?: string;
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
  includeObsidianLink: boolean;
  showAutoSyncNotifications: boolean;
  /**
   * Names of migrations that have already been applied to this vault. Used by
   * {@link runMigrations} to gate each migration to a single successful run,
   * independent of the migration's own pre-state idempotency checks.
   */
  appliedMigrations?: string[];
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
  includeObsidianLink: false,
  showAutoSyncNotifications: false,
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
