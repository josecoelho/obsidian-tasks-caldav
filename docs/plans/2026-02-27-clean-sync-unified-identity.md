# Clean sync() + unified identity via CommonTask

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `sync()` readable at a glance and eliminate `MappingData` by storing both IDs in `CommonTask` (baseline becomes the identity mapping).

**Architecture:** `CommonTask` gains `caldavUri: string | null`. The baseline (persisted `CommonTask[]`) replaces `mapping.json` as the source of truth for task identity across systems. The `sync()` method becomes a short sequence of self-explanatory steps with all detail pushed into helpers and adapters.

**Tech Stack:** TypeScript, Jest, obsidian-tasks plugin API

---

## Code style guideline

Add these rules to CLAUDE.md under a new `### Clean code` section:

```markdown
### Clean code
- **Self-documenting** — if code needs a comment, rename the variable or extract a method instead
- **Push logic to the edges** — filtering, ID resolution, data shaping belong in adapters and I/O layers, not the orchestrator
- **One intent per line** — each line in an orchestrator method should express a single, clear action
- **No inline noise** — Notice calls, counting loops, string formatting go into private helpers
- **Methods as documentation** — `getOrCreateBaseline()` reads better than a 6-line if/else with a comment
- **No special-case accumulation** — if you find yourself adding "also include X when Y", question whether the abstraction is right
```

---

## Target sync() shape

```ts
async sync(dryRun = false): Promise<SyncResult> {
  const syncTag = this.settings.syncTag;
  const baseline = this.getOrCreateBaseline();

  const caldavTasks = await this.caldavAdapter.fetchTasks(syncTag, baseline);
  const obsidianTasks = await this.obsidianAdapter.fetchTasks(syncTag);

  const changeset = diff(obsidianTasks, caldavTasks, baseline, this.getConflictStrategy());

  if (dryRun) return this.buildResult(changeset, true);

  await this.caldavAdapter.applyChanges(changeset.toCalDAV, baseline);
  await this.obsidianAdapter.applyChanges(changeset.toObsidian);
  await this.obsidianAdapter.writeBackIds(obsidianTasks);

  await this.saveState(obsidianTasks, caldavTasks, changeset);
  return this.buildResult(changeset, false);
}
```

Key differences from current:
- **SyncEngine doesn't know about CalDAV clients or wrappers** — adapters receive their I/O dependencies in the constructor, not per-call
- **Adapters own the full pipeline** — `fetchTasks()` does connect + fetch + normalize + filter internally. SyncEngine just gets `CommonTask[]` back
- `applyChanges()` and `writeBackIds()` don't take client/wrapper/settings — adapters already have them
- Baseline lookup replaces uidMapping for CalDAV identity resolution
- `getOrCreateBaseline()` / `getConflictStrategy()` / `buildResult()` / `saveState()` — detail in private helpers
- No `new Notice()` in the flow — pushed into `buildResult()`
- No inline result construction, counting loops, or mapping manipulation

---

## Plan

### Task 1: Add `caldavUri` to CommonTask and update diff

**Files:**
- Modify: `src/sync/types.ts:4-16` (CommonTask interface)
- Modify: `src/sync/diff.ts:6-19` (tasksEqual — must NOT compare caldavUri)
- Modify: `src/sync/diff.test.ts` (add test that caldavUri difference doesn't trigger update)

**Step 1: Add `caldavUri` field to `CommonTask`**

In `src/sync/types.ts`, add after `uid`:
```ts
export interface CommonTask {
  uid: string;
  caldavUri: string | null;  // native CalDAV UID, null if not yet synced to CalDAV
  title: string;
  // ... rest unchanged
}
```

**Step 2: Ensure `tasksEqual` ignores `caldavUri`**

`tasksEqual` in `src/sync/diff.ts` already only compares specific fields (title, status, dates, priority, etc). Since `caldavUri` is identity metadata, not content, it should NOT be compared. Verify that the current field list doesn't include it — it shouldn't since we're adding a new field. No code change needed, just verify.

**Step 3: Add `caldavUri` to all test fixtures across the codebase**

Every `CommonTask` literal and helper that creates one needs `caldavUri: null` (or a value). This is a bulk update across test files. Use search to find all `CommonTask` object literals and add the field.

Files to update:
- `src/sync/diff.test.ts` — all `makeTask()` helpers and inline CommonTask objects
- `src/sync/syncEngine.test.ts` — baseline objects, inline CommonTask objects
- `src/sync/caldavAdapter.test.ts` — `fromCommonTask` test objects
- `src/sync/obsidianAdapter.test.ts` — any CommonTask assertions
- `test/e2e/syncRoundTrip.e2e.test.ts` — CommonTask objects

**Step 4: Add `caldavUri` in mappers that produce CommonTask**

- `src/tasks/obsidianMapper.ts` — `toCommonTask()` should set `caldavUri: null` (Obsidian tasks don't know their CalDAV UID at parse time)
- `src/caldav/vtodoMapper.ts` — `vtodoToTask()` returns `Omit<CommonTask, 'uid'>`, which will now also need `caldavUri: null` (the adapter sets it during normalize)

**Step 5: Run tests, fix any remaining compilation errors**

Run: `npm test`
Expected: All 311+ tests pass (some may need `caldavUri` added to assertions/fixtures)

**Step 6: Commit**

```
feat: add caldavUri to CommonTask for unified identity
```

---

### Task 2: Make CalDAVAdapter use baseline instead of uidMapping

**Files:**
- Modify: `src/sync/caldavAdapter.ts` — change `normalize()` and `applyChanges()` signatures
- Modify: `src/sync/caldavAdapter.test.ts` — update all tests
- Modify: `src/sync/syncEngine.ts` — update calls to adapter

**Step 1: Change `normalize()` to use baseline**

```ts
normalize(vtodos: CalendarObject[], baseline: CommonTask[]): CommonTask[] {
  const baselineByCaldavUri = new Map(
    baseline.filter(t => t.caldavUri).map(t => [t.caldavUri!, t])
  );

  const tasks: CommonTask[] = [];
  for (const vtodo of vtodos) {
    const caldavUri = this.mapper.extractUID(vtodo.data);
    if (!caldavUri) continue;

    const existing = baselineByCaldavUri.get(caldavUri);
    const uid = existing?.uid ?? caldavUri;

    tasks.push({ ...this.toCommonTask(vtodo, uid), caldavUri });
  }
  return tasks;
}
```

Key: if a task exists in baseline with this `caldavUri`, use its `uid` (the shared identity). Otherwise, use the CalDAV UID itself as the uid (new task from CalDAV).

**Step 2: Change `applyChanges()` to use baseline**

```ts
async applyChanges(
  changes: SyncChange[],
  client: CalDAVClient,
  baseline: CommonTask[],
): Promise<void> {
  for (const change of changes) {
    const caldavUri = this.resolveCaldavUri(change.task, baseline);
    // ... rest unchanged, just uses caldavUri
  }
}
```

Replace `resolveCaldavUID` (O(n) reverse lookup on Map) with:
```ts
private resolveCaldavUri(task: CommonTask, baseline: CommonTask[]): string {
  if (task.caldavUri) return task.caldavUri;
  const baselineTask = baseline.find(b => b.uid === task.uid);
  if (baselineTask?.caldavUri) return baselineTask.caldavUri;
  return `obsidian-${task.uid}`;
}
```

**Step 3: Update `toCommonTask()` to include `caldavUri`**

```ts
toCommonTask(vtodo: CalendarObject, uid: string): CommonTask {
  const parsed = this.mapper.vtodoToTask(vtodo);
  return {
    ...parsed,
    uid,
    caldavUri: this.mapper.extractUID(vtodo.data) || null,
    completedDate: parsed.completedDate ? parsed.completedDate.split('T')[0] : null,
  };
}
```

**Step 4: Update tests**

In `caldavAdapter.test.ts`:
- `normalize` tests: pass `CommonTask[]` baseline instead of `Map<string, string>` uidMapping
- `applyChanges` tests: pass `CommonTask[]` baseline instead of `Map<string, string>` uidMapping
- All `toCommonTask` assertions: add `caldavUri` to expected values

**Step 5: Update SyncEngine calls (temporary — will be cleaned further in Task 5)**

In `syncEngine.ts`:
- Replace `const uidMapping = this.buildUidMapping()` with using baseline directly
- Pass `baseline` to `caldavAdapter.normalize()` and `caldavAdapter.applyChanges()`
- Remove `buildUidMapping()` method

**Step 6: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```
refactor: CalDAVAdapter uses baseline instead of uidMapping
```

---

### Task 3: Adapters own their I/O — SyncEngine only talks to adapters

**Files:**
- Modify: `src/sync/caldavAdapter.ts` — constructor takes `CalDAVClientDirect`, add `fetchTasks(syncTag, baseline)`, move `filterByTag()` to private
- Modify: `src/sync/caldavAdapter.test.ts` — update constructor, add fetchTasks/filterByTag tests
- Modify: `src/sync/obsidianAdapter.ts` — constructor takes `ObsidianTasksWrapper`, add `fetchTasks(syncTag)`, internalize wrapper calls
- Modify: `src/sync/obsidianAdapter.test.ts` — update constructor, add fetchTasks tests
- Modify: `src/sync/syncEngine.ts` — pass I/O dependencies to adapter constructors, remove wrapper/client from sync(), remove `filterCalDAVBySyncTag()`
- Modify: `src/sync/syncEngine.test.ts` — update adapter construction, update filter tests

**Step 1: CalDAVAdapter takes client in constructor, add `fetchTasks()`**

```ts
export class CalDAVAdapter {
  private mapper: VTODOMapper;
  private client: CalDAVClientDirect;

  constructor(client: CalDAVClientDirect, mapper?: VTODOMapper) {
    this.client = client;
    this.mapper = mapper ?? new VTODOMapper();
  }

  async fetchTasks(syncTag: string | undefined, baseline: CommonTask[]): Promise<CommonTask[]> {
    await this.client.connect();
    const vtodos = await this.client.fetchVTODOs();
    const allTasks = this.normalize(vtodos, baseline);
    return this.filterByTag(allTasks, syncTag);
  }

  private filterByTag(tasks: CommonTask[], syncTag?: string): CommonTask[] {
    if (!syncTag || syncTag.trim() === '') return tasks;
    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return tasks.filter((task) =>
      task.tags.some((tag) => tag.toLowerCase() === tagLower)
    );
  }
  // normalize(), applyChanges() etc stay but no longer take client as param
}
```

`applyChanges` signature simplifies — no more client param:
```ts
async applyChanges(changes: SyncChange[], baseline: CommonTask[]): Promise<void>
```

**Step 2: ObsidianAdapter takes wrapper in constructor, add `fetchTasks()`**

```ts
export class ObsidianAdapter {
  private mapper: ObsidianMapper;
  private wrapper: ObsidianTasksWrapper;
  private tasksById = new Map<string, ObsidianTask>();

  constructor(wrapper: ObsidianTasksWrapper, mapper?: ObsidianMapper) {
    this.wrapper = wrapper;
    this.mapper = mapper ?? new ObsidianMapper();
  }

  async fetchTasks(syncTag?: string): Promise<CommonTask[]> {
    const allInputs = await this.wrapper.getAllTasksWithBody();
    const filtered = this.wrapper.filterByTag(allInputs, syncTag);
    return this.normalize(filtered);
  }
  // applyChanges(), writeBackIds() no longer take wrapper/settings params
}
```

`applyChanges` and `writeBackIds` simplify — no more wrapper param. Settings come from the adapter (passed at construction or via a method):

```ts
async applyChanges(changes: SyncChange[]): Promise<void>
async writeBackIds(obsidianTasks: CommonTask[]): Promise<void>
```

The adapter needs sync settings (syncTag, newTasksDestination, newTasksSection). Pass these at construction or via a `configure(settings)` method. Simplest: pass settings to the adapter constructor alongside the wrapper.

```ts
constructor(wrapper: ObsidianTasksWrapper, settings: SyncSettings, mapper?: ObsidianMapper)
```

Where `SyncSettings` is a subset of `CalDAVSettings`:
```ts
interface SyncSettings {
  syncTag?: string;
  newTasksDestination: string;
  newTasksSection?: string;
}
```

**Step 3: Update SyncEngine constructor**

```ts
constructor(app: App, settings: CalDAVSettings) {
  this.app = app;
  this.settings = settings;
  this.wrapper = new ObsidianTasksWrapper(app);
  this.caldavClient = new CalDAVClientDirect(settings);
  this.storage = new SyncStorage(app);
  this.caldavAdapter = new CalDAVAdapter(this.caldavClient);
  this.obsidianAdapter = new ObsidianAdapter(this.wrapper, {
    syncTag: settings.syncTag,
    newTasksDestination: settings.newTasksDestination,
    newTasksSection: settings.newTasksSection,
  });
}
```

SyncEngine still creates the client and wrapper (it needs wrapper for `initialize()`), but passes them to adapters. The `sync()` method only talks to adapters.

**Step 4: Remove `filterCalDAVBySyncTag()` from SyncEngine**

Delete entirely. Filtering is now inside adapters.

**Step 5: Update test "should include mapped CalDAV tasks even without the sync tag"**

This behavior is removed — tag is the only scope. Update test:

```ts
it('should exclude CalDAV tasks without the sync tag even if previously synced', async () => {
  const vtodo = makeCalObj('caldav-mapped', 'Mapped task');
  mockFetchVTODOs.mockResolvedValue([vtodo]);
  mockGetAllTasksWithBody.mockResolvedValue([]);
  mockGetBaseline.mockReturnValue([]);

  const engine = new SyncEngine(new App(), makeSettings({ syncTag: 'sync' }));
  await engine.initialize();
  const result = await engine.sync(true);

  expect(result.details.caldavTasks!.length).toBe(0);
});
```

**Step 6: Add unit tests for adapter fetch/filter**

In `caldavAdapter.test.ts`:
```ts
describe('fetchTasks', () => {
  it('should connect, fetch, normalize, and filter', () => { ... });
  it('should return all tasks when no syncTag', () => { ... });
  it('should filter by tag case-insensitively', () => { ... });
});
```

In `obsidianAdapter.test.ts`:
```ts
describe('fetchTasks', () => {
  it('should fetch, filter by tag, and normalize', () => { ... });
  it('should return all tasks when no syncTag', () => { ... });
});
```

**Step 7: Run tests**

Run: `npm test`

**Step 8: Commit**

```
refactor: adapters own I/O dependencies — SyncEngine only talks to adapters
```

---

### Task 4: Eliminate MappingData — baseline is the identity mapping

**Files:**
- Modify: `src/sync/syncEngine.ts` — remove all `this.storage.addTaskMapping()`, `removeTaskMapping()`, `getMapping()`, `buildUidMapping()`, `updateMappingsAfterSync()`
- Modify: `src/sync/syncEngine.test.ts` — remove mapping assertions, update baseline seeding test
- Modify: `src/storage/syncStorage.ts` — remove mapping methods (or keep for migration)
- Modify: `src/sync/obsidianAdapter.ts:53-55` — `applyChanges` no longer returns createdMappings
- Modify: `src/types.ts` — remove `MappingData`, `TaskMapping` (or keep for migration)

**Step 1: Update `ObsidianAdapter.applyChanges()` — set `caldavUri` on created tasks**

When creating a task in Obsidian from CalDAV, the task already has `caldavUri` set (it came from CalDAV). No mapping needed — the baseline will capture the relationship after sync.

Remove the return type of created mappings. The method no longer needs to return anything for mapping purposes:

```ts
async applyChanges(
  changes: SyncChange[],
  wrapper: ObsidianTasksWrapper,
  settings: { syncTag?: string; newTasksDestination: string; newTasksSection?: string },
): Promise<void> {
```

**Step 2: Update `CalDAVAdapter.applyChanges()` — set `caldavUri` on created tasks**

When creating a VTODO from an Obsidian task, the CalDAV UID is `obsidian-${task.uid}`. After creation, the task's `caldavUri` should be this value. But since CommonTask flows through the changeset, we need to ensure the `caldavUri` is set on the task before it enters the baseline.

In `computeNewBaseline()` (or its replacement), ensure tasks created on CalDAV get `caldavUri: 'obsidian-' + task.uid` and tasks created on Obsidian keep their existing `caldavUri`.

**Step 3: Remove mapping code from SyncEngine**

Remove from `sync()`:
- `const createdMappings = ...` and the loop that calls `addTaskMapping`
- The loop that calls `removeTaskMapping` for deletes
- `this.updateMappingsAfterSync(changeset)`
- The `updateMappingsAfterSync()` method entirely
- The `buildUidMapping()` method (already removed in Task 2)

Remove `seedBaselineFromMapping()` — this was a migration path from old mapping to baseline. Since we're eliminating mapping, this becomes dead code. If baseline is empty, it stays empty (first sync will treat everything as new).

**Step 4: Update `computeNewBaseline()` to set `caldavUri`**

```ts
private computeNewBaseline(
  obsidianTasks: CommonTask[],
  caldavTasks: CommonTask[],
  changeset: Changeset,
): CommonTask[] {
  const baselineMap = new Map<string, CommonTask>();

  for (const task of obsidianTasks) {
    baselineMap.set(task.uid, task);
  }

  for (const task of caldavTasks) {
    const existing = baselineMap.get(task.uid);
    if (existing) {
      // Merge caldavUri from CalDAV side into Obsidian-originated task
      if (!existing.caldavUri && task.caldavUri) {
        baselineMap.set(task.uid, { ...existing, caldavUri: task.caldavUri });
      }
    } else {
      baselineMap.set(task.uid, task);
    }
  }

  // Apply changeset (creates/updates/deletes)
  for (const change of [...changeset.toObsidian, ...changeset.toCalDAV]) {
    if (change.type === "delete") {
      baselineMap.delete(change.task.uid);
    } else {
      const existing = baselineMap.get(change.task.uid);
      baselineMap.set(change.task.uid, {
        ...change.task,
        // Preserve caldavUri if not set on the change task
        caldavUri: change.task.caldavUri ?? existing?.caldavUri ?? null,
      });
    }
  }

  // Ensure caldavUri for tasks created on CalDAV from Obsidian
  for (const change of changeset.toCalDAV) {
    if (change.type === "create") {
      const task = baselineMap.get(change.task.uid);
      if (task && !task.caldavUri) {
        baselineMap.set(task.uid, { ...task, caldavUri: `obsidian-${task.uid}` });
      }
    }
  }

  return Array.from(baselineMap.values());
}
```

**Step 5: Update SyncEngine tests**

- Remove `mockAddTaskMapping`, `mockRemoveTaskMapping` from mock setup
- Remove all `expect(mockAddTaskMapping)` / `expect(mockRemoveTaskMapping)` assertions
- Update "baseline seeding" tests — `seedBaselineFromMapping` is gone, first sync with empty baseline treats tasks as new
- Update "should remove mapping when deleting a task" → verify task is removed from baseline instead
- Update "should add mapping when creating task on CalDAV from Obsidian" → verify `caldavUri` is set in baseline

**Step 6: Clean up SyncStorage (keep for now, mark deprecated)**

Don't delete `mapping.json` support yet — existing users may have it. But remove calls from SyncEngine. The storage methods become dead code that can be cleaned up in a future PR.

**Step 7: Run tests**

Run: `npm test`

**Step 8: Commit**

```
refactor: eliminate uidMapping — baseline with caldavUri is the identity mapping
```

---

### Task 5: Clean up sync() — extract helpers, remove noise

**Files:**
- Modify: `src/sync/syncEngine.ts` — restructure sync(), add helper methods

**Step 1: Extract `getOrCreateBaseline()`**

```ts
private getOrCreateBaseline(): CommonTask[] {
  return this.storage.getBaseline();
}
```

This is a trivial wrapper now (no more seed-from-mapping logic). Keep it as a named method for readability and future extensibility.

**Step 2: Extract `getConflictStrategy()`**

```ts
private getConflictStrategy(): ConflictStrategy {
  return this.settings.autoResolveObsidianWins ? "obsidian-wins" : "caldav-wins";
}
```

**Step 3: Extract `buildResult()`**

```ts
private buildResult(changeset: Changeset, dryRun: boolean, context?: {
  obsidianTasks: CommonTask[];
  caldavTasks: CommonTask[];
  baseline: CommonTask[];
}): SyncResult {
  const result: SyncResult = {
    success: true,
    message: "",
    created: { toObsidian: 0, toCalDAV: 0 },
    updated: { toObsidian: 0, toCalDAV: 0 },
    deleted: { toObsidian: 0, toCalDAV: 0 },
    conflicts: changeset.conflicts.length,
    details: {
      toObsidian: changeset.toObsidian,
      toCalDAV: changeset.toCalDAV,
      conflictDetails: changeset.conflicts,
      obsidianTasks: context?.obsidianTasks,
      caldavTasks: context?.caldavTasks,
      baselineTasks: context?.baseline,
    },
  };

  for (const change of changeset.toObsidian) {
    result[change.type === "create" ? "created" : change.type === "update" ? "updated" : "deleted"].toObsidian++;
  }
  for (const change of changeset.toCalDAV) {
    result[change.type === "create" ? "created" : change.type === "update" ? "updated" : "deleted"].toCalDAV++;
  }

  if (dryRun) {
    result.message = `Dry run complete! Would sync:\n` +
      `From CalDAV: ${result.created.toObsidian} created, ${result.updated.toObsidian} updated, ${result.deleted.toObsidian} deleted\n` +
      `To CalDAV: ${result.created.toCalDAV} created, ${result.updated.toCalDAV} updated, ${result.deleted.toCalDAV} deleted\n` +
      `Conflicts: ${result.conflicts}\n\nNo changes were made.`;
    new Notice(result.message, 10000);
  } else {
    result.message = `Sync complete! ` +
      `From CalDAV: ${result.created.toObsidian}+${result.updated.toObsidian}+${result.deleted.toObsidian} | ` +
      `To CalDAV: ${result.created.toCalDAV}+${result.updated.toCalDAV}+${result.deleted.toCalDAV}`;
    new Notice(result.message, 5000);
  }

  return result;
}
```

**Step 4: Extract `saveState()`**

```ts
private async saveState(
  obsidianTasks: CommonTask[],
  caldavTasks: CommonTask[],
  changeset: Changeset,
): Promise<void> {
  const newBaseline = this.computeNewBaseline(obsidianTasks, caldavTasks, changeset);
  this.storage.setBaseline(newBaseline);
  this.storage.updateLastSyncTime();
  await this.storage.save();
}
```

**Step 5: Rewrite sync()**

```ts
async sync(dryRun = false): Promise<SyncResult> {
  try {
    new Notice(dryRun ? "[DRY RUN] Starting sync..." : "Starting sync...");
    const syncTag = this.settings.syncTag;
    const baseline = this.getOrCreateBaseline();

    const caldavTasks = await this.caldavAdapter.fetchTasks(syncTag, baseline);
    const obsidianTasks = await this.obsidianAdapter.fetchTasks(syncTag);

    const changeset = diff(obsidianTasks, caldavTasks, baseline, this.getConflictStrategy());
    const context = { obsidianTasks, caldavTasks, baseline };

    if (dryRun) return this.buildResult(changeset, true, context);

    await this.caldavAdapter.applyChanges(changeset.toCalDAV, baseline);
    await this.obsidianAdapter.applyChanges(changeset.toObsidian);
    await this.obsidianAdapter.writeBackIds(obsidianTasks);

    await this.saveState(obsidianTasks, caldavTasks, changeset);
    return this.buildResult(changeset, false, context);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const message = `Sync failed: ${errorMsg}`;
    new Notice(message, 8000);
    console.error("Sync error:", error);
    return {
      success: false,
      message,
      created: { toObsidian: 0, toCalDAV: 0 },
      updated: { toObsidian: 0, toCalDAV: 0 },
      deleted: { toObsidian: 0, toCalDAV: 0 },
      conflicts: 0,
      details: { toObsidian: [], toCalDAV: [], conflictDetails: [] },
    };
  }
}
```

**Step 6: Remove dead methods**

Delete: `filterCalDAVBySyncTag`, `updateMappingsAfterSync`, `buildUidMapping`, `seedBaselineFromMapping`.

**Step 7: Run tests**

Run: `npm test`

**Step 9: Commit**

```
refactor: clean sync() — extract helpers, remove noise
```

---

### Task 6: Update CLAUDE.md with code style guideline and architecture

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add clean code guideline**

Add under `## Coding Standards` a new subsection:

```markdown
### Clean code
- **Self-documenting** — if code needs a comment, rename the variable or extract a method instead
- **Push logic to the edges** — filtering, ID resolution, data shaping belong in adapters and I/O layers, not the orchestrator
- **One intent per line** — each line in an orchestrator method should express a single, clear action
- **No inline noise** — Notice calls, counting loops, string formatting go into private helpers
- **Methods as documentation** — `getOrCreateBaseline()` reads better than a 6-line if/else with a comment
- **No special-case accumulation** — if you find yourself adding "also include X when Y", question whether the abstraction is right
```

**Step 2: Update architecture diagram**

Update the mermaid diagram to reflect that `CommonTask.caldavUri` provides identity mapping and baseline replaces mapping.json.

**Step 3: Commit**

```
docs: add clean code guideline, update architecture diagram
```

---

### Task 7: Update E2E test

**Files:**
- Modify: `test/e2e/syncRoundTrip.e2e.test.ts`

**Step 1: Add `caldavUri` to CommonTask fixtures in E2E**

All CommonTask objects need the `caldavUri` field. CalDAV-originated tasks will have it set, Obsidian-originated tasks will have `null`.

**Step 2: Run full test suite including E2E**

Run: `npm test`
Expected: All tests pass including E2E

**Step 3: Commit**

```
test: update E2E tests for caldavUri field
```

---

## Verification

1. `npm test` — all tests pass with coverage thresholds
2. `npm run build` — no type errors
3. `npm run lint` — no lint errors
4. Read `sync()` — should be ~25 lines (including error handling), each line self-explanatory

## Files changed summary

| File | Change |
|------|--------|
| `src/sync/types.ts` | Add `caldavUri: string \| null` to CommonTask |
| `src/sync/diff.ts` | Verify `tasksEqual` doesn't compare `caldavUri` |
| `src/sync/caldavAdapter.ts` | Constructor takes client, add `fetchTasks()`, private `filterByTag()`, `applyChanges` no longer takes client |
| `src/sync/obsidianAdapter.ts` | Constructor takes wrapper+settings, add `fetchTasks()`, `applyChanges`/`writeBackIds` no longer take wrapper |
| `src/sync/syncEngine.ts` | Clean sync(), extract helpers, remove mapping code, remove filtering, pass deps to adapter constructors |
| `src/tasks/obsidianMapper.ts` | Add `caldavUri: null` in `toCommonTask()` |
| `src/caldav/vtodoMapper.ts` | Add `caldavUri: null` in `vtodoToTask()` return type |
| `src/storage/syncStorage.ts` | Mapping methods become dead code (remove later) |
| `CLAUDE.md` | Add clean code guideline, update diagram |
| `src/sync/diff.test.ts` | Add `caldavUri` to fixtures |
| `src/sync/caldavAdapter.test.ts` | Update for baseline-based API, add filterByTag tests |
| `src/sync/obsidianAdapter.test.ts` | Update for void applyChanges |
| `src/sync/syncEngine.test.ts` | Remove mapping assertions, update baseline/filter tests |
| `src/tasks/obsidianTasksWrapper.test.ts` | Add getFilteredTasksWithBody tests |
| `test/e2e/syncRoundTrip.e2e.test.ts` | Add `caldavUri` to fixtures |

## Migration note

Existing users have `mapping.json` files. The mapping storage methods are kept but unused. On first sync after this change, baseline will be empty → all tasks treated as new → diff will create on both sides. This is acceptable for a dev branch. Before merging to master, consider adding a one-time migration that converts `mapping.json` → baseline entries with `caldavUri`.
