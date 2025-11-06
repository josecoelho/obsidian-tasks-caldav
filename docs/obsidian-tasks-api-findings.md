# Obsidian-Tasks API Findings

**Date:** 2025-11-06
**Source:** https://github.com/obsidian-tasks-group/obsidian-tasks

## API v1 Interface

The obsidian-tasks plugin exposes a minimal API via `apiV1`:

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

### Accessing the API

```typescript
const tasksPlugin = app.plugins.plugins['obsidian-tasks-plugin'];
const api = tasksPlugin?.apiV1;

if (api) {
    // API is available
    const newTask = await api.createTaskLineModal();
}
```

## Key Finding: No Search/Query API

**Important:** The obsidian-tasks API does **NOT** expose any search or query functionality programmatically.

### What This Means for Our Plugin

Our original design assumed we could use `apiV1.search()` or similar to query tasks matching a sync query. This is **not possible**.

### Alternative Approaches

1. **Direct Markdown Parsing** (Recommended)
   - Parse markdown files ourselves to find tasks
   - Use regex to match task format: `- [ ] Task text`
   - Implement our own filtering based on sync query
   - Pros: Full control, no dependency on obsidian-tasks being installed
   - Cons: Need to implement task parsing ourselves

2. **Use obsidian-tasks Data** (If Available)
   - Look for internal data structures in obsidian-tasks plugin
   - Access cached task data if exposed
   - Pros: Leverage their parsing work
   - Cons: Relies on internal implementation details, may break

3. **Hybrid Approach**
   - Use obsidian-tasks modals for UI (createTaskLineModal, editTaskLineModal)
   - Parse markdown ourselves for searching/syncing
   - Pros: Best UX + reliability
   - Cons: More implementation work

## Recommendation

**Use Direct Markdown Parsing**

For our CalDAV sync plugin:
- Parse markdown files in vault to find tasks
- Implement task matching logic ourselves
- Use obsidian-tasks API only for:
  - Creating tasks via UI (optional, nice-to-have)
  - Editing tasks via UI (optional, nice-to-have)
  - Toggling task completion (if we want to respect recurring task logic)

This approach:
- Works whether obsidian-tasks is installed or not
- Gives us full control over sync logic
- More reliable long-term

## Implementation Impact

Need to create a `TaskParser` class that:
- Scans vault files for tasks
- Matches task format: `- [ ] Task text`
- Extracts task properties (description, status, dates, tags, priority)
- Filters tasks based on sync query (initially simple, can enhance later)

This replaces the original `TaskManager` that was going to use obsidian-tasks API for querying.
