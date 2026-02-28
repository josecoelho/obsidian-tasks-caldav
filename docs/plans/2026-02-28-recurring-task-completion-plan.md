# Recurring Task Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support recurring task completion in both directions (CalDAV↔Obsidian) without duplicating tasks.

**Architecture:** Add a `RecurrenceDetector` helper in `src/caldav/` that detects completion via status change or date-bump. Add `'complete'` to `SyncChange` type. `diff()` emits `'complete'` instead of `'update'` when recurrence completion is detected. `ObsidianAdapter` handles it via `executeToggleTaskDoneCommand`. `CalDAVAdapter` handles it by marking VTODO COMPLETED and stripping RRULE.

**Tech Stack:** TypeScript, `rrule` (already installed), Jest, obsidian-tasks API (`executeToggleTaskDoneCommand`)

**Design doc:** `docs/plans/2026-02-28-recurring-task-completion-design.md`

---

### Task 1: RecurrenceDetector — status-completed detection

**Files:**
- Create: `src/caldav/recurrenceDetector.ts`
- Test: `src/caldav/recurrenceDetector.test.ts`

**Step 1: Write the failing tests**

In `src/caldav/recurrenceDetector.test.ts`:

```typescript
import { detectRecurrenceCompletion } from './recurrenceDetector';
import { CommonTask } from '../sync/types';

function makeTask(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: 'task-001',
    title: 'Weekly review',
    status: 'TODO',
    dueDate: '2026-02-17',
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: 'FREQ=WEEKLY',
    body: '',
    ...overrides,
  };
}

describe('detectRecurrenceCompletion', () => {
  describe('status-completed detection', () => {
    it('detects completion when recurring task status changes to DONE', () => {
      const baseline = makeTask({ status: 'TODO' });
      const current = makeTask({ status: 'DONE', completedDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(true);
      expect(result.reason).toBe('status-completed');
    });

    it('does not detect completion for non-recurring task', () => {
      const baseline = makeTask({ status: 'TODO', recurrenceRule: '' });
      const current = makeTask({ status: 'DONE', recurrenceRule: '', completedDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect completion when status did not change', () => {
      const baseline = makeTask({ status: 'DONE', completedDate: '2026-02-17' });
      const current = makeTask({ status: 'DONE', completedDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect completion when baseline was already DONE', () => {
      const baseline = makeTask({ status: 'DONE', completedDate: '2026-02-10' });
      const current = makeTask({ status: 'DONE', completedDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest src/caldav/recurrenceDetector.test.ts --no-coverage`
Expected: FAIL — `Cannot find module './recurrenceDetector'`

**Step 3: Write minimal implementation**

In `src/caldav/recurrenceDetector.ts`:

```typescript
import { CommonTask } from '../sync/types';

export interface RecurrenceCompletion {
  isCompletion: boolean;
  reason: 'status-completed' | 'date-bumped' | 'none';
}

export function detectRecurrenceCompletion(
  current: CommonTask,
  baseline: CommonTask,
): RecurrenceCompletion {
  if (!current.recurrenceRule) {
    return { isCompletion: false, reason: 'none' };
  }

  if (baseline.status !== 'DONE' && current.status === 'DONE') {
    return { isCompletion: true, reason: 'status-completed' };
  }

  return { isCompletion: false, reason: 'none' };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/caldav/recurrenceDetector.test.ts --no-coverage`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/caldav/recurrenceDetector.ts src/caldav/recurrenceDetector.test.ts
git commit -m "feat: add RecurrenceDetector with status-completed detection"
```

---

### Task 2: RecurrenceDetector — date-bump detection

**Files:**
- Modify: `src/caldav/recurrenceDetector.ts`
- Modify: `src/caldav/recurrenceDetector.test.ts`

**Step 1: Write the failing tests**

Add to `src/caldav/recurrenceDetector.test.ts`:

```typescript
  describe('date-bump detection', () => {
    it('detects completion when weekly task due date moves +7 days', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: 'FREQ=WEEKLY',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-02-24',
        recurrenceRule: 'FREQ=WEEKLY',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(true);
      expect(result.reason).toBe('date-bumped');
    });

    it('detects completion when monthly task due date moves +1 month', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: 'FREQ=MONTHLY',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-03-17',
        recurrenceRule: 'FREQ=MONTHLY',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(true);
      expect(result.reason).toBe('date-bumped');
    });

    it('detects completion when daily task due date moves +1 day', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: 'FREQ=DAILY',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-02-18',
        recurrenceRule: 'FREQ=DAILY',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(true);
      expect(result.reason).toBe('date-bumped');
    });

    it('does not detect completion when date moves to arbitrary value', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: 'FREQ=WEEKLY',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-02-20',
        recurrenceRule: 'FREQ=WEEKLY',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect completion when date moves backward', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-24',
        recurrenceRule: 'FREQ=WEEKLY',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: 'FREQ=WEEKLY',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect date bump on non-recurring task', () => {
      const baseline = makeTask({
        status: 'TODO',
        dueDate: '2026-02-17',
        recurrenceRule: '',
      });
      const current = makeTask({
        status: 'TODO',
        dueDate: '2026-02-24',
        recurrenceRule: '',
      });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect date bump when due dates are identical', () => {
      const baseline = makeTask({ status: 'TODO', dueDate: '2026-02-17' });
      const current = makeTask({ status: 'TODO', dueDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });

    it('does not detect date bump when baseline has no due date', () => {
      const baseline = makeTask({ status: 'TODO', dueDate: null });
      const current = makeTask({ status: 'TODO', dueDate: '2026-02-24' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result.isCompletion).toBe(false);
      expect(result.reason).toBe('none');
    });
  });
```

**Step 2: Run tests to verify new ones fail**

Run: `npx jest src/caldav/recurrenceDetector.test.ts --no-coverage`
Expected: date-bump tests FAIL (not implemented yet)

**Step 3: Implement date-bump detection**

Update `src/caldav/recurrenceDetector.ts` — add `rrule` import and date-bump logic:

```typescript
import { RRule } from 'rrule';
import { CommonTask } from '../sync/types';

export interface RecurrenceCompletion {
  isCompletion: boolean;
  reason: 'status-completed' | 'date-bumped' | 'none';
}

export function detectRecurrenceCompletion(
  current: CommonTask,
  baseline: CommonTask,
): RecurrenceCompletion {
  if (!current.recurrenceRule) {
    return { isCompletion: false, reason: 'none' };
  }

  if (baseline.status !== 'DONE' && current.status === 'DONE') {
    return { isCompletion: true, reason: 'status-completed' };
  }

  if (isDateBumpCompletion(current, baseline)) {
    return { isCompletion: true, reason: 'date-bumped' };
  }

  return { isCompletion: false, reason: 'none' };
}

function isDateBumpCompletion(current: CommonTask, baseline: CommonTask): boolean {
  if (current.status !== 'TODO') return false;
  if (!baseline.dueDate || !current.dueDate) return false;
  if (baseline.dueDate === current.dueDate) return false;

  const baseDate = new Date(baseline.dueDate + 'T00:00:00Z');
  const currentDate = new Date(current.dueDate + 'T00:00:00Z');

  if (currentDate <= baseDate) return false;

  try {
    const rule = RRule.fromString(`RRULE:${current.recurrenceRule}`);
    const ruleWithStart = new RRule({ ...rule.origOptions, dtstart: baseDate });
    const nextDates = ruleWithStart.between(baseDate, new Date(currentDate.getTime() + 86400000), true);
    // The next occurrence after baseDate should match currentDate
    const nextAfterBase = nextDates.find(d => d.getTime() > baseDate.getTime());
    if (!nextAfterBase) return false;

    return formatDateUTC(nextAfterBase) === current.dueDate;
  } catch {
    return false;
  }
}

function formatDateUTC(date: Date): string {
  return date.toISOString().split('T')[0];
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/caldav/recurrenceDetector.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/caldav/recurrenceDetector.ts src/caldav/recurrenceDetector.test.ts
git commit -m "feat: add date-bump detection to RecurrenceDetector"
```

---

### Task 3: Add `'complete'` to SyncChange type

**Files:**
- Modify: `src/sync/types.ts:18-22`
- Modify: `src/sync/syncEngine.ts:204,255-256` (countChanges, computeNewBaseline)

**Step 1: Update the SyncChange type**

In `src/sync/types.ts`, change line 19:
```typescript
  type: 'create' | 'update' | 'delete' | 'complete';
```

**Step 2: Update `computeNewBaseline` in syncEngine.ts**

At line 204, the baseline computation filters on `change.type`. Add `'complete'` alongside `'update'`:
```typescript
if (change.type === "create" || change.type === "update" || change.type === "complete") {
```

**Step 3: Update `countChanges` in syncEngine.ts**

Add a `completed` counter to `SyncResult` and `countChanges`, or count `'complete'` as `'updated'` for simplicity. For now, count it alongside updates:

In `countChanges()` at line 255-256, the existing filter `c.type === type` works with string matching. Add a separate count for `'complete'` or merge it into updates. Simplest: add complete counts to `updated`:
```typescript
updated: {
  toObsidian: count(changeset.toObsidian, "update") + count(changeset.toObsidian, "complete"),
  toCalDAV: count(changeset.toCalDAV, "update") + count(changeset.toCalDAV, "complete"),
},
```

**Step 4: Run existing tests to make sure nothing breaks**

Run: `npm test`
Expected: All existing tests PASS (no behavior changed yet)

**Step 5: Commit**

```bash
git add src/sync/types.ts src/sync/syncEngine.ts
git commit -m "feat: add 'complete' to SyncChange type union"
```

---

### Task 4: Emit `'complete'` from diff()

**Files:**
- Modify: `src/sync/diff.ts:1,76-79`
- Modify: `src/sync/diff.test.ts`

**Step 1: Write the failing tests**

Add to `src/sync/diff.test.ts`:

```typescript
  describe('recurring task completion', () => {
    it('should emit complete when CalDAV marks recurring task as DONE', () => {
      const baseline = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });
      const obsidian = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });
      const caldav = makeCommonTask({
        uid: 't1',
        status: 'DONE',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
        completedDate: '2026-02-17',
      });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('complete');
      expect(result.toObsidian[0].previousVersion).toEqual(baseline);
    });

    it('should emit complete when CalDAV bumps recurring task due date', () => {
      const baseline = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });
      const obsidian = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });
      const caldav = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-24',
      });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('complete');
    });

    it('should emit update for non-recurring task completion from CalDAV', () => {
      const baseline = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: '',
        dueDate: '2026-02-17',
      });
      const obsidian = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: '',
        dueDate: '2026-02-17',
      });
      const caldav = makeCommonTask({
        uid: 't1',
        status: 'DONE',
        recurrenceRule: '',
        dueDate: '2026-02-17',
        completedDate: '2026-02-17',
      });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('update');
    });

    it('should emit complete when Obsidian marks recurring task as DONE', () => {
      const baseline = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });
      const obsidian = makeCommonTask({
        uid: 't1',
        status: 'DONE',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
        completedDate: '2026-02-17',
      });
      const caldav = makeCommonTask({
        uid: 't1',
        status: 'TODO',
        recurrenceRule: 'FREQ=WEEKLY',
        dueDate: '2026-02-17',
      });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('complete');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx jest src/sync/diff.test.ts --no-coverage`
Expected: New tests FAIL — diff emits `'update'` not `'complete'`

**Step 3: Integrate RecurrenceDetector into diff()**

In `src/sync/diff.ts`, add import and detection logic:

```typescript
import { CommonTask, Changeset, SyncChange, Conflict, ConflictStrategy } from './types';
import { detectRecurrenceCompletion } from '../caldav/recurrenceDetector';
```

Then modify the update emission logic. Where the diff currently emits `'update'`, check for recurrence completion and emit `'complete'` instead. At lines 76-79 (CalDAV changed only → push to Obsidian):

```typescript
} else if (calChanged) {
  const recurrence = detectRecurrenceCompletion(cal, base);
  const type = recurrence.isCompletion ? 'complete' : 'update';
  toObsidian.push({ type, task: cal, previousVersion: base });
}
```

And at line 77 (Obsidian changed only → push to CalDAV):
```typescript
} else if (obsChanged) {
  const recurrence = detectRecurrenceCompletion(obs, base);
  const type = recurrence.isCompletion ? 'complete' : 'update';
  toCalDAV.push({ type, task: obs, previousVersion: base });
}
```

Also handle conflicts where one side is a recurrence completion (lines 63-68). When both sides changed and one is a recurrence completion, the strategy still resolves, but the emitted type should reflect `'complete'` if applicable:

```typescript
if (obsChanged && calChanged) {
  if (strategy === 'obsidian-wins') {
    const recurrence = detectRecurrenceCompletion(obs, base);
    const type = recurrence.isCompletion ? 'complete' : 'update';
    toCalDAV.push({ type, task: obs, previousVersion: base });
  } else {
    const recurrence = detectRecurrenceCompletion(cal, base);
    const type = recurrence.isCompletion ? 'complete' : 'update';
    toObsidian.push({ type, task: cal, previousVersion: base });
  }
  conflicts.push({ uid, obsidianVersion: obs, caldavVersion: cal, baselineVersion: base });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/sync/diff.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/sync/diff.ts src/sync/diff.test.ts
git commit -m "feat: emit 'complete' from diff when recurrence completion detected"
```

---

### Task 5: ObsidianAdapter handles `'complete'` change type

**Files:**
- Modify: `src/sync/obsidianAdapter.ts:1-2,72-138`
- Modify: `src/tasks/obsidianTasksWrapper.ts` (add `getTasksApi` accessor)
- Modify: `src/sync/obsidianAdapter.test.ts`

**Step 1: Write the failing tests**

Add to `src/sync/obsidianAdapter.test.ts` a new describe block. First read the existing test file to understand mock patterns:

The test file uses mocks for `ObsidianTasksWrapper`. Add tests for `'complete'`:

```typescript
describe('complete change type', () => {
  it('calls executeToggleTaskDoneCommand for complete changes', async () => {
    // Setup: a recurring task exists in the adapter's internal map
    const existingTask = makeObsidianTask({
      description: 'Weekly review',
      originalMarkdown: '- [ ] Weekly review 🔁 every week 📅 2026-02-17 🆔 task-001',
      path: 'tasks.md',
      isDone: false,
    });

    // Mock the toggle command to return two lines (recurring completion)
    const toggleResult = '- [x] Weekly review 🔁 every week 📅 2026-02-17 ✅ 2026-02-17 🆔 task-001\n- [ ] Weekly review 🔁 every week 📅 2026-02-24 🆔 task-002';
    mockWrapper.getToggleCommand.mockReturnValue((line: string, path: string) => toggleResult);

    // Populate the adapter's internal tasksById map
    adapter.normalize(
      [{ task: existingTask, body: '' }],
      () => 'task-001',
    );

    const changes: SyncChange[] = [{
      type: 'complete',
      task: makeCommonTask({
        uid: 'task-001',
        status: 'DONE',
        recurrenceRule: 'FREQ=WEEKLY',
        completedDate: '2026-02-17',
      }),
      previousVersion: makeCommonTask({ uid: 'task-001', status: 'TODO' }),
    }];

    const result = await adapter.applyChanges(changes);

    // Should have written the toggled result to vault
    expect(mockWrapper.updateTaskInVault).toHaveBeenCalledWith(
      existingTask,
      toggleResult,
    );
  });

  it('returns ID remapping when toggle produces new recurring task', async () => {
    const existingTask = makeObsidianTask({
      description: 'Weekly review',
      originalMarkdown: '- [ ] Weekly review 🔁 every week 📅 2026-02-17 🆔 task-001',
      path: 'tasks.md',
    });

    // Toggle returns two lines — completed + new occurrence with new ID
    const toggleResult = '- [x] Weekly review 🔁 every week 📅 2026-02-17 ✅ 2026-02-17 🆔 task-001\n- [ ] Weekly review 🔁 every week 📅 2026-02-24 🆔 task-002';
    mockWrapper.getToggleCommand.mockReturnValue(() => toggleResult);

    adapter.normalize([{ task: existingTask, body: '' }], () => 'task-001');

    const changes: SyncChange[] = [{
      type: 'complete',
      task: makeCommonTask({
        uid: 'task-001',
        status: 'DONE',
        recurrenceRule: 'FREQ=WEEKLY',
      }),
    }];

    const result = await adapter.applyChanges(changes);

    // The result should include the ID remapping info
    // Exact structure TBD based on implementation
  });
});
```

Note: The exact mock patterns will need to match the existing test file structure. Read `src/sync/obsidianAdapter.test.ts` before implementing to align with mock patterns.

**Step 2: Run tests to verify they fail**

Run: `npx jest src/sync/obsidianAdapter.test.ts --no-coverage`
Expected: FAIL — `'complete'` case not handled

**Step 3: Add `getToggleCommand` to ObsidianTasksWrapper**

In `src/tasks/obsidianTasksWrapper.ts`, add a method to expose `executeToggleTaskDoneCommand`:

```typescript
getToggleCommand(): ((line: string, path: string) => string) | null {
  const api = this.getTasksApi();
  if (!api) return null;
  return api.executeToggleTaskDoneCommand;
}
```

Where `getTasksApi()` accesses the obsidian-tasks API. The wrapper already has access to the app in `initialize()` — store a reference to the API.

**Step 4: Handle `'complete'` in ObsidianAdapter.applyChanges()**

Add a new case in the switch at line 82:

```typescript
case "complete": {
  const existingTask =
    this.tasksById.get(change.task.uid) ??
    this.wrapper.findTaskById(change.task.uid);
  if (!existingTask) continue;

  const toggleFn = this.wrapper.getToggleCommand();
  if (!toggleFn) {
    throw new Error('obsidian-tasks API not available for task completion');
  }

  const result = toggleFn(
    existingTask.originalMarkdown,
    existingTask.path,
  );

  // Write the toggled result (1 or 2 lines) to vault
  await this.wrapper.updateTaskInVault(existingTask, result);

  // If result has two lines, the second is the new occurrence
  const lines = result.split('\n');
  if (lines.length > 1) {
    // Extract new task ID from the second line (🆔 pattern)
    const idMatch = lines[1].match(/🆔\s+(\S+)/);
    if (idMatch) {
      createdMappings.push({
        taskId: idMatch[1],
        caldavUID: change.task.uid, // old task's UID for remapping
      });
    }
  }
  break;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx jest src/sync/obsidianAdapter.test.ts --no-coverage`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/tasks/obsidianTasksWrapper.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat: ObsidianAdapter handles 'complete' via executeToggleTaskDoneCommand"
```

---

### Task 6: CalDAVAdapter handles `'complete'` change type

**Files:**
- Modify: `src/sync/caldavAdapter.ts:68-93`
- Modify: `src/sync/caldavAdapter.test.ts`

**Step 1: Write the failing test**

Add to `src/sync/caldavAdapter.test.ts`:

```typescript
describe('complete change type', () => {
  it('marks VTODO as COMPLETED and strips RRULE for complete changes', async () => {
    const change: SyncChange = {
      type: 'complete',
      task: makeCommonTask({
        uid: 'task-001',
        status: 'DONE',
        recurrenceRule: 'FREQ=WEEKLY',
        completedDate: '2026-02-17',
      }),
    };

    // The completed task should be written WITHOUT recurrenceRule
    await adapter.applyChanges([change], emptyIdMapping);

    // Verify the VTODO sent to updateVTODO does NOT contain RRULE
    const vtodoData = mockClient.updateVTODO.mock.calls[0][1];
    expect(vtodoData).toContain('STATUS:COMPLETED');
    expect(vtodoData).not.toContain('RRULE');
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx jest src/sync/caldavAdapter.test.ts --no-coverage`
Expected: FAIL

**Step 3: Handle `'complete'` in CalDAVAdapter.applyChanges()**

Add a case in the switch at line 72:

```typescript
case 'complete': {
  const existing = await this.client.fetchVTODOByUID(caldavUID);
  if (!existing) {
    console.error(`[CalDAVAdapter] VTODO ${caldavUID} not found for complete, skipping`);
    continue;
  }
  // Strip recurrence rule for the completed instance
  const completedTask: CommonTask = {
    ...change.task,
    recurrenceRule: '',
  };
  const newData = this.fromCommonTask(completedTask, caldavUID);
  await this.client.updateVTODO(existing, newData);
  break;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest src/sync/caldavAdapter.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/sync/caldavAdapter.ts src/sync/caldavAdapter.test.ts
git commit -m "feat: CalDAVAdapter handles 'complete' by marking COMPLETED and stripping RRULE"
```

---

### Task 7: SyncEngine ID mapping transfer for recurring completions

**Files:**
- Modify: `src/sync/syncEngine.ts:140-166`
- Modify: `src/sync/syncEngine.test.ts`

**Step 1: Write the failing test**

Add to `src/sync/syncEngine.test.ts`:

```typescript
describe('recurring completion ID mapping', () => {
  it('transfers CalDAV UID to new task when recurring completion creates new occurrence', async () => {
    // Setup: existing mapping task-001 <-> caldav-uid-001
    // ObsidianAdapter.applyChanges returns a createdMapping for the new task
    // After sync, mapping should be: task-002 <-> caldav-uid-001
    // And task-001 mapping should be removed

    // This test needs to verify the updateIdMapping behavior
    // when a 'complete' change produces a createdMapping with the OLD uid
  });
});
```

Note: Read `src/sync/syncEngine.test.ts` first to understand the mock structure and adapt accordingly.

**Step 2: Update `updateIdMapping` to handle UID transfers**

The current `updateIdMapping` handles `createdMappings` from `applyChanges`. When a `'complete'` change produces a `createdMapping`, the `caldavUID` field will be the old task's UID (which maps to the CalDAV UID via IdMapping). We need to:

1. Look up the actual CalDAV UID for the old task
2. Remove the old mapping
3. Create new mapping: newTaskId → caldavUID

In `updateIdMapping`, add handling for complete changes:

```typescript
// Handle ID transfers from recurring completions
for (const change of changeset.toObsidian) {
  if (change.type === 'complete') {
    // The old task ID's CalDAV mapping should be removed
    // (it's now completed, no longer needs CalDAV sync)
    // New task mapping was added via createdMappings above
    this.removeFromIdMapping(idMapping, change.task.uid);
  }
}
```

The `createdMappings` from `ObsidianAdapter` already adds the new mapping. We just need to clean up the old one.

But wait — the `createdMappings` entry from ObsidianAdapter has `caldavUID: change.task.uid` which is the Obsidian task ID, not the CalDAV UID. We need to resolve this. The proper fix is: in ObsidianAdapter, the `caldavUID` in createdMappings should be the actual CalDAV UID. But ObsidianAdapter doesn't have access to IdMapping.

Better approach: Have SyncEngine handle the transfer explicitly. After applying changes, for each `'complete'` in `toObsidian` that generated a createdMapping, SyncEngine:
1. Gets the old CalDAV UID: `idMapping.taskIdToCaldavUid[oldTaskId]`
2. Removes old mapping
3. Adds new mapping: `newTaskId → oldCalDAVUID`

This requires matching createdMappings to complete changes. The simplest: ObsidianAdapter returns a separate `completionRemappings` array alongside `createdMappings`:

```typescript
interface CompletionRemapping {
  oldTaskId: string;
  newTaskId: string;
}
```

Then SyncEngine handles it:
```typescript
for (const { oldTaskId, newTaskId } of completionRemappings) {
  const caldavUID = idMapping.taskIdToCaldavUid[oldTaskId];
  if (caldavUID) {
    this.removeFromIdMapping(idMapping, oldTaskId);
    idMapping.taskIdToCaldavUid[newTaskId] = caldavUID;
    idMapping.caldavUidToTaskId[caldavUID] = newTaskId;
  }
}
```

**Step 3: Update ObsidianAdapter return type**

Change `applyChanges` return type to include completion remappings:

```typescript
interface ApplyChangesResult {
  createdMappings: Array<{ taskId: string; caldavUID: string }>;
  completionRemappings: Array<{ oldTaskId: string; newTaskId: string }>;
}
```

Update the `'complete'` case in ObsidianAdapter to populate `completionRemappings` instead of `createdMappings`.

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/sync/syncEngine.ts src/sync/obsidianAdapter.ts src/sync/syncEngine.test.ts
git commit -m "feat: SyncEngine transfers CalDAV UID mapping on recurring completion"
```

---

### Task 8: Integration test — full recurring completion flow

**Files:**
- Modify: `src/sync/syncEngine.test.ts`

**Step 1: Write an integration test that exercises the full flow**

```typescript
describe('recurring task completion integration', () => {
  it('CalDAV completes recurring task → Obsidian toggles → ID remapped', async () => {
    // Setup:
    // - Baseline has recurring task (task-001, FREQ=WEEKLY, due 2026-02-17)
    // - Obsidian has same task unchanged
    // - CalDAV has task marked DONE (or date bumped)
    // - IdMapping: task-001 <-> caldav-uid-001
    //
    // Expected:
    // - ObsidianAdapter calls executeToggleTaskDoneCommand
    // - Vault gets completed task + new occurrence (task-002)
    // - IdMapping updated: task-002 <-> caldav-uid-001, task-001 removed
    // - CalDAV VTODO stays as-is (client already handled it)
  });

  it('Obsidian completes recurring task → CalDAV gets COMPLETED + new create', async () => {
    // Setup:
    // - Baseline has recurring task (task-001, FREQ=WEEKLY, due 2026-02-17)
    // - Obsidian has task-001 DONE + new task-002 (next occurrence)
    // - CalDAV has task-001 unchanged
    //
    // Expected:
    // - CalDAV gets 'complete' for task-001 (COMPLETED, no RRULE)
    // - CalDAV gets 'create' for task-002 (new VTODO with RRULE)
    // - IdMapping: task-001 mapping removed, task-002 gets new obsidian- mapping
  });
});
```

**Step 2: Implement the test with proper mocks**

Read `src/sync/syncEngine.test.ts` to understand the existing mock structure and write proper integration tests that exercise the full sync flow.

**Step 3: Run tests**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/sync/syncEngine.test.ts
git commit -m "test: add integration tests for recurring task completion flow"
```

---

### Task 9: Run full test suite and fix any issues

**Files:** Any files that need fixes

**Step 1: Run the complete test suite with coverage**

Run: `npm test`

**Step 2: Fix any failures**

Address any test failures, TypeScript errors, or coverage threshold violations.

**Step 3: Run lint**

Run: `npm run lint`

**Step 4: Run build**

Run: `npm run build`

**Step 5: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve test/lint/build issues from recurring completion feature"
```

---

### Task 10: E2E test — recurring VTODO round-trip

**Files:**
- Create or modify: `test/e2e/` (check existing E2E test files for patterns)

**Step 1: Write E2E test**

Create a test that:
1. Creates a recurring VTODO on the CalDAV server (Radicale via Docker)
2. Syncs → task appears in Obsidian with recurrence
3. Marks the VTODO as COMPLETED on CalDAV
4. Syncs → Obsidian task is toggled, new occurrence created
5. Verifies: completed task is done, new task has next due date, ID mapping correct

**Step 2: Run E2E tests**

Run: `npm test` (includes E2E if Docker is running)

**Step 3: Commit**

```bash
git add test/e2e/
git commit -m "test(e2e): add recurring VTODO completion round-trip test"
```
