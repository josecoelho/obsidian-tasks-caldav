import { App, TFile, normalizePath } from 'obsidian';
import { MappingData, SyncState } from '../types';

/**
 * Manages persistence of sync-related data in .caldav-sync/ directory
 * Handles mapping.json (task<->CalDAV relationships) and state.json (sync metadata)
 *
 * Performance: Uses in-memory caching to avoid excessive disk I/O during bulk operations.
 * Data is loaded once during initialize() and kept in memory. Explicit save() must be
 * called to persist changes to disk.
 */
export class SyncStorage {
  private app: App;
  private syncDir: string;
  private mappingPath: string;
  private statePath: string;

  // In-memory caches
  private mappingCache: MappingData | null = null;
  private stateCache: SyncState | null = null;

  // Dirty flags to track unsaved changes
  private mappingDirty: boolean = false;
  private stateDirty: boolean = false;

  constructor(app: App) {
    this.app = app;
    this.syncDir = normalizePath('.caldav-sync');
    this.mappingPath = normalizePath('.caldav-sync/mapping.json');
    this.statePath = normalizePath('.caldav-sync/state.json');
  }

  /**
   * Initialize sync storage directory, files, and in-memory caches
   */
  async initialize(): Promise<void> {
    // Create .caldav-sync directory if it doesn't exist
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.syncDir))) {
      await adapter.mkdir(this.syncDir);
    }

    // Initialize mapping.json if it doesn't exist
    if (!(await adapter.exists(this.mappingPath))) {
      const initialMapping: MappingData = {
        tasks: {},
        caldavToTask: {}
      };
      const content = JSON.stringify(initialMapping, null, 2);
      await adapter.write(this.mappingPath, content);
    }

    // Initialize state.json if it doesn't exist
    if (!(await adapter.exists(this.statePath))) {
      const initialState: SyncState = {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
      const content = JSON.stringify(initialState, null, 2);
      await adapter.write(this.statePath, content);
    }

    // Load data into caches
    await this.loadIntoCache();
  }

  /**
   * Load data from disk into in-memory caches
   */
  private async loadIntoCache(): Promise<void> {
    this.mappingCache = await this.loadMappingFromDisk();
    this.stateCache = await this.loadStateFromDisk();
    this.mappingDirty = false;
    this.stateDirty = false;
  }

  /**
   * Load mapping data from disk (private - use cache instead)
   */
  private async loadMappingFromDisk(): Promise<MappingData> {
    try {
      const adapter = this.app.vault.adapter;
      const content = await adapter.read(this.mappingPath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load mapping data:', error);
      // Return empty mapping if file doesn't exist or is corrupted
      return {
        tasks: {},
        caldavToTask: {}
      };
    }
  }

  /**
   * Load sync state from disk (private - use cache instead)
   */
  private async loadStateFromDisk(): Promise<SyncState> {
    try {
      const adapter = this.app.vault.adapter;
      const content = await adapter.read(this.statePath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load sync state:', error);
      // Return default state if file doesn't exist or is corrupted
      return {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
    }
  }

  /**
   * Get mapping data from cache
   */
  getMapping(): MappingData {
    if (!this.mappingCache) {
      throw new Error('SyncStorage not initialized - call initialize() first');
    }
    return this.mappingCache;
  }

  /**
   * Get sync state from cache
   */
  getState(): SyncState {
    if (!this.stateCache) {
      throw new Error('SyncStorage not initialized - call initialize() first');
    }
    return this.stateCache;
  }

  /**
   * Save all dirty data to disk
   * Call this at the end of sync operations to persist changes
   */
  async save(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.mappingDirty && this.mappingCache) {
      promises.push(this.saveMappingToDisk(this.mappingCache));
      this.mappingDirty = false;
    }

    if (this.stateDirty && this.stateCache) {
      promises.push(this.saveStateToDisk(this.stateCache));
      this.stateDirty = false;
    }

    await Promise.all(promises);
  }

  /**
   * Save mapping data to disk (private)
   */
  private async saveMappingToDisk(data: MappingData): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const content = JSON.stringify(data, null, 2);
      await adapter.write(this.mappingPath, content);
    } catch (error) {
      console.error('Failed to save mapping data:', error);
      throw error;
    }
  }

  /**
   * Save sync state to disk (private)
   */
  private async saveStateToDisk(state: SyncState): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const content = JSON.stringify(state, null, 2);
      await adapter.write(this.statePath, content);
    } catch (error) {
      console.error('Failed to save sync state:', error);
      throw error;
    }
  }

  /**
   * Update last sync time
   */
  updateLastSyncTime(): void {
    const state = this.getState();
    state.lastSyncTime = new Date().toISOString();
    this.stateDirty = true;
  }

  /**
   * Add a task mapping
   */
  addTaskMapping(taskId: string, caldavUID: string, sourceFile: string): void {
    const mapping = this.getMapping();
    const now = new Date().toISOString();

    mapping.tasks[taskId] = {
      caldavUID,
      sourceFile,
      lastSyncedObsidian: now,
      lastSyncedCalDAV: now,
      lastModifiedObsidian: now,
      lastModifiedCalDAV: now
    };

    mapping.caldavToTask[caldavUID] = taskId;
    this.mappingDirty = true;
  }

  /**
   * Remove a task mapping
   */
  removeTaskMapping(taskId: string): void {
    const mapping = this.getMapping();

    if (mapping.tasks[taskId]) {
      const caldavUID = mapping.tasks[taskId].caldavUID;
      delete mapping.tasks[taskId];
      delete mapping.caldavToTask[caldavUID];
      this.mappingDirty = true;
    }
  }

  /**
   * Get task ID from CalDAV UID
   */
  getTaskIdFromCalDAV(caldavUID: string): string | undefined {
    const mapping = this.getMapping();
    return mapping.caldavToTask[caldavUID];
  }

  /**
   * Get CalDAV UID from task ID
   */
  getCalDAVFromTaskId(taskId: string): string | undefined {
    const mapping = this.getMapping();
    return mapping.tasks[taskId]?.caldavUID;
  }

  /**
   * Check if task is tracked
   */
  isTaskTracked(taskId: string): boolean {
    const mapping = this.getMapping();
    return taskId in mapping.tasks;
  }

  /**
   * Check if CalDAV UID is tracked
   */
  isCalDAVTracked(caldavUID: string): boolean {
    const mapping = this.getMapping();
    return caldavUID in mapping.caldavToTask;
  }

  /**
   * Clear all sync data (use with caution)
   */
  async clearAll(): Promise<void> {
    const emptyMapping: MappingData = {
      tasks: {},
      caldavToTask: {}
    };

    const freshState: SyncState = {
      lastSyncTime: new Date().toISOString(),
      conflicts: []
    };

    this.mappingCache = emptyMapping;
    this.stateCache = freshState;
    this.mappingDirty = true;
    this.stateDirty = true;

    await this.save();
  }
}
