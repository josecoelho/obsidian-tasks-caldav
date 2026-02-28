# Reconcile Identical Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When id-mapping is lost, match identical tasks by content instead of duplicating them on both sides.

**Architecture:** Add a content-matching pre-pass to `diff()` that pairs orphan tasks by content, emitting `reconcile` changes instead of `create` pairs. SyncEngine handles reconcile by updating id-mapping with no writes to either side.

**Tech Stack:** TypeScript, Jest

---

### Task 1: Add reconcile type to SyncChange

**Files:**
- Modify: `src/sync/types.ts:18-22`

**Step 1: Update SyncChange type**

In `src/sync/types.ts`, change the type union and add `counterpartUid`:

```typescript
export interface SyncChange {
  type: 'create' | 'update' | 'delete' | 'complete' | 'reconcile';
  task: CommonTask;
  previousVersion?: CommonTask;
  counterpartUid?: string;
}
```

**Step 2: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS (no code uses exhaustive switch on type yet, so adding a variant is safe)

**Step 3: Commit**

```
feat(sync): add reconcile change type (#55)
```

---

### Task 2: Add tasksEqualIgnoringUid and reconciliation pre-pass to diff

**Files:**
- Modify: `src/sync/diff.ts`
- Test: `src/sync/diff.test.ts`

**Step 1: Write failing tests for tasksEqualIgnoringUid**

Add to `src/sync/diff.test.ts`:

```typescript
import { diff, tasksEqual, tasksEqualIgnoringUid } from './diff';

// In a new describe block:
describe('tasksEqualIgnoringUid', () => {
  it('should return true for tasks identical except uid', () => {
    const a = makeCommonTask({ uid: 'obs-123', title: 'Buy milk' });
    const b = makeCommonTask({ uid: 'caldav-456', title: 'Buy milk' });
    expect(tasksEqualIgnoringUid(a, b)).toBe(true);
  });

  it('should return false when content differs', () => {
    const a = makeCommonTask({ uid: 'obs-123', title: 'Buy milk' });
    const b = makeCommonTask({ uid: 'caldav-456', title: 'Buy eggs' });
    expect(tasksEqualIgnoringUid(a, b)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern 'src/sync/diff.test.ts' --no-coverage -t 'tasksEqualIgnoringUid'`
Expected: FAIL — `tasksEqualIgnoringUid` is not exported

**Step 3: Implement tasksEqualIgnoringUid**

Add to `src/sync/diff.ts` and export it:

```typescript
export function tasksEqualIgnoringUid(a: CommonTask, b: CommonTask): boolean {
  return tasksEqual({ ...a, uid: '' }, { ...b, uid: '' });
}
```

Note: `tasksEqual` doesn't compare uid (check current implementation — it compares title, status, dates, priority, recurrenceRule, body, tags). If uid is NOT compared in `tasksEqual`, then `tasksEqualIgnoringUid` is just `tasksEqual`. Verify this before implementing — if `tasksEqual` already ignores uid, just export an alias or use `tasksEqual` directly in the reconciliation code and skip this helper entirely.

**Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern 'src/sync/diff.test.ts' --no-coverage -t 'tasksEqualIgnoringUid'`
Expected: PASS

**Step 5: Write failing tests for reconciliation pre-pass**

Add to `src/sync/diff.test.ts` in a new describe block:

```typescript
describe('reconciliation', () => {
  it('should reconcile orphans with identical content instead of creating duplicates', () => {
    const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Buy milk', status: 'TODO' });
    const calTask = makeCommonTask({ uid: 'cal-1', title: 'Buy milk', status: 'TODO' });

    const result = diff([obsTask], [calTask], [], 'caldav-wins');

    // Should produce reconcile changes, not creates
    const obsReconciles = result.toObsidian.filter(c => c.type === 'reconcile');
    const calReconciles = result.toCalDAV.filter(c => c.type === 'reconcile');
    expect(obsReconciles).toHaveLength(1);
    expect(obsReconciles[0].task.uid).toBe('obs-1');
    expect(obsReconciles[0].counterpartUid).toBe('cal-1');
    expect(calReconciles).toHaveLength(1);
    expect(calReconciles[0].task.uid).toBe('cal-1');
    expect(calReconciles[0].counterpartUid).toBe('obs-1');

    // No creates
    expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(0);
    expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(0);
  });

  it('should not reconcile orphans with different content', () => {
    const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Buy milk' });
    const calTask = makeCommonTask({ uid: 'cal-1', title: 'Buy eggs' });

    const result = diff([obsTask], [calTask], [], 'caldav-wins');

    // Should produce creates, not reconciles (plus the existing "both present, no baseline" behavior)
    expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(0);
    expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(0);
  });

  it('should reconcile multiple matching pairs', () => {
    const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
    const obs2 = makeCommonTask({ uid: 'obs-2', title: 'Task B' });
    const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Task A' });
    const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Task B' });

    const result = diff([obs1, obs2], [cal1, cal2], [], 'caldav-wins');

    expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(2);
    expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(2);
    expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(0);
    expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(0);
  });

  it('should not reconcile tasks that have a baseline (only orphans)', () => {
    const baseline = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
    const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
    const calTask = makeCommonTask({ uid: 'cal-new', title: 'Task A' });

    const result = diff([obsTask], [calTask], [baseline], 'caldav-wins');

    // obs-1 has baseline so it's not an orphan — cal-new is a new create
    expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(1);
    expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(0);
  });

  it('should handle mix of reconcilable and non-reconcilable orphans', () => {
    const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Matching task' });
    const obs2 = makeCommonTask({ uid: 'obs-2', title: 'Only in Obsidian' });
    const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Matching task' });
    const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Only in CalDAV' });

    const result = diff([obs1, obs2], [cal1, cal2], [], 'caldav-wins');

    // One pair reconciled
    expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(1);
    expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(1);

    // Remaining orphans: obs-2 creates on CalDAV, cal-2 creates on Obsidian
    // But note: obs-2 and cal-2 both have no baseline AND no UID match,
    // so they hit the "new from one side" branches
    expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(1);
    expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(1);
  });

  it('should pick first match when multiple CalDAV tasks match one Obsidian task', () => {
    const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Duplicate' });
    const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Duplicate' });
    const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Duplicate' });

    const result = diff([obs1], [cal1, cal2], [], 'caldav-wins');

    // One reconcile pair, one leftover CalDAV task treated normally
    expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(1);
    expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(1);
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `npx jest --testPathPattern 'src/sync/diff.test.ts' --no-coverage -t 'reconciliation'`
Expected: FAIL — diff doesn't produce reconcile changes yet

**Step 7: Implement reconciliation pre-pass in diff()**

In `src/sync/diff.ts`, add the pre-pass before the main `for` loop. The approach:

1. Identify Obsidian-only and CalDAV-only orphans (no UID match on other side, no baseline)
2. For each Obsidian orphan, find a CalDAV orphan with matching content
3. Emit reconcile changes for matched pairs, remove them from maps so main loop skips them

```typescript
// Before the main for loop, add reconciliation pre-pass:
const reconciledUids = reconcileOrphans(
  obsidianByUid, caldavByUid, baselineByUid, toObsidian, toCalDAV,
);
// Remove reconciled UIDs from allUids so main loop skips them
for (const uid of reconciledUids) {
  allUids.delete(uid);
}
```

Add the helper function:

```typescript
function reconcileOrphans(
  obsidianByUid: Map<string, CommonTask>,
  caldavByUid: Map<string, CommonTask>,
  baselineByUid: Map<string, CommonTask>,
  toObsidian: SyncChange[],
  toCalDAV: SyncChange[],
): Set<string> {
  const reconciledUids = new Set<string>();

  // Collect orphans: present on one side only, no baseline
  const obsOrphans: CommonTask[] = [];
  for (const [uid, task] of obsidianByUid) {
    if (!caldavByUid.has(uid) && !baselineByUid.has(uid)) {
      obsOrphans.push(task);
    }
  }

  const calOrphanPool = new Map<string, CommonTask>();
  for (const [uid, task] of caldavByUid) {
    if (!obsidianByUid.has(uid) && !baselineByUid.has(uid)) {
      calOrphanPool.set(uid, task);
    }
  }

  // Match by content
  for (const obsTask of obsOrphans) {
    for (const [calUid, calTask] of calOrphanPool) {
      if (tasksEqual({ ...obsTask, uid: '' }, { ...calTask, uid: '' })) {
        toObsidian.push({ type: 'reconcile', task: obsTask, counterpartUid: calUid });
        toCalDAV.push({ type: 'reconcile', task: calTask, counterpartUid: obsTask.uid });
        reconciledUids.add(obsTask.uid);
        reconciledUids.add(calUid);
        calOrphanPool.delete(calUid);
        break; // first match wins
      }
    }
  }

  return reconciledUids;
}
```

**Step 8: Run tests to verify they pass**

Run: `npx jest --testPathPattern 'src/sync/diff.test.ts' --no-coverage`
Expected: ALL PASS (new reconciliation tests + all existing tests)

**Step 9: Commit**

```
feat(sync): reconcile orphan tasks by content in diff pre-pass (#55)
```

---

### Task 3: Handle reconcile in adapters

**Files:**
- Modify: `src/sync/caldavAdapter.ts:72` (switch statement)
- Modify: `src/sync/obsidianAdapter.ts:91` (switch statement)

**Step 1: Add reconcile case to CalDAV adapter switch**

In `src/sync/caldavAdapter.ts`, add a case in the `switch (change.type)` block:

```typescript
case 'reconcile':
  // No-op: reconcile only updates id-mapping, handled by SyncEngine
  break;
```

**Step 2: Add reconcile case to Obsidian adapter switch**

In `src/sync/obsidianAdapter.ts`, add a case in the `switch (change.type)` block:

```typescript
case "reconcile":
  // No-op: reconcile only updates id-mapping, handled by SyncEngine
  break;
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```
feat(sync): handle reconcile as no-op in adapters (#55)
```

---

### Task 4: Handle reconcile in SyncEngine

**Files:**
- Modify: `src/sync/syncEngine.ts`

**Step 1: Update updateIdMapping to handle reconcile changes**

In `src/sync/syncEngine.ts`, inside `updateIdMapping()`, add handling for reconcile changes from `toObsidian` (which carry the Obsidian task uid and CalDAV counterpartUid):

```typescript
// After existing loops, add:
for (const change of changeset.toObsidian) {
  if (change.type === 'reconcile' && change.counterpartUid) {
    const obsidianUid = change.task.uid;
    const caldavUid = change.counterpartUid;
    idMapping.taskIdToCaldavUid[obsidianUid] = caldavUid;
    idMapping.caldavUidToTaskId[caldavUid] = obsidianUid;
  }
  // existing delete handling...
}
```

Note: Be careful to integrate with the existing `toObsidian` delete loop — don't duplicate it.

**Step 2: Update computeNewBaseline to include reconciled tasks**

The existing `computeNewBaseline` already includes all tasks from both sides in the baseline map, so reconciled tasks are already covered. But verify that the reconcile type is handled in the "create or update or complete" filter on line 215:

```typescript
if (change.type === "create" || change.type === "update" || change.type === "complete" || change.type === "reconcile") {
```

**Step 3: Update countChanges to report reconciled count**

Add a `reconciled` counter to `SyncResult` and `countChanges`. In `countChanges`:

```typescript
reconciled: count(changeset.toObsidian, 'reconcile'),
```

Update the `SyncResult` interface to add `reconciled: number`. Update `buildResult` and `buildErrorResult` to include the count. Update notice messages to show reconciled count.

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```
feat(sync): handle reconcile in SyncEngine id-mapping and baseline (#55)
```

---

### Task 5: Full integration verification

**Step 1: Run full test suite with coverage**

Run: `npm test`
Expected: ALL PASS, coverage thresholds met

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Final commit if any adjustments needed**

---
