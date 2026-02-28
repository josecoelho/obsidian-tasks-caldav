# Recurring task completion design

**Issue:** [#40](https://github.com/josecoelho/obsidian-tasks-caldav/issues/40)
**Date:** 2026-02-28

## Problem

When a recurring task is completed on a CalDAV client, the sync overwrites the Obsidian task in-place, losing the recurrence chain. obsidian-tasks has special completion behavior that generates the next occurrence, but we bypass it entirely.

## Design decisions

1. **New recurrence = new task.** Completed instance is done. New occurrence is an independent task.
2. **Both directions.** CalDAV-to-Obsidian and Obsidian-to-CalDAV.
3. **UID transfers to the active task.** When a recurring completion is detected from CalDAV, the CalDAV UID mapping moves from the completed task to the new occurrence, preventing duplication.
4. **Completed instance stays in Obsidian only.** Not synced back to CalDAV as a separate VTODO.
5. **No fallback.** `executeToggleTaskDoneCommand` must be available. If obsidian-tasks API is missing, we fail loudly.
6. **Date-bump detection.** CalDAV clients that bump dates instead of setting STATUS:COMPLETED are detected via RRULE next-occurrence matching.

## CalDAV recurrence specs

RFC 5545 defines RRULE on VTODOs but is silent on completion semantics. Different clients handle it differently:

- **Thunderbird/eM Client:** Split into completed instance (RECURRENCE-ID) + pending series with bumped dates. Same UID.
- **Tasks.org:** Bump DTSTART/DUE on existing VTODO, keep STATUS:NEEDS-ACTION. Same UID.
- **Servers (Radicale, Nextcloud):** Leave recurrence handling to clients.

Our approach handles both patterns through two detection methods.

## Architecture

### RecurrenceDetector (`src/caldav/recurrenceDetector.ts`)

Pure, testable helper used by the CalDAV adapter layer. Determines if a task change represents a recurrence completion.

```typescript
interface RecurrenceCompletion {
  isCompletion: boolean;
  reason: 'status-completed' | 'date-bumped' | 'none';
}

function detectRecurrenceCompletion(
  current: CommonTask,
  baseline: CommonTask
): RecurrenceCompletion
```

**Detection rules:**
1. Task must have non-empty `recurrenceRule`
2. **Status path:** baseline status is not DONE, current status is DONE
3. **Date-bump path:** Status still TODO, dueDate moved forward, new date matches next occurrence computed by `rrule` package from old date

### New SyncChange type: `'complete'`

```typescript
export interface SyncChange {
  type: 'create' | 'update' | 'delete' | 'complete';
  task: CommonTask;
  previousVersion?: CommonTask;
}
```

### CalDAV-to-Obsidian flow

1. `diff()` uses `RecurrenceDetector` to check if an incoming CalDAV update is a recurrence completion
2. If yes, emits `SyncChange { type: 'complete' }` instead of `'update'`
3. `ObsidianAdapter` handles `'complete'`:
   - Looks up existing task markdown + file path
   - Calls `executeToggleTaskDoneCommand(line, path)`
   - If result has two lines (recurring): writes both to vault, extracts new task ID
   - Returns `{ oldTaskId, newTaskId, caldavUid }` for ID mapping transfer
4. `SyncEngine` updates `IdMapping`: `caldavUid -> newTaskId`
5. On next sync, the CalDAV VTODO (with bumped dates) matches the new Obsidian task via transferred UID

### Obsidian-to-CalDAV flow

1. User completes recurring task in Obsidian (obsidian-tasks creates completed + new occurrence)
2. Next sync: diff sees old task now DONE, new task appeared
3. Old task: diff emits `'complete'` change to CalDAV adapter, which marks VTODO as COMPLETED and strips RRULE
4. New task: diff emits `'create'` to CalDAV adapter, which creates new VTODO with RRULE and next dates

No duplication risk in this direction since we control the CalDAV side.

### ID mapping transfer (CalDAV-to-Obsidian only)

When `ObsidianAdapter` handles a `'complete'` that produces a new task via `executeToggleTaskDoneCommand`:
- Returns mapping info: `{ oldTaskId, newTaskId, caldavUid }`
- `SyncEngine.updateIdMapping()` removes `oldTaskId -> caldavUid`, adds `newTaskId -> caldavUid`
- The completed task loses its CalDAV mapping
- On next sync, the CalDAV VTODO matches the new Obsidian task, preventing duplicate creation

## Testing strategy

### Unit tests for RecurrenceDetector
- Status completion detected (DONE + recurrenceRule)
- Date-bump completion detected (WEEKLY task, date moved +7 days)
- Date-bump with MONTHLY rule (date moved +1 month)
- No false positive on reschedule (arbitrary date change on recurring task)
- No false positive on non-recurring task completion
- No detection when nothing changed

### Unit tests for adapters
- ObsidianAdapter handles `'complete'` with non-recurring task (single line result)
- ObsidianAdapter handles `'complete'` with recurring task (two lines, ID extraction, mapping returned)
- CalDAVAdapter handles `'complete'` (strips RRULE, sets COMPLETED)

### Integration tests (diff)
- Recurring task completed from CalDAV (status changed) produces `'complete'`
- Recurring task date-bumped from CalDAV produces `'complete'`
- Non-recurring completion produces `'complete'`
- Regular update (no completion) still produces `'update'`

### E2E tests
- Round-trip: create recurring VTODO, complete it, verify new VTODO appears with next dates
- Verify completed instance is COMPLETED on CalDAV, no RRULE
