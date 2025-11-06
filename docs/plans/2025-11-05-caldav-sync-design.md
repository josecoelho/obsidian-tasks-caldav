# CalDAV Task Synchronization Design

**Date:** 2025-11-05
**Status:** Approved
**Version:** 1.0

## Overview

This document describes the design for bidirectional synchronization between Obsidian tasks (using the obsidian-tasks plugin) and CalDAV servers. The plugin enables users to sync their markdown tasks with CalDAV-compatible services (Nextcloud, Radicale, Apple Reminders, etc.).

## Goals

- **Bidirectional sync**: Changes in Obsidian or CalDAV propagate to the other side
- **Query-based selection**: Use obsidian-tasks query language to select which tasks to sync
- **Obsidian as source of truth**: Default conflict resolution favors Obsidian
- **API-driven**: Rely on obsidian-tasks API for all task parsing/formatting
- **Safe and transparent**: Manual conflict resolution by default, clear user feedback

## Non-Goals (Future Enhancements)

- Multiple CalDAV accounts (v1 supports single account only)
- OAuth authentication (v1 uses username/password)
- Tag/category synchronization
- Subtask/checklist synchronization
- Attachment support

## Architecture

### Core Components

The plugin consists of four main components:

```
┌─────────────────┐
│   Sync Engine   │  Central coordinator, runs on interval
└────────┬────────┘
         │
    ┌────┴────┬──────────────┬──────────────┐
    │         │              │              │
┌───▼────┐ ┌─▼──────────┐ ┌─▼─────────┐ ┌─▼─────────────┐
│  Task  │ │   CalDAV   │ │ Conflict  │ │ Mapping/State │
│Manager │ │   Client   │ │ Resolver  │ │   Storage     │
└────────┘ └────────────┘ └───────────┘ └───────────────┘
```

#### 1. Sync Engine
- Orchestrates bidirectional sync workflow (pull-first strategy)
- Runs on configurable interval (default: 5 minutes)
- Manages `.caldav-sync/` directory with sync state

#### 2. Task Manager
- Integrates with obsidian-tasks API: `app.plugins.plugins['obsidian-tasks-plugin'].apiV1`
- Executes user-configured query to find syncable tasks
- Auto-generates timestamp-based IDs for tasks without IDs
- Uses Task object properties (no manual emoji parsing)

#### 3. CalDAV Client
- Uses **tsdav** library for CalDAV operations
- Handles VTODO CRUD operations
- Maps Task object properties ↔ VTODO properties

#### 4. Conflict Resolver
- Detects conflicts via timestamp comparison
- Shows resolution modal (default behavior)
- Optional auto-resolve (Obsidian-wins) for advanced users

### Data Storage

#### Mapping File: `.caldav-sync/mapping.json`

```json
{
  "tasks": {
    "20250105-a4f": {
      "caldavUID": "unique-caldav-uid-12345",
      "sourceFile": "Projects/Work.md",
      "lastSyncedObsidian": "2025-01-05T14:30:00Z",
      "lastSyncedCalDAV": "2025-01-05T14:30:00Z",
      "lastModifiedObsidian": "2025-01-05T14:35:00Z",
      "lastModifiedCalDAV": "2025-01-05T14:30:00Z"
    }
  },
  "caldavToTask": {
    "unique-caldav-uid-12345": "20250105-a4f"
  }
}
```

Bidirectional index enables fast lookups in both directions.

#### State File: `.caldav-sync/state.json`

```json
{
  "lastSyncTime": "2025-01-05T14:30:00Z",
  "conflicts": [
    {
      "taskId": "20250105-a4f",
      "detectedAt": "2025-01-05T14:35:00Z",
      "obsidianVersion": "...",
      "caldavVersion": "..."
    }
  ]
}
```

## Task Identification

### ID Format: Timestamp-based

Tasks are identified using timestamp-based IDs: `YYYYMMDD-xxx`

**Format:** `20250105-a4f` (12 characters)
- `YYYYMMDD`: Creation date
- `-`: Separator
- `xxx`: 3-character random suffix (lowercase alphanumeric)

**Benefits:**
- Human-readable and self-documenting
- Short (12 chars vs 36 for UUID)
- Collision-resistant (random suffix handles same-second creation)
- Sort-friendly (chronological ordering)

### ID Generation Rules

**Critical constraint:** Never generate IDs if tasks already have them.

1. Query task for existing `🆔` field via obsidian-tasks API
2. **If has ID**: Use it as-is, add to mapping file
3. **If no ID**: Generate timestamp-based ID, inject into task markdown
4. **Never overwrite**: Existing IDs are sacred (supports interop with other tools)

Before generating, verify uniqueness against `mapping.json` to prevent collisions.

## Sync Algorithm

### Bidirectional Sync Workflow

**Pull-first strategy** ensures remote changes are never lost.

#### Phase A: Pull from CalDAV

1. Fetch all VTODOs from CalDAV server
2. For each VTODO:
   - **Known task** (UID in mapping):
     - Compare `lastModifiedCalDAV` with VTODO's `LAST-MODIFIED`
     - If changed: Update Obsidian task, update mapping timestamps
   - **New CalDAV task**:
     - Generate timestamp ID
     - Append task to configured destination note
     - Add to mapping

#### Phase B: Push to CalDAV

1. Execute obsidian-tasks query to find syncable tasks
2. For each task:
   - Check for existing ID → generate if missing
   - Look up in mapping by task ID
   - **Known task** (ID in mapping):
     - Compare `lastModifiedObsidian` timestamp
     - If changed: Update VTODO, push to CalDAV
   - **New Obsidian task**:
     - Create VTODO, push to CalDAV
     - Store returned UID in mapping

#### Phase C: Conflict Detection

**Conflict condition:** Both `lastModifiedObsidian` AND `lastModifiedCalDAV` changed since `lastSyncedObsidian`

**Default behavior (v1):** Queue conflict, show resolution modal
- Display: Task description, Obsidian version, CalDAV version, timestamps
- User chooses: Keep Obsidian, Keep CalDAV, Skip (resolve later)
- Unresolved conflicts stored in `state.json`

**Optional setting:** "Auto-resolve conflicts (Obsidian wins)"
- Advanced users can opt-in to silent resolution
- Requires explicit checkbox in settings

**Important:** Sync continues for non-conflicted tasks

#### Phase D: Cleanup

Detect deleted tasks (in mapping but not in query results or CalDAV)

**Configurable deletion behavior:**
- Ask (default): Prompt user
- Delete from CalDAV
- Delete from Obsidian
- Keep both (orphan)

## Metadata Mapping

### API-Driven Approach

**Core principle:** Let obsidian-tasks handle all parsing. Use Task object properties directly.

```typescript
const tasksApi = app.plugins.plugins['obsidian-tasks-plugin'].apiV1;
const tasks = await tasksApi.search(userQuery);

// Task object → VTODO mapping:
task.description       // → SUMMARY
task.dueDate          // → DUE
task.scheduledDate    // → DTSTART
task.startDate        // → DTSTART (fallback if no scheduled)
task.completedDate    // → COMPLETED
task.recurrence       // → RRULE
task.status           // → STATUS (NEEDS-ACTION/COMPLETED)
task.priority         // → PRIORITY
task.id               // → Used for mapping (not in VTODO)
```

### Writing Updates Back to Obsidian

Two approaches:

1. **Programmatic rebuild**:
   - Get task's source file and line number from Task object
   - Reconstruct task markdown using obsidian-tasks format
   - Use Obsidian Vault API to replace line in file

2. **API-based** (if available):
   - Use `editTaskLineModal()` for interactive editing
   - Requires user interaction, not suitable for automated sync

**Chosen approach:** Programmatic rebuild for automated sync

## User Interface

### Settings Configuration

#### CalDAV Connection
- Server URL (e.g., `https://nextcloud.example.com/remote.php/dav/`)
- Username
- Password (stored in Obsidian secure storage)
- Calendar/Task List name
- Button: "Test connection"

#### Sync Behavior
- **Sync query**: Text input for obsidian-tasks query string
  - Default: `not done`
  - Example: `tag includes #caldav-sync`
- **Sync interval**: Dropdown (1min, 5min, 15min, 30min, 1hr, Manual only)
  - Default: 5 minutes
- **New CalDAV tasks destination**: File picker
  - Default: `Inbox.md`
  - Optional section: Text input (e.g., `## CalDAV Tasks`)

#### Conflict Resolution
- ☑️ Require manual conflict resolution (default: checked)
- ☐ Auto-resolve conflicts (Obsidian wins)

#### Advanced
- ☐ Sync completed tasks (default: unchecked)
- Delete behavior: Dropdown (Ask, Delete from CalDAV, Delete from Obsidian, Keep both)

### Commands

**Command Palette:**
- "CalDAV: Sync now"
- "CalDAV: Open settings"
- "CalDAV: View sync status"
- "CalDAV: Resolve conflicts"
- "CalDAV: Clear sync state"

### Visual Elements

**Ribbon Icon:**
- CalDAV sync icon in left ribbon
- Click → Manual sync (shows progress notification)
- Right-click → Quick settings menu

**Status Bar:**
- Last sync time on hover
- Spinner during active sync
- Warning indicator if conflicts pending

**Settings Tab:**
- All configuration options
- Sync history/log viewer
- Test connection button
- Reset sync state button (with confirmation)

## Error Handling

### Network Failures
- CalDAV unreachable → Retry with exponential backoff (3 attempts)
- Skip sync cycle, notify user: "CalDAV sync failed, will retry in [interval]"
- Log errors to console for debugging

### Authentication Issues
- Invalid credentials → Disable auto-sync, show error in settings
- Future: OAuth expiration → Trigger re-auth flow

### Task Parsing Issues
- obsidian-tasks not installed → Disable plugin, show error
- API version mismatch → Warn user, attempt compatibility
- Malformed CalDAV data → Log warning, skip task, continue sync

### File Modification Conflicts
- Task file deleted → Remove from mapping, optionally delete from CalDAV
- Task moved → Track by ID (not location), update mapping
- Duplicate IDs → Error modal, require user resolution

### State Corruption
- `mapping.json` corrupted → Backup old file, recreate with warning
- `state.json` corrupted → Reset state, warn about potential conflicts

## Security & Privacy

### Credential Storage
- Password stored using Obsidian secure storage API
- Never log credentials in console/error messages
- Settings export excludes password

### Data Privacy
- Direct Obsidian ↔ CalDAV sync (no third-party servers)
- Mapping/state files stored locally in `.caldav-sync/`
- Auto-add to `.gitignore` if git repo detected

### SSL/TLS
- Enforce HTTPS (warn on HTTP)
- Validate SSL certificates
- Advanced option: Allow self-signed certs

### Vault Modifications
- Only modify tasks matched by user's query
- Never modify tasks outside sync scope
- Backup task line before modification (enable undo)

## Testing Strategy

### Unit Tests
- ID generation (uniqueness, format)
- Task ↔ VTODO mapping logic
- Conflict detection algorithm
- State management (mapping.json, state.json)

### Integration Tests
- Mock obsidian-tasks API responses
- Mock CalDAV server (test fixtures)
- Full sync cycle scenarios

### Manual Testing Scenarios
- First-time setup with empty vault
- Sync with existing CalDAV tasks
- Conflict resolution flows
- Network failure recovery
- obsidian-tasks plugin disabled mid-sync

## Dependencies

### Required
- **obsidian-tasks plugin**: Must be installed and enabled
- **tsdav**: CalDAV client library (npm package)

### Optional
- Git (for auto-.gitignore setup)

## Implementation Phases

### Phase 1: Core Sync (v1.0)
- Single CalDAV account support
- Username/password authentication
- Basic bidirectional sync
- Manual conflict resolution
- Query-based task selection

### Phase 2: Future Enhancements
- Multiple CalDAV accounts/calendars
- OAuth authentication
- Tag/category sync
- Subtask synchronization
- Sync statistics dashboard
- Export/import configuration

## Open Questions

None - design approved.

## Appendix

### CalDAV Libraries Evaluated

1. **tsdav** (chosen)
   - TypeScript-first, modern
   - Browser + Node.js support
   - Active maintenance
   - OAuth helpers built-in

2. **ts-caldav**
   - Lightweight, promise-based
   - Good sync change detection

3. **dav**
   - Older, widely used
   - Less TypeScript-friendly

### obsidian-tasks API Resources

- API Documentation: https://publish.obsidian.md/tasks/Advanced/Tasks+Api
- Task Properties: https://publish.obsidian.md/tasks/Scripting/Task+Properties
- GitHub: https://github.com/obsidian-tasks-group/obsidian-tasks
