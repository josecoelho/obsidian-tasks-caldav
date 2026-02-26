# Clean sync() + lean IdMapping

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `sync()` readable at a glance and replace bloated `MappingData` with a lean `IdMapping` (two bidirectional lookup tables).

**Architecture:** `CommonTask` stays clean — no side-specific fields. A new `IdMapping` type (`taskId ↔ caldavUid` bidirectional) replaces `MappingData`/`mapping.json`. Adapters own their I/O dependencies and expose `fetchTasks()`. `sync()` becomes a short orchestrator that only talks to adapters and storage.

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

## New type: IdMapping

```ts
/** Lean bidirectional identity mapping between Obsidian task IDs and CalDAV UIDs. */
export interface IdMapping {
  taskIdToCaldavUid: Record<string, string>;
  caldavUidToTaskId: Record<string, string>;
}
```

This replaces the bloated `MappingData` (which had timestamps, sourceFiles, etc.). Two simple lookup tables — that's all identity resolution needs.

---

## Target sync() shape

```ts
async sync(dryRun = false): Promise<SyncResult> {
  try {
    const syncTag = this.settings.syncTag;
    const baseline = this.storage.getBaseline();
    const idMapping = this.storage.getIdMapping();

    const caldavTasks = await this.caldavAdapter.fetchTasks(syncTag, idMapping);
    const obsidianTasks = await this.obsidianAdapter.fetchTasks(syncTag);

    const changeset = diff(obsidianTasks, caldavTasks, baseline, this.getConflictStrategy());

    if (dryRun) return this.buildResult(changeset, true);

    await this.obsidianAdapter.applyChanges(changeset.toObsidian);
    await this.caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);
    await this.obsidianAdapter.writeBackIds(obsidianTasks);

    this.updateIdMapping(changeset, idMapping);
    await this.saveState(obsidianTasks, caldavTasks, changeset);
    return this.buildResult(changeset, false);
  } catch (error) {
    return this.buildErrorResult(error);
  }
}
```

Key differences from current:
- **SyncEngine doesn't know about CalDAV clients or wrappers** — adapters receive their I/O dependencies in the constructor
- **Adapters own the full pipeline** — `fetchTasks()` does connect + fetch + normalize + filter internally
- **CommonTask stays clean** — no `caldavUri`, no side-specific fields
- **IdMapping replaces MappingData** — lean bidirectional lookup, no timestamps/sourceFiles
- `applyChanges()` and `writeBackIds()` don't take wrapper/settings params — adapters already have them
- `getConflictStrategy()` / `buildResult()` / `saveState()` / `updateIdMapping()` — detail in private helpers
- No `new Notice()` in the flow — pushed into `buildResult()`
- No inline result construction, counting loops, or mapping manipulation

---

## Plan

### Task 1: Add `IdMapping` type and storage support

**Files:**
- Modify: `src/types.ts` — add `IdMapping` interface
- Modify: `src/storage/syncStorage.ts` — add `getIdMapping()`, `setIdMapping()`, `migrateFromMappingData()`
- Create: `src/storage/syncStorage.test.ts` — test IdMapping persistence and migration

**Step 1: Write failing test for IdMapping storage**

In `src/storage/syncStorage.test.ts` (new file — or add to existing if one exists):

```ts
describe('IdMapping', () => {
  it('should return empty IdMapping when no data exists', () => {
    const idMapping = storage.getIdMapping();
    expect(idMapping).toEqual({
      taskIdToCaldavUid: {},
      caldavUidToTaskId: {},
    });
  });

  it('should persist and retrieve IdMapping', async () => {
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { 'task-1': 'caldav-uid-1' },
      caldavUidToTaskId: { 'caldav-uid-1': 'task-1' },
    };
    storage.setIdMapping(idMapping);
    await storage.save();
    // re-load and verify
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern syncStorage`
Expected: FAIL — `getIdMapping` doesn't exist

**Step 3: Add `IdMapping` to types.ts**

In `src/types.ts`, add:
```ts
/** Lean bidirectional identity mapping between Obsidian task IDs and CalDAV UIDs. */
export interface IdMapping {
  taskIdToCaldavUid: Record<string, string>;
  caldavUidToTaskId: Record<string, string>;
}
```

**Step 4: Add `getIdMapping()` / `setIdMapping()` to SyncStorage**

```ts
private idMappingPath: string; // '.caldav-sync/id-mapping.json'
private idMappingCache: IdMapping | null = null;
private idMappingDirty: boolean = false;

getIdMapping(): IdMapping {
  return this.idMappingCache ?? { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
}

setIdMapping(idMapping: IdMapping): void {
  this.idMappingCache = idMapping;
  this.idMappingDirty = true;
}
```

Update `initialize()` to load id-mapping.json, update `save()` to persist it.

**Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern syncStorage`
Expected: PASS

**Step 6: Write migration test**

```ts
describe('migrateFromMappingData', () => {
  it('should convert MappingData to IdMapping', () => {
    // Setup: mapping.json has { tasks: { 'task-1': { caldavUID: 'cal-1', ... } } }
    // After migration: idMapping has { taskIdToCaldavUid: { 'task-1': 'cal-1' }, caldavUidToTaskId: { 'cal-1': 'task-1' } }
  });

  it('should skip when IdMapping already has entries', () => { });
  it('should skip when MappingData is empty', () => { });
});
```

**Step 7: Implement `migrateFromMappingData()`**

```ts
/**
 * One-time migration: convert bloated MappingData → lean IdMapping.
 * Safe to call multiple times — skips if IdMapping already has entries.
 */
migrateFromMappingData(): void {
  const idMapping = this.getIdMapping();
  if (Object.keys(idMapping.taskIdToCaldavUid).length > 0) return;

  const mapping = this.getMapping();
  if (Object.keys(mapping.tasks).length === 0) return;

  const migrated: IdMapping = {
    taskIdToCaldavUid: {},
    caldavUidToTaskId: {},
  };

  for (const [taskId, taskMapping] of Object.entries(mapping.tasks)) {
    migrated.taskIdToCaldavUid[taskId] = taskMapping.caldavUID;
    migrated.caldavUidToTaskId[taskMapping.caldavUID] = taskId;
  }

  this.setIdMapping(migrated);
}
```

**Step 8: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 9: Commit**

```
feat: add IdMapping type and storage with migration from MappingData
```

---

### Task 2: Make CalDAVAdapter use IdMapping instead of uidMapping

**Files:**
- Modify: `src/sync/caldavAdapter.ts` — change `normalize()` and `applyChanges()` signatures
- Modify: `src/sync/caldavAdapter.test.ts` — update all tests
- Modify: `src/sync/syncEngine.ts` — update calls to adapter

**Step 1: Update `normalize()` to accept `IdMapping`**

```ts
normalize(vtodos: CalendarObject[], idMapping: IdMapping): CommonTask[] {
  const tasks: CommonTask[] = [];
  for (const vtodo of vtodos) {
    const caldavUid = this.mapper.extractUID(vtodo.data);
    if (!caldavUid) continue;

    // Use existing taskId from mapping, or use caldavUid as the uid for new tasks
    const uid = idMapping.caldavUidToTaskId[caldavUid] ?? caldavUid;
    tasks.push(this.toCommonTask(vtodo, uid));
  }
  return tasks;
}
```

Key: if a CalDAV task has a known mapping, use the Obsidian taskId as `uid`. Otherwise use the CalDAV UID itself (new task from CalDAV).

**Step 2: Update `applyChanges()` to accept `IdMapping`**

```ts
async applyChanges(
  changes: SyncChange[],
  client: CalDAVClient,
  idMapping: IdMapping,
): Promise<void> {
  for (const change of changes) {
    const caldavUid = this.resolveCaldavUid(change.task.uid, idMapping);
    // ... rest unchanged, just uses caldavUid
  }
}
```

Replace the old `resolveCaldavUID` (O(n) reverse lookup on `Map<string, string>`) with:
```ts
private resolveCaldavUid(taskUid: string, idMapping: IdMapping): string {
  return idMapping.taskIdToCaldavUid[taskUid] ?? `obsidian-${taskUid}`;
}
```

**Step 3: Update tests**

In `caldavAdapter.test.ts`:
- `normalize` tests: pass `IdMapping` instead of `Map<string, string>`
- `applyChanges` tests: pass `IdMapping` instead of `Map<string, string>`

**Step 4: Update SyncEngine calls (temporary — will be cleaned further in Task 4)**

In `syncEngine.ts`:
- Replace `const uidMapping = this.buildUidMapping()` with `const idMapping = this.storage.getIdMapping()`
- Pass `idMapping` to `caldavAdapter.normalize()` and `caldavAdapter.applyChanges()`
- Remove `buildUidMapping()` method

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
refactor: CalDAVAdapter uses IdMapping instead of uidMapping
```

---

### Task 3: Adapters own their I/O — SyncEngine only talks to adapters

**Files:**
- Modify: `src/sync/caldavAdapter.ts` — constructor takes `CalDAVClientDirect`, add `fetchTasks()`, move `filterByTag()` to private
- Modify: `src/sync/caldavAdapter.test.ts` — update constructor, add fetchTasks/filterByTag tests
- Modify: `src/sync/obsidianAdapter.ts` — constructor takes `ObsidianTasksWrapper` + settings, add `fetchTasks()`, internalize wrapper/settings calls
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

  async fetchTasks(syncTag: string | undefined, idMapping: IdMapping): Promise<CommonTask[]> {
    await this.client.connect();
    const vtodos = await this.client.fetchVTODOs();
    const allTasks = this.normalize(vtodos, idMapping);
    return this.filterByTag(allTasks, syncTag);
  }

  private filterByTag(tasks: CommonTask[], syncTag?: string): CommonTask[] {
    if (!syncTag || syncTag.trim() === '') return tasks;
    const tagLower = syncTag.toLowerCase().replace(/^#/, '');
    return tasks.filter((task) =>
      task.tags.some((tag) => tag.toLowerCase() === tagLower)
    );
  }
  // normalize(), applyChanges() etc stay but applyChanges no longer takes client param
}
```

`applyChanges` signature simplifies — no more client param:
```ts
async applyChanges(changes: SyncChange[], idMapping: IdMapping): Promise<void>
```

**Step 2: ObsidianAdapter takes wrapper + settings in constructor, add `fetchTasks()`**

```ts
interface ObsidianSyncSettings {
  syncTag?: string;
  newTasksDestination: string;
  newTasksSection?: string;
}

export class ObsidianAdapter {
  private mapper: ObsidianMapper;
  private wrapper: ObsidianTasksWrapper;
  private settings: ObsidianSyncSettings;
  private tasksById = new Map<string, ObsidianTask>();

  constructor(wrapper: ObsidianTasksWrapper, settings: ObsidianSyncSettings, mapper?: ObsidianMapper) {
    this.wrapper = wrapper;
    this.settings = settings;
    this.mapper = mapper ?? new ObsidianMapper();
  }

  async fetchTasks(syncTag?: string): Promise<CommonTask[]> {
    const allInputs = await this.wrapper.getAllTasksWithBody();
    const filtered = this.wrapper.filterByTag(allInputs, syncTag);
    return this.normalize(filtered, (task) => this.wrapper.extractId(task));
  }

  // applyChanges() and writeBackIds() no longer take wrapper/settings params
  async applyChanges(changes: SyncChange[]): Promise<void>
  async writeBackIds(obsidianTasks: CommonTask[]): Promise<void>
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
  // Previously-mapped task without the tag should NOT be included
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

### Task 4: Eliminate MappingData from SyncEngine — use IdMapping

**Files:**
- Modify: `src/sync/syncEngine.ts` — remove all `this.storage.addTaskMapping()`, `removeTaskMapping()`, `getMapping()`, `updateMappingsAfterSync()`, `seedBaselineFromMapping()`; add `updateIdMapping()` helper
- Modify: `src/sync/syncEngine.test.ts` — remove mapping assertions, update baseline seeding test
- Modify: `src/sync/obsidianAdapter.ts` — `applyChanges` no longer returns createdMappings

**Step 1: Add `updateIdMapping()` helper to SyncEngine**

```ts
private updateIdMapping(
  changeset: { toCalDAV: SyncChange[]; toObsidian: SyncChange[] },
  idMapping: IdMapping,
): void {
  // Tasks created on CalDAV from Obsidian: add taskId→caldavUid
  for (const change of changeset.toCalDAV) {
    if (change.type === 'create') {
      const caldavUid = `obsidian-${change.task.uid}`;
      idMapping.taskIdToCaldavUid[change.task.uid] = caldavUid;
      idMapping.caldavUidToTaskId[caldavUid] = change.task.uid;
    }
    if (change.type === 'delete') {
      const caldavUid = idMapping.taskIdToCaldavUid[change.task.uid];
      if (caldavUid) {
        delete idMapping.taskIdToCaldavUid[change.task.uid];
        delete idMapping.caldavUidToTaskId[caldavUid];
      }
    }
  }

  // Tasks created in Obsidian from CalDAV: add taskId→caldavUid
  for (const change of changeset.toObsidian) {
    if (change.type === 'create') {
      // The task.uid is already the CalDAV UID (assigned during normalize when no mapping existed)
      // The new Obsidian task gets a generated ID — but we need to track it after writeBackIds
      // Actually: the CalDAV task's uid IS the caldavUid (since no mapping existed),
      // and the new Obsidian task will get a generated taskId during applyChanges.
      // This mapping is handled by applyChanges returning the created taskId.
    }
    if (change.type === 'delete') {
      const caldavUid = idMapping.taskIdToCaldavUid[change.task.uid];
      if (caldavUid) {
        delete idMapping.taskIdToCaldavUid[change.task.uid];
        delete idMapping.caldavUidToTaskId[caldavUid];
      }
    }
  }

  this.storage.setIdMapping(idMapping);
}
```

Note: For tasks created in Obsidian from CalDAV, `ObsidianAdapter.applyChanges()` generates a new taskId and creates the task. It should return the mapping info so SyncEngine can update IdMapping:

```ts
// ObsidianAdapter.applyChanges returns created task ID mappings
async applyChanges(changes: SyncChange[]): Promise<Array<{ taskId: string; caldavUid: string }>> {
  const created: Array<{ taskId: string; caldavUid: string }> = [];
  for (const change of changes) {
    if (change.type === 'create') {
      const taskId = generateTaskId();
      // ... create task in vault ...
      created.push({ taskId, caldavUid: change.task.uid });
    }
    // ... update, delete ...
  }
  return created;
}
```

Then in `updateIdMapping()`:
```ts
// Add mappings from tasks created in Obsidian from CalDAV
for (const { taskId, caldavUid } of createdInObsidian) {
  idMapping.taskIdToCaldavUid[taskId] = caldavUid;
  idMapping.caldavUidToTaskId[caldavUid] = taskId;
}
```

**Step 2: Update `ObsidianAdapter.applyChanges()` return type**

Change from returning `Array<{ taskId: string; caldavUID: string; sourceFile: string }>` to `Array<{ taskId: string; caldavUid: string }>`. Drop `sourceFile` — not needed for IdMapping.

**Step 3: Remove dead mapping code from SyncEngine**

Remove from `sync()`:
- `const createdMappings = ...` and the loop that calls `addTaskMapping`
- The loop that calls `removeTaskMapping` for deletes
- `this.updateMappingsAfterSync(changeset)`

Remove methods:
- `updateMappingsAfterSync()` — replaced by `updateIdMapping()`
- `seedBaselineFromMapping()` — no longer needed (IdMapping handles identity, baseline handles diff)
- `buildUidMapping()` — already removed in Task 2

**Step 4: Update SyncEngine tests**

- Remove `mockAddTaskMapping`, `mockRemoveTaskMapping` from mock setup
- Remove all `expect(mockAddTaskMapping)` / `expect(mockRemoveTaskMapping)` assertions
- Update "baseline seeding" tests — `seedBaselineFromMapping` is gone, first sync with empty baseline treats tasks as new
- Add tests for `updateIdMapping`:
  - "should add mapping when creating task on CalDAV from Obsidian"
  - "should add mapping when creating task in Obsidian from CalDAV"
  - "should remove mapping on delete"

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
refactor: eliminate MappingData from SyncEngine — use lean IdMapping
```

---

### Task 5: Clean up sync() — extract helpers, remove noise

**Files:**
- Modify: `src/sync/syncEngine.ts` — restructure sync(), add helper methods

**Step 1: Extract `getConflictStrategy()`**

```ts
private getConflictStrategy(): ConflictStrategy {
  return this.settings.autoResolveObsidianWins ? "obsidian-wins" : "caldav-wins";
}
```

**Step 2: Extract `buildResult()` and `buildErrorResult()`**

```ts
private buildResult(changeset: Changeset, dryRun: boolean, context?: {
  obsidianTasks: CommonTask[];
  caldavTasks: CommonTask[];
  baseline: CommonTask[];
}): SyncResult {
  const result: SyncResult = { /* ... count changes, build message, Notice ... */ };
  return result;
}

private buildErrorResult(error: unknown): SyncResult {
  const errorMsg = error instanceof Error ? error.message : "Unknown error";
  const message = `Sync failed: ${errorMsg}`;
  new Notice(message, 8000);
  console.error("Sync error:", error);
  return { success: false, message, /* zeros */ };
}
```

**Step 3: Extract `saveState()`**

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

**Step 4: Rewrite sync()**

```ts
async sync(dryRun = false): Promise<SyncResult> {
  try {
    new Notice(dryRun ? "[DRY RUN] Starting sync..." : "Starting sync...");
    const syncTag = this.settings.syncTag;
    const baseline = this.storage.getBaseline();
    const idMapping = this.storage.getIdMapping();

    const caldavTasks = await this.caldavAdapter.fetchTasks(syncTag, idMapping);
    const obsidianTasks = await this.obsidianAdapter.fetchTasks(syncTag);

    const changeset = diff(obsidianTasks, caldavTasks, baseline, this.getConflictStrategy());
    const context = { obsidianTasks, caldavTasks, baseline };

    if (dryRun) return this.buildResult(changeset, true, context);

    await this.obsidianAdapter.applyChanges(changeset.toObsidian);
    const createdInObsidian = /* from applyChanges return */;
    await this.caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);
    await this.obsidianAdapter.writeBackIds(obsidianTasks);

    this.updateIdMapping(changeset, idMapping, createdInObsidian);
    await this.saveState(obsidianTasks, caldavTasks, changeset);
    return this.buildResult(changeset, false, context);
  } catch (error) {
    return this.buildErrorResult(error);
  }
}
```

**Step 5: Remove dead methods**

Delete: `filterCalDAVBySyncTag` (if not already removed in Task 3), `seedBaselineFromMapping` (if not already removed in Task 4).

**Step 6: Run tests**

Run: `npm test`

**Step 7: Commit**

```
refactor: clean sync() — extract helpers, remove noise
```

---

### Task 6: Mark old mapping methods as deprecated

**Files:**
- Modify: `src/storage/syncStorage.ts` — mark `getMapping()` and all mapping-specific methods as `@deprecated`
- Modify: `src/types.ts` — mark `MappingData`, `TaskMapping` as `@deprecated`

**Step 1: Add `@deprecated` to mapping methods**

```ts
/** @deprecated Use getIdMapping() instead. Kept for migration. */
getMapping(): MappingData { ... }

/** @deprecated Use setIdMapping() instead. */
addTaskMapping(...): void { ... }

/** @deprecated Use setIdMapping() instead. */
removeTaskMapping(...): void { ... }
```

Also mark in `src/types.ts`:
```ts
/** @deprecated Use IdMapping instead. */
export interface TaskMapping { ... }

/** @deprecated Use IdMapping instead. */
export interface MappingData { ... }
```

**Step 2: Call migration during SyncEngine.initialize()**

```ts
async initialize(): Promise<boolean> {
  const wrapperReady = this.wrapper.initialize();
  if (!wrapperReady) {
    new Notice("obsidian-tasks plugin required for sync");
    return false;
  }

  await this.storage.initialize();
  this.storage.migrateFromMappingData();
  return true;
}
```

**Step 3: Run tests**

Run: `npm test`

**Step 4: Commit**

```
refactor: deprecate MappingData, add migration to IdMapping on initialize
```

---

### Task 7: Update CLAUDE.md with code style guideline and architecture

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add clean code guideline**

Add under `## Coding Standards` a new subsection with the guideline from the top of this plan.

**Step 2: Update architecture description**

Update `### Key Patterns` or add new section to reflect:
- Adapters own I/O dependencies (constructor injection)
- `sync()` is a short orchestrator that only talks to adapters
- `IdMapping` for identity resolution between systems
- Baseline for three-way diff

**Step 3: Commit**

```
docs: add clean code guideline, update architecture
```

---

### Task 8: Update E2E test

**Files:**
- Modify: `test/e2e/syncRoundTrip.e2e.test.ts`

**Step 1: Update E2E for new adapter APIs**

- Update any direct adapter construction to pass I/O dependencies
- Update any uidMapping references to use IdMapping
- Verify round-trip still works: create in Obsidian → sync to CalDAV → modify in CalDAV → sync back

**Step 2: Run full test suite including E2E**

Run: `npm test`
Expected: All tests pass including E2E

**Step 3: Commit**

```
test: update E2E tests for IdMapping and adapter I/O ownership
```

---

## Verification

1. `npm test` — all tests pass with coverage thresholds
2. `npm run build` — no type errors
3. `npm run lint` — no lint errors
4. Read `sync()` — should be ~20 lines (including error handling), each line self-explanatory

## Files changed summary

| File | Change |
|------|--------|
| `src/types.ts` | Add `IdMapping` interface, deprecate `MappingData`/`TaskMapping` |
| `src/sync/caldavAdapter.ts` | Constructor takes client, add `fetchTasks()`, private `filterByTag()`, use `IdMapping` |
| `src/sync/obsidianAdapter.ts` | Constructor takes wrapper+settings, add `fetchTasks()`, simplify `applyChanges`/`writeBackIds` |
| `src/sync/syncEngine.ts` | Clean sync(), extract helpers, use IdMapping, remove old mapping code, remove filtering |
| `src/storage/syncStorage.ts` | Add `getIdMapping()`/`setIdMapping()`/`migrateFromMappingData()`, deprecate mapping methods |
| `CLAUDE.md` | Add clean code guideline, update architecture |
| `src/sync/caldavAdapter.test.ts` | Update for IdMapping-based API, add filterByTag/fetchTasks tests |
| `src/sync/obsidianAdapter.test.ts` | Update for constructor injection, add fetchTasks tests |
| `src/sync/syncEngine.test.ts` | Remove mapping assertions, update baseline/filter tests, add IdMapping tests |
| `src/storage/syncStorage.test.ts` | New: IdMapping persistence and migration tests |
| `test/e2e/syncRoundTrip.e2e.test.ts` | Update for IdMapping and adapter constructor changes |

## Migration

Handled in Task 1 (storage) + Task 6 (wiring). On `initialize()`, `SyncStorage.migrateFromMappingData()` converts the bloated `MappingData` (from `mapping.json`) into a lean `IdMapping` (in `id-mapping.json`). Safe to call multiple times — skips if IdMapping already has entries. After migration, `mapping.json` is still on disk but no longer read by sync logic. Old mapping types and methods are marked `@deprecated`.
