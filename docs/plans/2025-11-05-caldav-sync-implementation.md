# CalDAV Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement bidirectional task synchronization between Obsidian (via obsidian-tasks plugin) and CalDAV servers.

**Architecture:** Pull-first sync strategy with mapping file tracking task↔VTODO relationships. Uses obsidian-tasks API for task discovery/modification, tsdav library for CalDAV operations, and timestamp-based IDs for task identification.

**Tech Stack:** TypeScript, Obsidian Plugin API, obsidian-tasks API, tsdav (CalDAV client), esbuild

**Design Reference:** `docs/plans/2025-11-05-caldav-sync-design.md`

## Task Management with Beads

This project uses **beads** for issue tracking and task management. All implementation tasks are tracked as beads issues with proper dependencies.

**Workflow:**
1. Find ready work: `/beads:ready` or `mcp__plugin_beads_beads__ready`
2. Claim a task: Update status to `in_progress`
3. Work on it: Follow the implementation steps below
4. Complete: Close the issue with `/beads:close <id> "Completed: <summary>"`
5. Check what's unblocked: Use `/beads:ready` to see newly available tasks

**Task IDs:**
- tasks-caldav-19: Project Setup and Dependencies (Task 1)
- tasks-caldav-20: Task ID Generator (Task 2)
- tasks-caldav-21: Mapping and State Storage (Task 3)
- tasks-caldav-22: CalDAV Client Wrapper (Task 4)
- tasks-caldav-23: Task Manager Integration (Task 5)
- tasks-caldav-24: Main Plugin Setup (Task 6)
- tasks-caldav-25: Sync Engine Implementation (Task 7)
- tasks-caldav-26: Testing and Documentation (Task 8)
- tasks-caldav-27: Final Testing and Polish (Task 9)

**Dependencies:**
Tasks have proper blocking dependencies set up. Tasks 2-4 can be worked on in parallel after Task 1 is complete.

---

## Task 1: Project Setup and Dependencies

**Files:**
- Modify: `package.json`
- Modify: `manifest.json`
- Create: `src/types.ts`

**Step 1: Update package.json with dependencies**

Add tsdav and update project metadata:

```bash
npm install tsdav
npm install --save-dev @types/node
```

**Step 2: Update manifest.json with correct plugin metadata**

Replace sample plugin info with actual plugin info:

```json
{
  "id": "obsidian-tasks-caldav",
  "name": "Tasks CalDAV Sync",
  "version": "0.1.0",
  "minAppVersion": "0.15.0",
  "description": "Bidirectional sync between Obsidian tasks and CalDAV servers",
  "author": "Your Name",
  "authorUrl": "",
  "isDesktopOnly": false
}
```

**Step 3: Create type definitions**

Create: `src/types.ts`

```typescript
// CalDAV connection settings
export interface CalDAVSettings {
  serverUrl: string;
  username: string;
  password: string;
  calendarName: string;
  syncQuery: string;
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
  syncQuery: 'not done',
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
```

**Step 4: Verify build still works**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add package.json package-lock.json manifest.json src/types.ts
git commit -m "feat: add project dependencies and type definitions

- Add tsdav for CalDAV operations
- Update manifest with plugin metadata
- Create types for settings, mappings, and sync state"
```

---

## Task 2: Task ID Generator

**Files:**
- Create: `src/utils/taskIdGenerator.ts`
- Create: `src/utils/taskIdGenerator.test.ts` (if adding tests later)

**Step 1: Create ID generator utility**

Create: `src/utils/taskIdGenerator.ts`

```typescript
/**
 * Generates timestamp-based task IDs in format: YYYYMMDD-xxx
 * where xxx is a 3-character random suffix (lowercase alphanumeric)
 */
export class TaskIdGenerator {
  private static readonly ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  private static readonly SUFFIX_LENGTH = 3;

  /**
   * Generate a new task ID
   * @param existingIds Set of existing IDs to check for collisions
   * @returns Unique task ID in format YYYYMMDD-xxx
   */
  static generate(existingIds: Set<string> = new Set()): string {
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const id = this.generateId();
      if (!existingIds.has(id)) {
        return id;
      }
    }

    throw new Error('Failed to generate unique task ID after maximum attempts');
  }

  private static generateId(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const datePart = `${year}${month}${day}`;

    const suffix = this.generateRandomSuffix();

    return `${datePart}-${suffix}`;
  }

  private static generateRandomSuffix(): string {
    let suffix = '';
    for (let i = 0; i < this.SUFFIX_LENGTH; i++) {
      const randomIndex = Math.floor(Math.random() * this.ALPHABET.length);
      suffix += this.ALPHABET[randomIndex];
    }
    return suffix;
  }

  /**
   * Validate if a string is a valid task ID format
   */
  static isValidFormat(id: string): boolean {
    // Format: YYYYMMDD-xxx where xxx is 3 lowercase alphanumeric
    const pattern = /^\d{8}-[a-z0-9]{3}$/;
    return pattern.test(id);
  }
}
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/utils/taskIdGenerator.ts
git commit -m "feat: add timestamp-based task ID generator

Generates IDs in format YYYYMMDD-xxx with collision detection"
```

---

## Task 3: Mapping and State Storage

**Files:**
- Create: `src/storage/syncStorage.ts`

**Step 1: Create sync storage manager**

Create: `src/storage/syncStorage.ts`

```typescript
import { App, normalizePath } from 'obsidian';
import { MappingData, SyncState, TaskMapping } from '../types';

export class SyncStorage {
  private app: App;
  private syncDir: string;
  private mappingPath: string;
  private statePath: string;

  constructor(app: App) {
    this.app = app;
    this.syncDir = '.caldav-sync';
    this.mappingPath = normalizePath(`${this.syncDir}/mapping.json`);
    this.statePath = normalizePath(`${this.syncDir}/state.json`);
  }

  /**
   * Initialize sync directory structure
   */
  async initialize(): Promise<void> {
    const adapter = this.app.vault.adapter;

    // Create .caldav-sync directory if it doesn't exist
    if (!(await adapter.exists(this.syncDir))) {
      await adapter.mkdir(this.syncDir);
    }

    // Initialize mapping.json if it doesn't exist
    if (!(await adapter.exists(this.mappingPath))) {
      const emptyMapping: MappingData = {
        tasks: {},
        caldavToTask: {}
      };
      await this.saveMapping(emptyMapping);
    }

    // Initialize state.json if it doesn't exist
    if (!(await adapter.exists(this.statePath))) {
      const emptyState: SyncState = {
        lastSyncTime: new Date().toISOString(),
        conflicts: []
      };
      await this.saveState(emptyState);
    }
  }

  /**
   * Load mapping data
   */
  async loadMapping(): Promise<MappingData> {
    try {
      const content = await this.app.vault.adapter.read(this.mappingPath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load mapping, returning empty:', error);
      return { tasks: {}, caldavToTask: {} };
    }
  }

  /**
   * Save mapping data
   */
  async saveMapping(data: MappingData): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await this.app.vault.adapter.write(this.mappingPath, content);
  }

  /**
   * Load sync state
   */
  async loadState(): Promise<SyncState> {
    try {
      const content = await this.app.vault.adapter.read(this.statePath);
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load state, returning empty:', error);
      return { lastSyncTime: new Date().toISOString(), conflicts: [] };
    }
  }

  /**
   * Save sync state
   */
  async saveState(state: SyncState): Promise<void> {
    const content = JSON.stringify(state, null, 2);
    await this.app.vault.adapter.write(this.statePath, content);
  }

  /**
   * Add or update task mapping
   */
  async updateTaskMapping(taskId: string, mapping: TaskMapping): Promise<void> {
    const data = await this.loadMapping();
    data.tasks[taskId] = mapping;
    data.caldavToTask[mapping.caldavUID] = taskId;
    await this.saveMapping(data);
  }

  /**
   * Get task mapping by task ID
   */
  async getTaskMapping(taskId: string): Promise<TaskMapping | undefined> {
    const data = await this.loadMapping();
    return data.tasks[taskId];
  }

  /**
   * Get task ID by CalDAV UID
   */
  async getTaskIdByCalDAVUID(caldavUID: string): Promise<string | undefined> {
    const data = await this.loadMapping();
    return data.caldavToTask[caldavUID];
  }

  /**
   * Remove task mapping
   */
  async removeTaskMapping(taskId: string): Promise<void> {
    const data = await this.loadMapping();
    const mapping = data.tasks[taskId];
    if (mapping) {
      delete data.caldavToTask[mapping.caldavUID];
      delete data.tasks[taskId];
      await this.saveMapping(data);
    }
  }

  /**
   * Get all existing task IDs
   */
  async getAllTaskIds(): Promise<Set<string>> {
    const data = await this.loadMapping();
    return new Set(Object.keys(data.tasks));
  }
}
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/storage/syncStorage.ts
git commit -m "feat: add sync storage manager

Handles mapping.json and state.json persistence in .caldav-sync/"
```

---

## Task 4: CalDAV Client Wrapper

**Files:**
- Create: `src/caldav/calDAVClient.ts`
- Create: `src/caldav/vtodoMapper.ts`

**Step 1: Create VTODO mapper utility**

Create: `src/caldav/vtodoMapper.ts`

```typescript
/**
 * Maps between obsidian-tasks Task objects and CalDAV VTODO format
 */

export interface TaskData {
  description: string;
  status: 'TODO' | 'COMPLETED';
  dueDate?: string;
  scheduledDate?: string;
  startDate?: string;
  completedDate?: string;
  priority?: number;
  recurrence?: string;
}

export class VTodoMapper {
  /**
   * Convert task data to VTODO iCalendar format
   */
  static toVTodo(taskData: TaskData, uid: string): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Obsidian Tasks CalDAV//EN',
      'BEGIN:VTODO',
      `UID:${uid}`,
      `SUMMARY:${this.escapeText(taskData.description)}`,
      `STATUS:${taskData.status === 'COMPLETED' ? 'COMPLETED' : 'NEEDS-ACTION'}`
    ];

    if (taskData.dueDate) {
      lines.push(`DUE:${this.formatDate(taskData.dueDate)}`);
    }

    if (taskData.startDate || taskData.scheduledDate) {
      const startDate = taskData.scheduledDate || taskData.startDate;
      lines.push(`DTSTART:${this.formatDate(startDate)}`);
    }

    if (taskData.completedDate && taskData.status === 'COMPLETED') {
      lines.push(`COMPLETED:${this.formatDate(taskData.completedDate)}`);
    }

    if (taskData.priority !== undefined) {
      lines.push(`PRIORITY:${taskData.priority}`);
    }

    // TODO: Add RRULE support for recurrence in future task
    // For now, recurrence is not synced to CalDAV

    lines.push('END:VTODO');
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  /**
   * Parse VTODO iCalendar format to task data
   */
  static fromVTodo(vtodoText: string): { uid: string; data: TaskData } | null {
    const lines = vtodoText.split(/\r?\n/);

    let uid = '';
    let description = '';
    let status: 'TODO' | 'COMPLETED' = 'TODO';
    let dueDate: string | undefined;
    let startDate: string | undefined;
    let completedDate: string | undefined;
    let priority: number | undefined;

    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':');

      switch (key) {
        case 'UID':
          uid = value;
          break;
        case 'SUMMARY':
          description = this.unescapeText(value);
          break;
        case 'STATUS':
          status = value === 'COMPLETED' ? 'COMPLETED' : 'TODO';
          break;
        case 'DUE':
          dueDate = this.parseDate(value);
          break;
        case 'DTSTART':
          startDate = this.parseDate(value);
          break;
        case 'COMPLETED':
          completedDate = this.parseDate(value);
          break;
        case 'PRIORITY':
          priority = parseInt(value, 10);
          break;
      }
    }

    if (!uid) {
      return null;
    }

    return {
      uid,
      data: {
        description,
        status,
        dueDate,
        scheduledDate: startDate,
        completedDate,
        priority
      }
    };
  }

  private static escapeText(text: string): string {
    return text.replace(/[\\;,\n]/g, (char) => {
      switch (char) {
        case '\\': return '\\\\';
        case ';': return '\\;';
        case ',': return '\\,';
        case '\n': return '\\n';
        default: return char;
      }
    });
  }

  private static unescapeText(text: string): string {
    return text.replace(/\\(.)/g, (_, char) => {
      switch (char) {
        case 'n': return '\n';
        default: return char;
      }
    });
  }

  private static formatDate(dateStr: string): string {
    // Convert YYYY-MM-DD to YYYYMMDD format for iCalendar
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private static parseDate(icalDate: string): string {
    // Convert YYYYMMDD to YYYY-MM-DD
    if (icalDate.length >= 8) {
      const year = icalDate.substring(0, 4);
      const month = icalDate.substring(4, 6);
      const day = icalDate.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    return icalDate;
  }
}
```

**Step 2: Create CalDAV client wrapper**

Create: `src/caldav/calDAVClient.ts`

```typescript
import { createDAVClient, DAVClient, DAVCalendar, DAVCalendarObject } from 'tsdav';
import { VTodoMapper, TaskData } from './vtodoMapper';

export interface CalDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarName: string;
}

export class CalDAVClient {
  private client: DAVClient | null = null;
  private config: CalDAVConfig;
  private calendar: DAVCalendar | null = null;

  constructor(config: CalDAVConfig) {
    this.config = config;
  }

  /**
   * Connect to CalDAV server and find the calendar
   */
  async connect(): Promise<void> {
    this.client = await createDAVClient({
      serverUrl: this.config.serverUrl,
      credentials: {
        username: this.config.username,
        password: this.config.password
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    });

    // Fetch calendars
    const calendars = await this.client.fetchCalendars();

    // Find the specified calendar
    this.calendar = calendars.find(cal => cal.displayName === this.config.calendarName) || null;

    if (!this.calendar) {
      throw new Error(`Calendar "${this.config.calendarName}" not found`);
    }
  }

  /**
   * Test connection to server
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch (error) {
      console.error('CalDAV connection test failed:', error);
      return false;
    }
  }

  /**
   * Fetch all VTODOs from the calendar
   */
  async fetchAllTodos(): Promise<Array<{ uid: string; data: TaskData; etag: string }>> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    const objects = await this.client.fetchCalendarObjects({
      calendar: this.calendar,
      objectUrls: undefined // fetch all
    });

    const todos: Array<{ uid: string; data: TaskData; etag: string }> = [];

    for (const obj of objects) {
      if (obj.data && obj.data.includes('BEGIN:VTODO')) {
        const parsed = VTodoMapper.fromVTodo(obj.data);
        if (parsed) {
          todos.push({
            uid: parsed.uid,
            data: parsed.data,
            etag: obj.etag || ''
          });
        }
      }
    }

    return todos;
  }

  /**
   * Create a new VTODO
   */
  async createTodo(taskData: TaskData): Promise<string> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    // Generate unique UID
    const uid = this.generateUID();
    const vtodo = VTodoMapper.toVTodo(taskData, uid);

    await this.client.createCalendarObject({
      calendar: this.calendar,
      filename: `${uid}.ics`,
      iCalString: vtodo
    });

    return uid;
  }

  /**
   * Update an existing VTODO
   */
  async updateTodo(uid: string, taskData: TaskData): Promise<void> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    const vtodo = VTodoMapper.toVTodo(taskData, uid);

    await this.client.updateCalendarObject({
      calendarObject: {
        url: `${this.calendar.url}/${uid}.ics`,
        data: vtodo,
        etag: ''
      }
    });
  }

  /**
   * Delete a VTODO
   */
  async deleteTodo(uid: string): Promise<void> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    await this.client.deleteCalendarObject({
      calendarObject: {
        url: `${this.calendar.url}/${uid}.ics`,
        etag: ''
      }
    });
  }

  private generateUID(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}@obsidian`;
  }
}
```

**Step 3: Verify build works**

Run: `npm run build`
Expected: Build succeeds (may have warnings about unused imports)

**Step 4: Commit**

```bash
git add src/caldav/
git commit -m "feat: add CalDAV client wrapper and VTODO mapper

- Create CalDAVClient for server operations
- Add VTodoMapper for Task<->VTODO conversion
- Support create, update, delete, and fetch operations"
```

---

## Task 5: Task Manager (obsidian-tasks Integration)

**Files:**
- Create: `src/tasks/taskManager.ts`

**Step 1: Create task manager**

Create: `src/tasks/taskManager.ts`

```typescript
import { App, TFile, Vault } from 'obsidian';
import { TaskIdGenerator } from '../utils/taskIdGenerator';

/**
 * Manages interaction with obsidian-tasks plugin
 */
export class TaskManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Get obsidian-tasks plugin API
   */
  private getTasksAPI(): any {
    const tasksPlugin = (this.app as any).plugins.plugins['obsidian-tasks-plugin'];
    if (!tasksPlugin) {
      throw new Error('obsidian-tasks plugin is not installed or enabled');
    }
    return tasksPlugin.apiV1;
  }

  /**
   * Check if obsidian-tasks plugin is available
   */
  isTasksPluginAvailable(): boolean {
    try {
      this.getTasksAPI();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search for tasks using obsidian-tasks query
   */
  async searchTasks(query: string): Promise<any[]> {
    const api = this.getTasksAPI();
    return await api.search(query);
  }

  /**
   * Get or generate task ID for a task
   * Returns existing ID if present, generates new one if not
   */
  async ensureTaskId(task: any, existingIds: Set<string>): Promise<string> {
    // Check if task already has an ID
    if (task.id && task.id.trim() !== '') {
      return task.id;
    }

    // Generate new ID
    const newId = TaskIdGenerator.generate(existingIds);

    // Inject ID into task
    await this.injectTaskId(task, newId);

    return newId;
  }

  /**
   * Inject task ID into task markdown
   */
  private async injectTaskId(task: any, taskId: string): Promise<void> {
    // Get the file containing the task
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${task.path}`);
    }

    // Read file content
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    // Find the task line (task.lineNumber is 0-indexed)
    const lineIndex = task.lineNumber;
    if (lineIndex >= lines.length) {
      throw new Error(`Line number ${lineIndex} out of range in file ${task.path}`);
    }

    const taskLine = lines[lineIndex];

    // Add ID emoji to the end of the task
    // Format: - [ ] Task description 🆔 20250105-a4f
    const idEmoji = '🆔';
    const newLine = `${taskLine} ${idEmoji} ${taskId}`;

    lines[lineIndex] = newLine;

    // Write back to file
    const newContent = lines.join('\n');
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Update task in vault
   */
  async updateTask(task: any, updates: {
    status?: 'TODO' | 'COMPLETED';
    dueDate?: string;
    scheduledDate?: string;
    completedDate?: string;
  }): Promise<void> {
    // Get the file containing the task
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${task.path}`);
    }

    // Read file content
    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    const lineIndex = task.lineNumber;
    if (lineIndex >= lines.length) {
      throw new Error(`Line number ${lineIndex} out of range in file ${task.path}`);
    }

    let taskLine = lines[lineIndex];

    // Update status (checkbox)
    if (updates.status) {
      if (updates.status === 'COMPLETED') {
        taskLine = taskLine.replace(/- \[ \]/, '- [x]');
      } else {
        taskLine = taskLine.replace(/- \[x\]/, '- [ ]');
      }
    }

    // Update dates (using emoji format)
    // This is a simplified approach - in production, you'd want to preserve
    // existing metadata and only update specific fields

    // Remove existing date metadata
    taskLine = this.removeDateMetadata(taskLine);

    // Add new metadata
    if (updates.dueDate) {
      taskLine += ` 📅 ${updates.dueDate}`;
    }
    if (updates.scheduledDate) {
      taskLine += ` ⏳ ${updates.scheduledDate}`;
    }
    if (updates.completedDate && updates.status === 'COMPLETED') {
      taskLine += ` ✅ ${updates.completedDate}`;
    }

    lines[lineIndex] = taskLine;

    // Write back to file
    const newContent = lines.join('\n');
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Create new task in destination file
   */
  async createTask(
    destinationPath: string,
    taskData: {
      description: string;
      status: 'TODO' | 'COMPLETED';
      dueDate?: string;
      scheduledDate?: string;
      completedDate?: string;
      taskId: string;
    },
    section?: string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(destinationPath);

    let content: string;
    if (file instanceof TFile) {
      content = await this.app.vault.read(file);
    } else {
      // Create file if it doesn't exist
      content = '';
    }

    // Build task line
    const checkbox = taskData.status === 'COMPLETED' ? '[x]' : '[ ]';
    let taskLine = `- ${checkbox} ${taskData.description}`;

    if (taskData.dueDate) {
      taskLine += ` 📅 ${taskData.dueDate}`;
    }
    if (taskData.scheduledDate) {
      taskLine += ` ⏳ ${taskData.scheduledDate}`;
    }
    if (taskData.completedDate && taskData.status === 'COMPLETED') {
      taskLine += ` ✅ ${taskData.completedDate}`;
    }
    taskLine += ` 🆔 ${taskData.taskId}`;

    // Insert task
    let newContent: string;
    if (section) {
      // Find section and append task
      const lines = content.split('\n');
      const sectionIndex = lines.findIndex(line => line.trim() === section);

      if (sectionIndex >= 0) {
        lines.splice(sectionIndex + 1, 0, taskLine);
        newContent = lines.join('\n');
      } else {
        // Section not found, append to end with section header
        newContent = content + `\n\n${section}\n${taskLine}`;
      }
    } else {
      // Append to end of file
      newContent = content + (content ? '\n' : '') + taskLine;
    }

    if (file instanceof TFile) {
      await this.app.vault.modify(file, newContent);
    } else {
      await this.app.vault.create(destinationPath, newContent);
    }
  }

  private removeDateMetadata(line: string): string {
    // Remove emoji date metadata
    return line
      .replace(/📅 \d{4}-\d{2}-\d{2}/g, '')
      .replace(/⏳ \d{4}-\d{2}-\d{2}/g, '')
      .replace(/✅ \d{4}-\d{2}-\d{2}/g, '')
      .replace(/🛫 \d{4}-\d{2}-\d{2}/g, '')
      .trim();
  }
}
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/tasks/taskManager.ts
git commit -m "feat: add task manager for obsidian-tasks integration

- Query tasks using obsidian-tasks API
- Inject/retrieve task IDs
- Update task metadata
- Create new tasks in destination file"
```

---

## Task 6: Main Plugin Setup

**Files:**
- Modify: `main.ts`

**Step 1: Replace sample plugin code with CalDAV plugin skeleton**

Update `main.ts`:

```typescript
import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from './src/types';
import { SyncStorage } from './src/storage/syncStorage';
import { TaskManager } from './src/tasks/taskManager';
import { CalDAVClient } from './src/caldav/calDAVClient';

export default class CalDAVSyncPlugin extends Plugin {
  settings: CalDAVSettings;
  private syncStorage: SyncStorage;
  private taskManager: TaskManager;
  private syncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize managers
    this.syncStorage = new SyncStorage(this.app);
    this.taskManager = new TaskManager(this.app);

    // Initialize sync storage
    await this.syncStorage.initialize();

    // Add ribbon icon for manual sync
    this.addRibbonIcon('sync', 'CalDAV Sync', async () => {
      await this.manualSync();
    });

    // Add commands
    this.addCommand({
      id: 'caldav-sync-now',
      name: 'Sync now',
      callback: async () => {
        await this.manualSync();
      }
    });

    this.addCommand({
      id: 'caldav-view-status',
      name: 'View sync status',
      callback: () => {
        this.showSyncStatus();
      }
    });

    // Add settings tab
    this.addSettingTab(new CalDAVSettingTab(this.app, this));

    // Start automatic sync if configured
    this.startAutoSync();

    console.log('CalDAV Sync plugin loaded');
  }

  onunload() {
    this.stopAutoSync();
    console.log('CalDAV Sync plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_CALDAV_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private startAutoSync() {
    if (this.settings.syncInterval > 0) {
      const intervalMs = this.settings.syncInterval * 60 * 1000;
      this.syncIntervalId = window.setInterval(async () => {
        await this.performSync();
      }, intervalMs);
      this.registerInterval(this.syncIntervalId);
    }
  }

  private stopAutoSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  async restartAutoSync() {
    this.stopAutoSync();
    this.startAutoSync();
  }

  private async manualSync() {
    new Notice('Starting CalDAV sync...');
    await this.performSync();
  }

  private async performSync() {
    try {
      // Check if obsidian-tasks is available
      if (!this.taskManager.isTasksPluginAvailable()) {
        new Notice('Error: obsidian-tasks plugin is not installed or enabled');
        return;
      }

      // TODO: Implement actual sync logic in next task
      console.log('Sync would happen here');
      new Notice('Sync complete');

    } catch (error) {
      console.error('Sync failed:', error);
      new Notice(`Sync failed: ${error.message}`);
    }
  }

  private async showSyncStatus() {
    const state = await this.syncStorage.loadState();
    const mapping = await this.syncStorage.loadMapping();

    const taskCount = Object.keys(mapping.tasks).length;
    const conflictCount = state.conflicts.length;

    new Notice(
      `Last sync: ${new Date(state.lastSyncTime).toLocaleString()}\n` +
      `Tasks tracked: ${taskCount}\n` +
      `Pending conflicts: ${conflictCount}`
    );
  }
}

class CalDAVSettingTab extends PluginSettingTab {
  plugin: CalDAVSyncPlugin;

  constructor(app: App, plugin: CalDAVSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'CalDAV Sync Settings' });

    // Connection settings
    containerEl.createEl('h3', { text: 'CalDAV Connection' });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('CalDAV server URL (e.g., https://nextcloud.example.com/remote.php/dav/)')
      .addText(text => text
        .setPlaceholder('https://example.com/dav/')
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async (value) => {
          this.plugin.settings.serverUrl = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Username')
      .addText(text => text
        .setPlaceholder('username')
        .setValue(this.plugin.settings.username)
        .onChange(async (value) => {
          this.plugin.settings.username = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Password')
      .addText(text => {
        text
          .setPlaceholder('password')
          .setValue(this.plugin.settings.password)
          .onChange(async (value) => {
            this.plugin.settings.password = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    new Setting(containerEl)
      .setName('Calendar Name')
      .setDesc('Name of the calendar/task list to sync')
      .addText(text => text
        .setPlaceholder('Tasks')
        .setValue(this.plugin.settings.calendarName)
        .onChange(async (value) => {
          this.plugin.settings.calendarName = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Verify CalDAV server connection')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          await this.testConnection();
        }));

    // Sync behavior
    containerEl.createEl('h3', { text: 'Sync Behavior' });

    new Setting(containerEl)
      .setName('Sync Query')
      .setDesc('obsidian-tasks query to select tasks for sync (e.g., "not done" or "tag includes #sync")')
      .addText(text => text
        .setPlaceholder('not done')
        .setValue(this.plugin.settings.syncQuery)
        .onChange(async (value) => {
          this.plugin.settings.syncQuery = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Interval')
      .setDesc('Auto-sync interval in minutes (0 = manual only)')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Manual only')
        .addOption('1', '1 minute')
        .addOption('5', '5 minutes')
        .addOption('15', '15 minutes')
        .addOption('30', '30 minutes')
        .addOption('60', '1 hour')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          this.plugin.settings.syncInterval = parseInt(value);
          await this.plugin.saveSettings();
          await this.plugin.restartAutoSync();
        }));

    new Setting(containerEl)
      .setName('New Tasks Destination')
      .setDesc('File where new CalDAV tasks will be added')
      .addText(text => text
        .setPlaceholder('Inbox.md')
        .setValue(this.plugin.settings.newTasksDestination)
        .onChange(async (value) => {
          this.plugin.settings.newTasksDestination = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('New Tasks Section')
      .setDesc('Section heading within destination file (optional)')
      .addText(text => text
        .setPlaceholder('## CalDAV Tasks')
        .setValue(this.plugin.settings.newTasksSection || '')
        .onChange(async (value) => {
          this.plugin.settings.newTasksSection = value || undefined;
          await this.plugin.saveSettings();
        }));

    // Conflict resolution
    containerEl.createEl('h3', { text: 'Conflict Resolution' });

    new Setting(containerEl)
      .setName('Require Manual Conflict Resolution')
      .setDesc('Show modal for conflicts (recommended)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.requireManualConflictResolution)
        .onChange(async (value) => {
          this.plugin.settings.requireManualConflictResolution = value;
          if (value) {
            this.plugin.settings.autoResolveObsidianWins = false;
          }
          await this.plugin.saveSettings();
          this.display(); // Refresh settings
        }));

    if (!this.plugin.settings.requireManualConflictResolution) {
      new Setting(containerEl)
        .setName('Auto-resolve (Obsidian Wins)')
        .setDesc('Automatically resolve conflicts by keeping Obsidian version')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.autoResolveObsidianWins)
          .onChange(async (value) => {
            this.plugin.settings.autoResolveObsidianWins = value;
            await this.plugin.saveSettings();
          }));
    }

    // Advanced
    containerEl.createEl('h3', { text: 'Advanced' });

    new Setting(containerEl)
      .setName('Sync Completed Tasks')
      .setDesc('Include completed tasks in sync')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncCompletedTasks)
        .onChange(async (value) => {
          this.plugin.settings.syncCompletedTasks = value;
          await this.plugin.saveSettings();
        }));
  }

  private async testConnection() {
    try {
      const client = new CalDAVClient({
        serverUrl: this.plugin.settings.serverUrl,
        username: this.plugin.settings.username,
        password: this.plugin.settings.password,
        calendarName: this.plugin.settings.calendarName
      });

      const success = await client.testConnection();

      if (success) {
        new Notice('✓ Connection successful!');
      } else {
        new Notice('✗ Connection failed - check settings');
      }
    } catch (error) {
      new Notice(`✗ Connection failed: ${error.message}`);
    }
  }
}
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add main.ts
git commit -m "feat: implement main plugin with settings UI

- Add ribbon icon and commands
- Create comprehensive settings tab
- Set up auto-sync interval
- Add connection test functionality"
```

---

## Task 7: Sync Engine Implementation

**Files:**
- Create: `src/sync/syncEngine.ts`

**Step 1: Create sync engine**

Create: `src/sync/syncEngine.ts`

```typescript
import { Notice } from 'obsidian';
import { CalDAVClient } from '../caldav/calDAVClient';
import { TaskManager } from '../tasks/taskManager';
import { SyncStorage } from '../storage/syncStorage';
import { CalDAVSettings, TaskMapping } from '../types';
import { TaskData } from '../caldav/vtodoMapper';

export class SyncEngine {
  private caldavClient: CalDAVClient;
  private taskManager: TaskManager;
  private storage: SyncStorage;
  private settings: CalDAVSettings;

  constructor(
    caldavClient: CalDAVClient,
    taskManager: TaskManager,
    storage: SyncStorage,
    settings: CalDAVSettings
  ) {
    this.caldavClient = caldavClient;
    this.taskManager = taskManager;
    this.storage = storage;
    this.settings = settings;
  }

  /**
   * Perform bidirectional sync
   */
  async sync(): Promise<void> {
    console.log('Starting sync...');

    // Connect to CalDAV
    await this.caldavClient.connect();

    // Phase A: Pull from CalDAV
    await this.pullFromCalDAV();

    // Phase B: Push to CalDAV
    await this.pushToCalDAV();

    // Update last sync time
    const state = await this.storage.loadState();
    state.lastSyncTime = new Date().toISOString();
    await this.storage.saveState(state);

    console.log('Sync complete');
  }

  /**
   * Phase A: Pull changes from CalDAV to Obsidian
   */
  private async pullFromCalDAV(): Promise<void> {
    console.log('Pulling from CalDAV...');

    const caldavTodos = await this.caldavClient.fetchAllTodos();
    const mapping = await this.storage.loadMapping();

    for (const todo of caldavTodos) {
      const existingTaskId = mapping.caldavToTask[todo.uid];

      if (existingTaskId) {
        // Known task - check if changed
        await this.updateObsidianTask(existingTaskId, todo);
      } else {
        // New CalDAV task
        await this.createObsidianTask(todo);
      }
    }
  }

  /**
   * Phase B: Push changes from Obsidian to CalDAV
   */
  private async pushToCalDAV(): Promise<void> {
    console.log('Pushing to CalDAV...');

    // Query tasks from obsidian-tasks
    const tasks = await this.taskManager.searchTasks(this.settings.syncQuery);
    const existingIds = await this.storage.getAllTaskIds();

    for (const task of tasks) {
      // Skip completed tasks if not configured to sync them
      if (!this.settings.syncCompletedTasks && task.status?.symbol === 'x') {
        continue;
      }

      // Ensure task has an ID
      const taskId = await this.taskManager.ensureTaskId(task, existingIds);
      existingIds.add(taskId);

      const taskMapping = await this.storage.getTaskMapping(taskId);

      if (taskMapping) {
        // Known task - check if changed
        await this.updateCalDAVTask(taskId, task, taskMapping);
      } else {
        // New Obsidian task
        await this.createCalDAVTask(taskId, task);
      }
    }
  }

  /**
   * Update Obsidian task from CalDAV
   */
  private async updateObsidianTask(
    taskId: string,
    caldavTodo: { uid: string; data: TaskData; etag: string }
  ): Promise<void> {
    const mapping = await this.storage.getTaskMapping(taskId);
    if (!mapping) return;

    // Simple timestamp comparison for now
    // In a real implementation, you'd parse the etag or last-modified header
    const caldavModified = new Date().toISOString(); // Placeholder

    // Check for conflict
    const hasObsidianChanges = mapping.lastModifiedObsidian > mapping.lastSyncedObsidian;
    const hasCalDAVChanges = caldavModified > mapping.lastSyncedCalDAV;

    if (hasObsidianChanges && hasCalDAVChanges) {
      // Conflict detected
      if (this.settings.requireManualConflictResolution) {
        await this.queueConflict(taskId, caldavTodo.data);
        return;
      } else if (this.settings.autoResolveObsidianWins) {
        // Skip CalDAV update - Obsidian wins
        return;
      }
    }

    if (hasCalDAVChanges) {
      // Update Obsidian task
      // Note: Finding the task to update requires re-querying
      // This is a simplified approach
      const tasks = await this.taskManager.searchTasks(`id includes ${taskId}`);
      if (tasks.length > 0) {
        const task = tasks[0];
        await this.taskManager.updateTask(task, {
          status: caldavTodo.data.status,
          dueDate: caldavTodo.data.dueDate,
          scheduledDate: caldavTodo.data.scheduledDate,
          completedDate: caldavTodo.data.completedDate
        });

        // Update mapping
        mapping.lastModifiedCalDAV = caldavModified;
        mapping.lastSyncedObsidian = new Date().toISOString();
        mapping.lastSyncedCalDAV = caldavModified;
        await this.storage.updateTaskMapping(taskId, mapping);
      }
    }
  }

  /**
   * Create new Obsidian task from CalDAV
   */
  private async createObsidianTask(
    caldavTodo: { uid: string; data: TaskData; etag: string }
  ): Promise<void> {
    const existingIds = await this.storage.getAllTaskIds();
    const taskId = await this.taskManager.ensureTaskId({}, existingIds);

    await this.taskManager.createTask(
      this.settings.newTasksDestination,
      {
        description: caldavTodo.data.description,
        status: caldavTodo.data.status,
        dueDate: caldavTodo.data.dueDate,
        scheduledDate: caldavTodo.data.scheduledDate,
        completedDate: caldavTodo.data.completedDate,
        taskId
      },
      this.settings.newTasksSection
    );

    // Create mapping
    const now = new Date().toISOString();
    const mapping: TaskMapping = {
      caldavUID: caldavTodo.uid,
      sourceFile: this.settings.newTasksDestination,
      lastSyncedObsidian: now,
      lastSyncedCalDAV: now,
      lastModifiedObsidian: now,
      lastModifiedCalDAV: now
    };
    await this.storage.updateTaskMapping(taskId, mapping);
  }

  /**
   * Update CalDAV task from Obsidian
   */
  private async updateCalDAVTask(
    taskId: string,
    task: any,
    mapping: TaskMapping
  ): Promise<void> {
    const obsidianModified = new Date().toISOString(); // Placeholder - should get from file mtime

    // Check for conflict
    const hasObsidianChanges = obsidianModified > mapping.lastSyncedObsidian;
    const hasCalDAVChanges = mapping.lastModifiedCalDAV > mapping.lastSyncedCalDAV;

    if (hasObsidianChanges && hasCalDAVChanges) {
      // Conflict detected
      if (this.settings.requireManualConflictResolution) {
        await this.queueConflict(taskId, this.taskToTaskData(task));
        return;
      } else if (this.settings.autoResolveObsidianWins) {
        // Proceed with Obsidian update
      } else {
        return;
      }
    }

    if (hasObsidianChanges) {
      // Update CalDAV
      const taskData = this.taskToTaskData(task);
      await this.caldavClient.updateTodo(mapping.caldavUID, taskData);

      // Update mapping
      mapping.lastModifiedObsidian = obsidianModified;
      mapping.lastSyncedObsidian = obsidianModified;
      mapping.lastSyncedCalDAV = new Date().toISOString();
      await this.storage.updateTaskMapping(taskId, mapping);
    }
  }

  /**
   * Create new CalDAV task from Obsidian
   */
  private async createCalDAVTask(taskId: string, task: any): Promise<void> {
    const taskData = this.taskToTaskData(task);
    const caldavUID = await this.caldavClient.createTodo(taskData);

    // Create mapping
    const now = new Date().toISOString();
    const mapping: TaskMapping = {
      caldavUID,
      sourceFile: task.path,
      lastSyncedObsidian: now,
      lastSyncedCalDAV: now,
      lastModifiedObsidian: now,
      lastModifiedCalDAV: now
    };
    await this.storage.updateTaskMapping(taskId, mapping);
  }

  /**
   * Convert obsidian-tasks Task object to TaskData
   */
  private taskToTaskData(task: any): TaskData {
    return {
      description: task.description || '',
      status: task.status?.symbol === 'x' ? 'COMPLETED' : 'TODO',
      dueDate: task.dueDate ? this.formatDate(task.dueDate) : undefined,
      scheduledDate: task.scheduledDate ? this.formatDate(task.scheduledDate) : undefined,
      startDate: task.startDate ? this.formatDate(task.startDate) : undefined,
      completedDate: task.doneDate ? this.formatDate(task.doneDate) : undefined,
      priority: this.convertPriority(task.priority)
    };
  }

  private formatDate(date: any): string {
    // obsidian-tasks uses moment.js - extract format
    if (date && date.format) {
      return date.format('YYYY-MM-DD');
    }
    return date.toString();
  }

  private convertPriority(priority: any): number | undefined {
    // obsidian-tasks priority: High, Medium, Normal, Low
    if (!priority) return undefined;

    switch (priority) {
      case 'High': return 1;
      case 'Medium': return 5;
      case 'Low': return 9;
      default: return 5;
    }
  }

  /**
   * Queue conflict for manual resolution
   */
  private async queueConflict(taskId: string, taskData: TaskData): Promise<void> {
    const state = await this.storage.loadState();

    state.conflicts.push({
      taskId,
      detectedAt: new Date().toISOString(),
      obsidianVersion: JSON.stringify(taskData),
      caldavVersion: JSON.stringify(taskData) // Placeholder
    });

    await this.storage.saveState(state);

    new Notice(`Conflict detected for task ${taskId}`);
  }
}
```

**Step 2: Integrate sync engine into main plugin**

Update `main.ts` - replace the `performSync` method:

```typescript
private async performSync() {
  try {
    // Check if obsidian-tasks is available
    if (!this.taskManager.isTasksPluginAvailable()) {
      new Notice('Error: obsidian-tasks plugin is not installed or enabled');
      return;
    }

    // Create CalDAV client
    const caldavClient = new CalDAVClient({
      serverUrl: this.settings.serverUrl,
      username: this.settings.username,
      password: this.settings.password,
      calendarName: this.settings.calendarName
    });

    // Create sync engine
    const syncEngine = new SyncEngine(
      caldavClient,
      this.taskManager,
      this.syncStorage,
      this.settings
    );

    // Perform sync
    await syncEngine.sync();

    new Notice('Sync complete');

  } catch (error) {
    console.error('Sync failed:', error);
    new Notice(`Sync failed: ${error.message}`);
  }
}
```

Add import at top of `main.ts`:

```typescript
import { SyncEngine } from './src/sync/syncEngine';
```

**Step 3: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/sync/syncEngine.ts main.ts
git commit -m "feat: implement bidirectional sync engine

- Pull changes from CalDAV to Obsidian
- Push changes from Obsidian to CalDAV
- Detect and queue conflicts
- Update mappings and state"
```

---

## Task 8: Testing and Documentation

**Files:**
- Update: `README.md`
- Create: `docs/usage.md`

**Step 1: Update README with project info**

Replace the sample plugin README with actual documentation:

```markdown
# Obsidian Tasks CalDAV Sync

Bidirectional synchronization between Obsidian tasks (via the obsidian-tasks plugin) and CalDAV servers.

## Features

- 🔄 Bidirectional sync with CalDAV servers (Nextcloud, Radicale, Apple Reminders, etc.)
- 🔍 Query-based sync selection using obsidian-tasks query language
- 🆔 Automatic task ID generation with timestamp-based format
- ⚠️ Conflict detection with manual resolution
- ⏱️ Configurable auto-sync intervals
- 📥 New CalDAV tasks added to configurable destination file

## Requirements

- Obsidian v0.15.0+
- [obsidian-tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) installed and enabled

## Installation

### Manual Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/obsidian-tasks-caldav/`
3. Enable the plugin in Obsidian settings

### Building from Source

```bash
npm install
npm run build
```

## Configuration

1. Open Settings → CalDAV Sync
2. Configure CalDAV connection:
   - Server URL (e.g., `https://nextcloud.example.com/remote.php/dav/`)
   - Username and password
   - Calendar name
3. Configure sync behavior:
   - Sync query (e.g., `not done` or `tag includes #sync`)
   - Sync interval
   - Destination for new tasks
4. Test connection to verify settings

## Usage

### Manual Sync

- Click the sync ribbon icon
- Or use command: "CalDAV: Sync now"

### Auto Sync

Configure sync interval in settings. Set to 0 for manual-only mode.

### Conflict Resolution

When conflicts are detected (both Obsidian and CalDAV modified since last sync):
- Manual resolution modal shows both versions
- Choose: Keep Obsidian, Keep CalDAV, or Skip
- Optional: Enable auto-resolve (Obsidian wins) in settings

## Design

See [design document](docs/plans/2025-11-05-caldav-sync-design.md) for architecture details.

## Development

```bash
npm run dev    # Watch mode
npm run build  # Production build
```

## License

MIT
```

**Step 2: Create usage documentation**

Create: `docs/usage.md`

```markdown
# Usage Guide

## First-Time Setup

1. Install and enable the obsidian-tasks plugin
2. Install this plugin (CalDAV Sync)
3. Configure CalDAV connection in settings
4. Test connection
5. Configure sync query and destination
6. Perform first sync

## Sync Queries

The sync query uses obsidian-tasks query language. Examples:

- `not done` - All incomplete tasks
- `tag includes #sync` - Only tasks with #sync tag
- `due before tomorrow` - Tasks due today or earlier
- `path includes Projects/` - Tasks in Projects folder

## Task IDs

Tasks are identified using timestamp-based IDs: `YYYYMMDD-xxx`

- Automatically generated on first sync if task has no ID
- Existing IDs are preserved (supports interoperability)
- Format: `🆔 20250105-a4f` added to task line

## Metadata Sync

The following task properties sync bidirectionally:

| Obsidian | CalDAV |
|----------|--------|
| `- [ ]` / `- [x]` | STATUS |
| `📅 YYYY-MM-DD` (due) | DUE |
| `⏳ YYYY-MM-DD` (scheduled) | DTSTART |
| `✅ YYYY-MM-DD` (done) | COMPLETED |
| Priority emoji | PRIORITY |

## Troubleshooting

### Sync fails with connection error

- Verify server URL is correct
- Check username/password
- Ensure calendar name exists
- Test connection in settings

### obsidian-tasks plugin not found

- Install and enable obsidian-tasks plugin
- Reload Obsidian

### Tasks not syncing

- Check sync query matches your tasks
- Verify tasks are in markdown format
- Check sync status for conflicts

### Conflicts not resolving

- View sync status to see pending conflicts
- Use "CalDAV: View sync status" command
- Resolve conflicts manually or enable auto-resolve
```

**Step 3: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add README.md docs/usage.md
git commit -m "docs: add comprehensive README and usage guide

- Update README with project information
- Add usage guide with examples
- Document sync queries and troubleshooting"
```

---

## Task 9: Final Testing and Polish

**Files:**
- Create: `.gitignore` update
- Verify: All components

**Step 1: Update .gitignore for sync data**

The `.caldav-sync/` directory should NOT be in git (contains user-specific mapping data).

Add to `.gitignore`:

```
# CalDAV sync data (user-specific)
.caldav-sync/
```

**Step 2: Manual testing checklist**

Test the following scenarios:

1. **Installation**
   - [ ] Plugin loads without errors
   - [ ] Settings tab appears
   - [ ] Ribbon icon appears

2. **Connection**
   - [ ] Test connection succeeds with valid credentials
   - [ ] Test connection fails with invalid credentials

3. **First Sync**
   - [ ] Creates `.caldav-sync/` directory
   - [ ] Generates task IDs for tasks without IDs
   - [ ] Preserves existing task IDs
   - [ ] Creates tasks in CalDAV

4. **Bidirectional Sync**
   - [ ] Obsidian → CalDAV updates work
   - [ ] CalDAV → Obsidian updates work
   - [ ] New CalDAV tasks appear in destination file

5. **Conflict Handling**
   - [ ] Conflicts detected correctly
   - [ ] Manual resolution modal appears (if enabled)
   - [ ] Auto-resolve works (if enabled)

**Step 3: Build production version**

Run: `npm run build`

Verify output:
- `main.js` created
- No TypeScript errors
- File size reasonable

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore for sync data

Exclude .caldav-sync/ directory from version control"
```

---

## Completion

All tasks complete! The CalDAV sync plugin is now functional with:

✅ Project setup and dependencies
✅ Task ID generator
✅ Sync storage (mapping/state)
✅ CalDAV client wrapper
✅ Task manager (obsidian-tasks integration)
✅ Main plugin with settings UI
✅ Bidirectional sync engine
✅ Documentation

### Next Steps

1. Manual testing in real Obsidian vault
2. Create GitHub release with `main.js`, `manifest.json`, `styles.css`
3. Consider future enhancements:
   - Multiple CalDAV accounts
   - OAuth authentication
   - Tag/category sync
   - Recurrence rule support

### Known Limitations (v0.1.0)

- Recurrence rules not synced (TODO in VTODO mapper)
- File modification times use placeholders (should use actual mtime)
- No conflict resolution UI modal (queues conflicts but doesn't show modal)
- Limited error handling for network issues

These can be addressed in future releases based on user feedback.
