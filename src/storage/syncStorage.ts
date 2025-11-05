import { App, TFile, normalizePath } from 'obsidian';
import { MappingData, SyncState } from '../types';

/**
 * Manages persistence of sync-related data in .caldav-sync/ directory
 * Handles mapping.json (task<->CalDAV relationships) and state.json (sync metadata)
 */
export class SyncStorage {
  private app: App;
  private syncDir: string;
  private mappingPath: string;
  private statePath: string;

  constructor(app: App) {
    this.app = app;
    this.syncDir = normalizePath('.caldav-sync');
    this.mappingPath = normalizePath('.caldav-sync/mapping.json');
    this.statePath = normalizePath('.caldav-sync/state.json');
  }

  /**
   * Initialize sync storage directory and files
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
      await this.saveMapping(initialMapping);
    }

    // Initialize state.json if it doesn't exist
    if (!(await adapter.exists(this.statePath))) {
      const initialState: SyncState = {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
      await this.saveState(initialState);
    }
  }

  /**
   * Load mapping data from mapping.json
   */
  async loadMapping(): Promise<MappingData> {
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
   * Save mapping data to mapping.json
   */
  async saveMapping(data: MappingData): Promise<void> {
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
   * Load sync state from state.json
   */
  async loadState(): Promise<SyncState> {
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
   * Save sync state to state.json
   */
  async saveState(state: SyncState): Promise<void> {
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
  async updateLastSyncTime(): Promise<void> {
    const state = await this.loadState();
    state.lastSyncTime = new Date().toISOString();
    await this.saveState(state);
  }

  /**
   * Add a task mapping
   */
  async addTaskMapping(taskId: string, caldavUID: string, sourceFile: string): Promise<void> {
    const mapping = await this.loadMapping();
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

    await this.saveMapping(mapping);
  }

  /**
   * Remove a task mapping
   */
  async removeTaskMapping(taskId: string): Promise<void> {
    const mapping = await this.loadMapping();

    if (mapping.tasks[taskId]) {
      const caldavUID = mapping.tasks[taskId].caldavUID;
      delete mapping.tasks[taskId];
      delete mapping.caldavToTask[caldavUID];
      await this.saveMapping(mapping);
    }
  }

  /**
   * Get task ID from CalDAV UID
   */
  async getTaskIdFromCalDAV(caldavUID: string): Promise<string | undefined> {
    const mapping = await this.loadMapping();
    return mapping.caldavToTask[caldavUID];
  }

  /**
   * Get CalDAV UID from task ID
   */
  async getCalDAVFromTaskId(taskId: string): Promise<string | undefined> {
    const mapping = await this.loadMapping();
    return mapping.tasks[taskId]?.caldavUID;
  }

  /**
   * Check if task is tracked
   */
  async isTaskTracked(taskId: string): Promise<boolean> {
    const mapping = await this.loadMapping();
    return taskId in mapping.tasks;
  }

  /**
   * Check if CalDAV UID is tracked
   */
  async isCalDAVTracked(caldavUID: string): Promise<boolean> {
    const mapping = await this.loadMapping();
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
    await this.saveMapping(emptyMapping);

    const freshState: SyncState = {
      lastSyncTime: new Date().toISOString(),
      conflicts: []
    };
    await this.saveState(freshState);
  }
}
