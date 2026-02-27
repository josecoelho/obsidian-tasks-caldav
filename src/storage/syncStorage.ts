import { App, normalizePath } from 'obsidian';
import { IdMapping, MappingData, SyncState, TaskMapping } from '../types';
import { CommonTask } from '../sync/types';

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
  private baselinePath: string;
  private idMappingPath: string;

  // In-memory caches
  private mappingCache: MappingData | null = null;
  private stateCache: SyncState | null = null;
  private baselineCache: CommonTask[] | null = null;
  private idMappingCache: IdMapping | null = null;

  // Dirty flags to track unsaved changes
  private mappingDirty: boolean = false;
  private stateDirty: boolean = false;
  private baselineDirty: boolean = false;
  private idMappingDirty: boolean = false;

  constructor(app: App) {
    this.app = app;
    this.syncDir = normalizePath('.caldav-sync');
    this.mappingPath = normalizePath('.caldav-sync/mapping.json');
    this.statePath = normalizePath('.caldav-sync/state.json');
    this.baselinePath = normalizePath('.caldav-sync/baseline.json');
    this.idMappingPath = normalizePath('.caldav-sync/id-mapping.json');
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
    this.baselineCache = await this.loadBaselineFromDisk();
    this.idMappingCache = await this.loadIdMappingFromDisk();
    this.mappingDirty = false;
    this.stateDirty = false;
    this.baselineDirty = false;
    this.idMappingDirty = false;
  }

  /**
   * Load mapping data from disk (private - use cache instead)
   */
  private async loadMappingFromDisk(): Promise<MappingData> {
    try {
      const adapter = this.app.vault.adapter;
      const content = await adapter.read(this.mappingPath);
      return JSON.parse(content) as MappingData;
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
      return JSON.parse(content) as SyncState;
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
   * Get IdMapping from cache
   */
  getIdMapping(): IdMapping {
    return this.idMappingCache ?? { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
  }

  /**
   * Update IdMapping
   */
  setIdMapping(idMapping: IdMapping): void {
    this.idMappingCache = idMapping;
    this.idMappingDirty = true;
  }

  /**
   * One-time migration: convert bloated MappingData → lean IdMapping.
   * Safe to call multiple times — skips if IdMapping already has entries.
   */
  migrateFromMappingData(): void {
    const idMapping = this.getIdMapping();
    if (Object.keys(idMapping.taskIdToCaldavUid).length > 0) return;

    const mapping = this.getMapping();
    if (Object.keys(mapping.tasks).length === 0) return;

    const migrated: IdMapping = {
      taskIdToCaldavUid: {},
      caldavUidToTaskId: {},
    };

    for (const [taskId, taskMapping] of Object.entries(mapping.tasks)) {
      migrated.taskIdToCaldavUid[taskId] = taskMapping.caldavUID;
      migrated.caldavUidToTaskId[taskMapping.caldavUID] = taskId;
    }

    this.setIdMapping(migrated);
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

    if (this.baselineDirty && this.baselineCache) {
      promises.push(this.saveBaselineToDisk(this.baselineCache));
      this.baselineDirty = false;
    }

    if (this.idMappingDirty && this.idMappingCache) {
      promises.push(this.saveIdMappingToDisk(this.idMappingCache));
      this.idMappingDirty = false;
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
   * Get task mapping for a task ID
   */
  getTaskMapping(taskId: string): TaskMapping | undefined {
    const mapping = this.getMapping();
    return mapping.tasks[taskId];
  }

  /**
   * Update CalDAV modification timestamp for a task
   */
  updateCalDAVTimestamp(taskId: string, lastModified: string): void {
    const mapping = this.getMapping();
    if (mapping.tasks[taskId]) {
      mapping.tasks[taskId].lastModifiedCalDAV = lastModified;
      mapping.tasks[taskId].lastSyncedCalDAV = new Date().toISOString();
      this.mappingDirty = true;
    }
  }

  /**
   * Update Obsidian modification timestamp for a task
   */
  updateObsidianTimestamp(taskId: string, lastModified: string): void {
    const mapping = this.getMapping();
    if (mapping.tasks[taskId]) {
      mapping.tasks[taskId].lastModifiedObsidian = lastModified;
      mapping.tasks[taskId].lastSyncedObsidian = new Date().toISOString();
      this.mappingDirty = true;
    }
  }

  /**
   * Get baseline snapshot from cache
   */
  getBaseline(): CommonTask[] {
    return this.baselineCache ?? [];
  }

  /**
   * Update baseline snapshot
   */
  setBaseline(tasks: CommonTask[]): void {
    this.baselineCache = tasks;
    this.baselineDirty = true;
  }

  /**
   * Load baseline from disk
   */
  private async loadBaselineFromDisk(): Promise<CommonTask[]> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.baselinePath))) {
        return [];
      }
      const content = await adapter.read(this.baselinePath);
      const tasks = JSON.parse(content) as CommonTask[];
      // Migrate old baselines: default missing `body` to ''
      return tasks.map(t => ({ ...t, body: t.body ?? '' }));
    } catch (error) {
      console.error('Failed to load baseline:', error);
      return [];
    }
  }

  /**
   * Save baseline to disk
   */
  private async saveBaselineToDisk(baseline: CommonTask[]): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const content = JSON.stringify(baseline, null, 2);
      await adapter.write(this.baselinePath, content);
    } catch (error) {
      console.error('Failed to save baseline:', error);
      throw error;
    }
  }

  /**
   * Load IdMapping from disk
   */
  private async loadIdMappingFromDisk(): Promise<IdMapping> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.idMappingPath))) {
        return { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
      }
      const content = await adapter.read(this.idMappingPath);
      return JSON.parse(content) as IdMapping;
    } catch (error) {
      console.error('Failed to load IdMapping:', error);
      return { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
    }
  }

  /**
   * Save IdMapping to disk
   */
  private async saveIdMappingToDisk(idMapping: IdMapping): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const content = JSON.stringify(idMapping, null, 2);
      await adapter.write(this.idMappingPath, content);
    } catch (error) {
      console.error('Failed to save IdMapping:', error);
      throw error;
    }
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
    this.baselineCache = [];
    this.idMappingCache = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
    this.mappingDirty = true;
    this.stateDirty = true;
    this.baselineDirty = true;
    this.idMappingDirty = true;

    await this.save();
  }
}
