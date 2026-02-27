import { App, normalizePath } from 'obsidian';
import { IdMapping, SyncState } from '../types';
import { CommonTask } from '../sync/types';

/**
 * Manages persistence of sync-related data in .caldav-sync/ directory.
 * Files: id-mapping.json, state.json, baseline.json
 *
 * Performance: Uses in-memory caching to avoid excessive disk I/O during bulk operations.
 * Data is loaded once during initialize() and kept in memory. Explicit save() must be
 * called to persist changes to disk.
 */
export class SyncStorage {
  private app: App;
  private syncDir: string;
  private statePath: string;
  private baselinePath: string;
  private idMappingPath: string;

  // In-memory caches
  private stateCache: SyncState | null = null;
  private baselineCache: CommonTask[] | null = null;
  private idMappingCache: IdMapping | null = null;

  // Dirty flags to track unsaved changes
  private stateDirty: boolean = false;
  private baselineDirty: boolean = false;
  private idMappingDirty: boolean = false;

  constructor(app: App) {
    this.app = app;
    this.syncDir = normalizePath('.caldav-sync');
    this.statePath = normalizePath('.caldav-sync/state.json');
    this.baselinePath = normalizePath('.caldav-sync/baseline.json');
    this.idMappingPath = normalizePath('.caldav-sync/id-mapping.json');
  }

  /**
   * Initialize sync storage directory, files, and in-memory caches.
   * Automatically migrates old mapping.json → id-mapping.json if needed.
   */
  async initialize(): Promise<void> {
    const adapter = this.app.vault.adapter;

    // Create .caldav-sync directory if it doesn't exist
    if (!(await adapter.exists(this.syncDir))) {
      await adapter.mkdir(this.syncDir);
    }

    // Initialize state.json if it doesn't exist
    if (!(await adapter.exists(this.statePath))) {
      const initialState: SyncState = {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
      await adapter.write(this.statePath, JSON.stringify(initialState, null, 2));
    }

    // Load data into caches
    await this.loadIntoCache();

    // Migrate old mapping.json → id-mapping.json if needed
    await this.migrateFromMappingJson();
  }

  /**
   * Load data from disk into in-memory caches
   */
  private async loadIntoCache(): Promise<void> {
    this.stateCache = await this.loadStateFromDisk();
    this.baselineCache = await this.loadBaselineFromDisk();
    this.idMappingCache = await this.loadIdMappingFromDisk();
    this.stateDirty = false;
    this.baselineDirty = false;
    this.idMappingDirty = false;
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
      return {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
    }
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
   * Save all dirty data to disk.
   * Call this at the end of sync operations to persist changes.
   */
  async save(): Promise<void> {
    const promises: Promise<void>[] = [];

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
   * Save sync state to disk (private)
   */
  private async saveStateToDisk(state: SyncState): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      await adapter.write(this.statePath, JSON.stringify(state, null, 2));
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
      await adapter.write(this.baselinePath, JSON.stringify(baseline, null, 2));
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
      await adapter.write(this.idMappingPath, JSON.stringify(idMapping, null, 2));
    } catch (error) {
      console.error('Failed to save IdMapping:', error);
      throw error;
    }
  }

  /**
   * One-time migration: reads old mapping.json and populates id-mapping.json.
   * Skips if IdMapping already has entries or mapping.json doesn't exist.
   */
  private async migrateFromMappingJson(): Promise<void> {
    const idMapping = this.getIdMapping();
    if (Object.keys(idMapping.taskIdToCaldavUid).length > 0) return;

    const adapter = this.app.vault.adapter;
    const mappingPath = normalizePath('.caldav-sync/mapping.json');
    if (!(await adapter.exists(mappingPath))) return;

    try {
      const content = await adapter.read(mappingPath);
      const oldMapping = JSON.parse(content) as {
        tasks: Record<string, { caldavUID: string }>;
      };

      if (!oldMapping.tasks || Object.keys(oldMapping.tasks).length === 0) return;

      const migrated: IdMapping = {
        taskIdToCaldavUid: {},
        caldavUidToTaskId: {},
      };

      for (const [taskId, taskMapping] of Object.entries(oldMapping.tasks)) {
        migrated.taskIdToCaldavUid[taskId] = taskMapping.caldavUID;
        migrated.caldavUidToTaskId[taskMapping.caldavUID] = taskId;
      }

      this.setIdMapping(migrated);
      await this.saveIdMappingToDisk(migrated);
      this.idMappingDirty = false;
    } catch (error) {
      console.error('Failed to migrate from mapping.json:', error);
    }
  }

  /**
   * Clear all sync data (use with caution)
   */
  async clearAll(): Promise<void> {
    const freshState: SyncState = {
      lastSyncTime: new Date().toISOString(),
      conflicts: []
    };

    this.stateCache = freshState;
    this.baselineCache = [];
    this.idMappingCache = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
    this.stateDirty = true;
    this.baselineDirty = true;
    this.idMappingDirty = true;

    await this.save();
  }
}
