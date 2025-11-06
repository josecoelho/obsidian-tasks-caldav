# Obsidian-Tasks API Findings

**Date:** 2025-11-06
**Source:** https://github.com/obsidian-tasks-group/obsidian-tasks

## API v1 Interface (Public)

The obsidian-tasks plugin exposes a minimal public API via `apiV1`:

```typescript
interface TasksApiV1 {
    createTaskLineModal(): Promise<string>;
    editTaskLineModal(taskLine: string): Promise<string>;
    executeToggleTaskDoneCommand: (line: string, path: string) => string;
}
```

### Available Methods

1. **createTaskLineModal()**
   - Opens the Tasks UI for creating a new task
   - Returns the markdown string of the created task
   - Returns empty string if cancelled

2. **editTaskLineModal(taskLine: string)**
   - Opens the Tasks UI pre-filled with an existing task for editing
   - Does NOT edit the file directly
   - Returns the edited markdown string
   - Returns empty string if cancelled

3. **executeToggleTaskDoneCommand(line: string, path: string)**
   - Toggles task completion status
   - Returns updated line (may be two lines for recurring tasks)
   - Requires the file path

## Internal Cache Access (Undocumented but Available)

**IMPORTANT:** obsidian-tasks maintains an internal cache of ALL parsed tasks!

### Accessing the Task Cache

```typescript
const tasksPlugin = app.plugins.plugins['obsidian-tasks-plugin'];

// Check if plugin is loaded and has cache
if (tasksPlugin && typeof tasksPlugin.getTasks === 'function') {
    const allTasks: Task[] = tasksPlugin.getTasks();
    // Now we have all tasks parsed by obsidian-tasks!
}
```

### Task Object Structure

Each Task object has these properties:

```typescript
interface Task {
    // Core properties
    status: Status;              // Task status (respects custom statuses)
    description: string;         // Task text
    tags: string[];             // Hashtags
    priority: Priority;         // Priority (respects emoji config)

    // Dates (using Moment.js)
    createdDate: Moment | null;
    startDate: Moment | null;
    scheduledDate: Moment | null;
    dueDate: Moment | null;
    doneDate: Moment | null;
    cancelledDate: Moment | null;

    // Recurrence & dependencies
    recurrence: Recurrence | null;
    onCompletion: OnCompletion;
    dependsOn: string[];
    id: string;

    // Location in vault
    taskLocation: TaskLocation;  // { path: string, lineNumber: number }
    originalMarkdown: string;    // Full markdown line

    // Formatting
    indentation: string;
    listMarker: string;
    blockLink: string;
    heading: string | null;      // Preceding header

    // Computed
    isDone: boolean;
    isRecurring: boolean;
    urgency: number;
    happens: TasksDate;          // Earliest relevant date
}
```

## Why This Matters

**Using `getTasks()` respects obsidian-tasks configuration:**
- ✅ Custom task statuses (not just `[ ]` and `[x]`)
- ✅ Custom emoji priorities
- ✅ Custom date formats
- ✅ Recurrence rules
- ✅ Task dependencies
- ✅ All other obsidian-tasks extensions

**If we parsed markdown ourselves, we would:**
- ❌ Only support basic `- [ ]` format
- ❌ Miss custom statuses
- ❌ Not understand priority emojis
- ❌ Not parse dates correctly
- ❌ Duplicate their parsing work

## Recommended Approach for CalDAV Sync

### Option 1: Require obsidian-tasks (Recommended)

Make obsidian-tasks a **required dependency**:

```typescript
async onload() {
    // Check if obsidian-tasks is installed
    const tasksPlugin = this.app.plugins.plugins['obsidian-tasks-plugin'];
    if (!tasksPlugin) {
        new Notice('CalDAV Sync requires the obsidian-tasks plugin to be installed');
        return;
    }

    // Use their cache
    const allTasks = tasksPlugin.getTasks();
    const tasksToSync = this.filterTasksForSync(allTasks);
}
```

**Pros:**
- Respects all obsidian-tasks configuration
- No duplicate parsing logic
- Users already have obsidian-tasks if they want task sync
- More reliable

**Cons:**
- Adds a dependency
- Plugin won't work without obsidian-tasks

### Option 2: Fallback to Basic Parsing

Support both obsidian-tasks and basic parsing:

```typescript
async getTasks(): Promise<Task[]> {
    const tasksPlugin = this.app.plugins.plugins['obsidian-tasks-plugin'];

    if (tasksPlugin && typeof tasksPlugin.getTasks === 'function') {
        // Use obsidian-tasks cache (respects config)
        return tasksPlugin.getTasks();
    } else {
        // Fall back to basic markdown parsing
        return this.parseTasksManually();
    }
}
```

**Pros:**
- Works without obsidian-tasks
- Best of both worlds

**Cons:**
- More complex
- Manual parsing won't support advanced features
- Need to maintain two code paths

## Final Recommendation

**Use Option 1: Require obsidian-tasks**

Reasoning:
- Users wanting CalDAV sync for tasks already have obsidian-tasks installed
- We get full feature support for free
- Less code to maintain
- More reliable sync (respects all task configurations)

## Implementation

```typescript
// In main.ts
import { Task } from 'obsidian-tasks'; // If we add as dependency

interface ObsidianTasksPlugin {
    getTasks(): Task[];
    apiV1?: TasksApiV1;
}

class CalDAVSyncPlugin extends Plugin {
    private tasksPlugin: ObsidianTasksPlugin | null = null;

    async onload() {
        // Verify obsidian-tasks is available
        this.tasksPlugin = this.app.plugins.plugins['obsidian-tasks-plugin'] as ObsidianTasksPlugin;

        if (!this.tasksPlugin || typeof this.tasksPlugin.getTasks !== 'function') {
            new Notice('⚠️ CalDAV Sync requires the obsidian-tasks plugin.\nPlease install and enable it first.');
            return;
        }

        // Continue with plugin initialization
    }

    async syncTasks() {
        if (!this.tasksPlugin) return;

        // Get all tasks from obsidian-tasks cache
        const allTasks = this.tasksPlugin.getTasks();

        // Filter based on sync query
        const tasksToSync = this.filterTasks(allTasks, this.settings.syncQuery);

        // Sync with CalDAV
        await this.syncWithCalDAV(tasksToSync);
    }
}
```

## Notes

- The `getTasks()` method is **undocumented** but exists in the plugin source
- It may change in future versions of obsidian-tasks
- Consider using TypeScript `any` type for the plugin access to avoid compilation issues
- Monitor obsidian-tasks releases for API changes
