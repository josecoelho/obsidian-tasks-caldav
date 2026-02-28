# Design: Reconcile identical tasks in diff (#55)

## Problem

When id-mapping is lost (calendar rename, deleted storage, first sync with existing tasks on both sides), the diff engine treats every task as new on both sides — creating duplicates. This happens because Obsidian tasks have `task-abc` UIDs while CalDAV tasks have `caldav-xyz` UIDs, and without a mapping they never match by UID.

## Solution

Add a content-matching pre-pass to `diff()` that reconciles orphan tasks before the main UID-based loop.

### New change type

Add `'reconcile'` to `SyncChange.type`. Add optional `counterpartUid: string` to `SyncChange` to carry the other side's UID.

### Diff pre-pass

Before the main loop in `diff()`:

1. Identify orphans on each side: tasks present on one side only, with no baseline entry.
2. For each Obsidian orphan, find a CalDAV orphan with identical content (`tasksEqualIgnoringUid`).
3. For matched pairs, emit a `reconcile` change in **both** `toObsidian` and `toCalDAV`:
   - `toObsidian`: `{ type: 'reconcile', task: obsidianTask, counterpartUid: caldavTask.uid }`
   - `toCalDAV`: `{ type: 'reconcile', task: caldavTask, counterpartUid: obsidianTask.uid }`
4. Remove matched pairs from the orphan sets so the main loop skips them.
5. Unmatched orphans proceed through the main loop as `create` changes (existing behavior).

### SyncEngine handling

- Adapters: skip `reconcile` changes in `applyChanges` (no writes to either side).
- SyncEngine: extract id-mapping updates from reconcile changes — link `obsidianTask.uid` ↔ `caldavTask.uid`.
- Baseline: include reconciled tasks (use the Obsidian version as the baseline entry since both are identical).
- SyncResult: report reconciled count in the result/notice.

### Content matching

New helper `tasksEqualIgnoringUid(a, b)`: same as `tasksEqual` but skips the `uid` field. Reuse existing field comparisons.

One-to-many: if multiple CalDAV tasks match one Obsidian task, pick the first match. Remaining duplicates stay as creates.

## Files to change

- `src/sync/types.ts` — add `'reconcile'` to type union, add `counterpartUid?: string`
- `src/sync/diff.ts` — add `tasksEqualIgnoringUid()`, reconciliation pre-pass
- `src/sync/syncEngine.ts` — handle reconcile in `updateIdMapping` and `computeNewBaseline`, update `countChanges` and notices
- `src/sync/diff.test.ts` — tests for reconciliation
