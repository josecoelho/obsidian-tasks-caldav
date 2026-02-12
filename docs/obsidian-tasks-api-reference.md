# Obsidian-Tasks API Reference

**Date:** 2025-11-06
**Source:** https://github.com/obsidian-tasks-group/obsidian-tasks
**Decision:** See [ADR-002](adr/002-require-obsidian-tasks.md) and [ADR-003](adr/003-use-gettasks-cache.md)

## Public API v1

```typescript
interface TasksApiV1 {
    createTaskLineModal(): Promise<string>;
    editTaskLineModal(taskLine: string): Promise<string>;
    executeToggleTaskDoneCommand: (line: string, path: string) => string;
}
```

No search or list capability in the public API.

## Internal Cache Access

```typescript
const tasksPlugin = app.plugins.plugins['obsidian-tasks-plugin'];
if (tasksPlugin && typeof tasksPlugin.getTasks === 'function') {
    const allTasks: Task[] = tasksPlugin.getTasks();
}
```

**Warning:** `getTasks()` is undocumented. Monitor obsidian-tasks releases for changes.

## Task Object Structure

```typescript
interface Task {
    // Core
    status: Status;
    description: string;
    tags: string[];
    priority: Priority;

    // Dates (Moment.js)
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

    // Location
    taskLocation: TaskLocation;  // { path, lineNumber }
    originalMarkdown: string;

    // Formatting
    indentation: string;
    listMarker: string;
    blockLink: string;
    heading: string | null;

    // Computed
    isDone: boolean;
    isRecurring: boolean;
    urgency: number;
    happens: TasksDate;
}
```
