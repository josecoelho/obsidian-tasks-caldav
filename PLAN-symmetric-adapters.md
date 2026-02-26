# Symmetric adapters + ObsidianMapper + VTODOMapper cleanup

## Current architecture (asymmetric)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SyncEngine                                 │
│  sync() → normalize both sides → diff() → apply both sides         │
│                                                                     │
│  ⚠️  applyObsidianChanges() lives HERE (should be on adapter)      │
│  ⚠️  writeBackIds() lives HERE (should be on adapter)              │
│  ⚠️  generateTaskId() called HERE (should be on adapter)           │
└────────────┬──────────────────────────────────────────────────────────┘
             │                                  │
     ┌───────▼────────┐               ┌────────▼─────────┐
     │  CalDAV side    │               │  Obsidian side   │
     │  (3 layers ✓)  │               │  (2 layers ✗)    │
     └───────┬────────┘               └────────┬─────────┘
             │                                  │
  ┌──────────▼──────────┐           ┌───────────▼───────────┐
  │    CalDAVAdapter     │           │   ObsidianAdapter     │
  │  (orchestrator)      │           │  ⚠️ parse+serialize   │
  │                      │           │  ⚠️ mapping helpers   │
  │  normalize()         │           │  ⚠️ NO applyChanges   │
  │  toCommonTask()      │           │                       │
  │  fromCommonTask()    │           │  normalize()           │
  │  applyChanges() ✓   │           │  toCommonTask()        │
  └──────────┬──────────┘           │  toMarkdown()          │
             │                       │  toTaskFields()        │
  ┌──────────▼──────────┐           │  getContentHash()      │
  │    VTODOMapper       │           │  + 8 private helpers   │
  │  (parse+serialize)   │           └───────────┬───────────┘
  │                      │                       │
  │  vtodoToTask()       │           ┌───────────▼───────────┐
  │  taskToVTODO()       │           │ ObsidianTasksWrapper   │
  │  extractUID()        │           │  (I/O + filtering)     │
  │                      │           │                        │
  │  ⚠️ defines its own  │           │  getAllTasks()          │
  │  "ObsidianTask" DTO  │           │  createTask()          │
  │  (confusing name,    │           │  updateTaskInVault()   │
  │   ≈ CommonTask)      │           │  filterByTag()         │
  └──────────┬──────────┘           │  extractBodyFromFile() │
             │                       └────────────────────────┘
  ┌──────────▼──────────┐
  │  CalDAVClientDirect  │
  │  (I/O)               │
  │                      │
  │  connect()           │
  │  fetchVTODOs()       │
  │  createVTODO()       │
  │  updateVTODO()       │
  │  deleteVTODOByUID()  │
  └─────────────────────┘
```

### Problems

1. **No mapper on Obsidian side** — parse+serialize logic is on the adapter, not a dedicated mapper
2. **VTODOMapper defines `ObsidianTask`** — confusing name, nearly identical to `CommonTask`
3. **SyncEngine does Obsidian apply/writeback** — should be on adapter like CalDAV side
4. **No `complete` action** — completing a task should call obsidian-tasks API, not just rewrite markdown

---

## Target architecture (symmetric)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SyncEngine                                 │
│  sync() → normalize both sides → diff() → apply both sides         │
│                                                                     │
│  THIN orchestrator only:                                            │
│    caldavAdapter.applyChanges(toCalDAV, client, uidMapping)         │
│    obsidianAdapter.applyChanges(toObsidian, wrapper, tasksById, …)  │
│    obsidianAdapter.writeBackIds(obsidianTasks, tasksById, wrapper, …)│
└────────────┬──────────────────────────────────────────────────────────┘
             │                                  │
     ┌───────▼────────┐               ┌────────▼─────────┐
     │  CalDAV side    │               │  Obsidian side   │
     │  (3 layers)     │               │  (3 layers)      │
     └───────┬────────┘               └────────┬─────────┘
             │                                  │
  ┌──────────▼──────────┐           ┌───────────▼───────────┐
  │    CalDAVAdapter     │           │   ObsidianAdapter     │
  │  (orchestrator)      │           │  (orchestrator)        │
  │                      │           │                        │
  │  normalize()         │           │  normalize()            │
  │  toCommonTask()      │           │  applyChanges()    NEW │
  │  fromCommonTask()    │           │  writeBackIds()    NEW │
  │  applyChanges()      │           │                        │
  └──────────┬──────────┘           └───────────┬───────────┘
             │                                   │
  ┌──────────▼──────────┐           ┌────────────▼──────────┐
  │    VTODOMapper       │           │   ObsidianMapper  NEW │
  │  (parse+serialize)   │           │  (parse+serialize)     │
  │                      │           │                        │
  │  vtodoToTask()       │           │  toCommonTask()        │
  │    → CommonTask      │           │    ObsidianTask →      │
  │  taskToVTODO()       │           │    CommonTask          │
  │    CommonTask →      │           │  toMarkdown()          │
  │    iCal string       │           │    CommonTask →        │
  │                      │           │    markdown string     │
  │  Uses CommonTask     │           │  getContentHash()      │
  │  directly (no more   │           │                        │
  │  local ObsidianTask) │           │  Can't instantiate     │
  └──────────┬──────────┘           │  obsidian-tasks Task   │
             │                       │  objects — read only   │
  ┌──────────▼──────────┐           └────────────┬──────────┘
  │  CalDAVClientDirect  │                        │
  │  (I/O)               │           ┌────────────▼──────────┐
  │                      │           │ ObsidianTasksWrapper   │
  │  connect()           │           │  (I/O)                 │
  │  fetchVTODOs()       │           │                        │
  │  createVTODO()       │           │  getAllTasks()          │
  │  updateVTODO()       │           │  createTask()          │
  │  deleteVTODOByUID()  │           │  updateTaskInVault()   │
  └─────────────────────┘           │  toggleTaskDone() FUTURE│
                                     │  filterByTag()         │
                                     │  extractBodyFromFile() │
                                     └────────────────────────┘
```

### Layer responsibilities (identical on both sides)

| Layer | CalDAV | Obsidian | Does what |
|-------|--------|----------|-----------|
| **Mapper** | VTODOMapper | ObsidianMapper | Parse native → CommonTask, serialize CommonTask → native string. Pure data transformation. No I/O. |
| **Adapter** | CalDAVAdapter | ObsidianAdapter | Orchestrate. `normalize()` to build CommonTask[]. `applyChanges()` to loop create/update/delete. Calls mapper for data, client/wrapper for I/O. |
| **Client/Wrapper** | CalDAVClientDirect | ObsidianTasksWrapper | I/O only. Read/write to server or vault. No knowledge of CommonTask or sync logic. |

---

## In-memory ID flow

Tasks without IDs get temporary in-memory IDs during sync. These must be written back to vault only after sync succeeds.

```
Step 3d (SyncEngine):
  for each obsidian task:
    taskId = wrapper.extractId(task) ?? generateTaskId()
                                        ^^^^^^^^^^^^^^^^
                                        IN-MEMORY ONLY
                                        not yet in vault

Step 3e: adapter.normalize() uses these in-memory IDs as CommonTask.uid
Step 5:  diff() sees them as regular task UIDs
Step 6:  adapter.applyChanges() — creates/updates use in-memory IDs for 🆔

Step 8 (writeBackIds):
  for each task where original had NO id:
    mapper.toMarkdown(commonTask, syncTag) → markdown with 🆔 in-memory-id
    wrapper.updateTaskInVault(originalTask, markdown)
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    NOW the in-memory ID is persisted in vault

  ⚠️ Only runs on real sync (not dry run)
  ⚠️ Only for tasks that passed tag filtering
  ⚠️ Uses tasksById map to find original ObsidianTask
```

The key: `generateTaskId()` moves from SyncEngine to ObsidianAdapter. The adapter owns ID generation because it's the one that needs IDs for the 🆔 field in markdown. SyncEngine still calls `extractId()` to check for existing IDs, but defers to adapter for generation.

**Wait — actually**, the ID generation happens during normalize (step 3d), before applyChanges (step 6). The adapter needs the IDs at normalize time, not apply time. So `generateTaskId()` stays at normalize time, but it should be called by the adapter's normalize, not by SyncEngine directly.

Updated flow:
```
Step 3 (SyncEngine):
  taskInputs = buildTaskInputs(allTasks)      // pair with body
  filtered = wrapper.filterByTag(taskInputs)  // tag filter
  { tasks, tasksById } = adapter.normalize(filtered)
                         ^^^^^^^^^^^^^^^^^^^^^^^^
                         Adapter assigns IDs:
                           existing ID from task.id → use it
                           no ID → generateTaskId() (in-memory)
                         Returns which tasks got new IDs

Step 6:  adapter.applyChanges(toObsidian, wrapper, tasksById, settings)
Step 8:  adapter.writeBackIds(tasks, tasksById, wrapper, settings)
         Only writes back tasks that got in-memory IDs during normalize
```

This means `normalize()` signature changes to accept `TaskWithBody[]` directly (not pre-processed with taskId), and the adapter handles ID extraction + generation internally.

---

## Plan

### Step 1: Replace VTODOMapper's `ObsidianTask` with `CommonTask`

**`src/caldav/vtodoMapper.ts`:**
- Remove local `ObsidianTask` interface
- Import `CommonTask` from `../sync/types`
- `taskToVTODO(task: CommonTask, uid: string): string` — uses `task.title` (was `description`)
- `vtodoToTask(vtodo: CalendarObject): Omit<CommonTask, 'uid'>` — returns CommonTask minus uid
- Rename internal `description` → `title` in parsing/serialization

**`src/sync/caldavAdapter.ts`:**
- `toCommonTask()` simplifies: spread mapper result + set uid
- `fromCommonTask()` simplifies: pass CommonTask directly to mapper

**Tests:** update vtodoMapper.test.ts + caldavAdapter.test.ts

### Step 2: Create ObsidianMapper

**New file `src/tasks/obsidianMapper.ts`:**

```ts
import { RRule } from 'rrule';
import { CommonTask, TaskStatus, TaskPriority } from '../sync/types';
import { ObsidianTask } from './obsidianTasksWrapper';

/**
 * Maps between obsidian-tasks Task objects and CommonTask.
 * Parallel to VTODOMapper on the CalDAV side.
 *
 * We cannot instantiate obsidian-tasks Task objects — they come from
 * the plugin's in-memory cache (read-only). For writing, we generate
 * markdown strings directly.
 */
export class ObsidianMapper {
  /** Parse: ObsidianTask → CommonTask */
  toCommonTask(task: ObsidianTask, taskId: string, body?: string): CommonTask

  /** Serialize: CommonTask → obsidian-tasks markdown string */
  toMarkdown(task: CommonTask, syncTag?: string): string

  /** Content hash for change detection */
  getContentHash(task: ObsidianTask): string

  // private: cleanDescription, cleanTags, mapStatus, mapPriority,
  //   reversePriority, formatDate, extractRecurrenceRule, rruleToText
}
```

Move from ObsidianAdapter: `toCommonTask()`, `toMarkdown()`, `getContentHash()`, all private helpers.

Note: `toMarkdown` uses `task.uid` for the 🆔 field — no separate taskId param needed.

### Step 3: Simplify ObsidianAdapter to orchestrator

**`src/sync/obsidianAdapter.ts`:**
- Create `ObsidianMapper` instance (like CalDAVAdapter creates VTODOMapper)
- `normalize(inputs: TaskWithBody[]): NormalizeResult` — assigns IDs internally:
  - Has existing ID (task.id) → use it
  - No ID → `generateTaskId()` (in-memory)
  - Tracks which tasks got new IDs (for writeBackIds)
  - Calls `this.mapper.toCommonTask()` for each
- Remove: toCommonTask, toMarkdown, toTaskFields, getContentHash, all private helpers
- Remove: RRule import
- Import: ObsidianMapper, generateTaskId

### Step 4: Add `applyChanges` + `writeBackIds` to ObsidianAdapter

```ts
export interface ObsidianApplyResult {
  createdMappings: Array<{ taskId: string; caldavUID: string; sourceFile: string }>;
}

async applyChanges(
  changes: SyncChange[],
  wrapper: ObsidianTasksWrapper,
  tasksById: Map<string, ObsidianTask>,
  settings: { syncTag?: string; newTasksDestination: string; newTasksSection?: string },
): Promise<ObsidianApplyResult>
```

- **CREATE**: `generateTaskId()` → set as task.uid → `mapper.toMarkdown()` → `wrapper.createTask()`
- **UPDATE**: find task in tasksById or wrapper.findTaskById() → `mapper.toMarkdown()` → `wrapper.updateTaskInVault()`
- **DELETE**: return mapping removal info (SyncEngine handles storage)

Future: **COMPLETE** action (update where status → DONE) will call `wrapper.toggleTaskDone()` instead of rewriting markdown. Not implemented yet — noted for next iteration.

```ts
async writeBackIds(
  obsidianTasks: CommonTask[],
  tasksById: Map<string, ObsidianTask>,
  wrapper: ObsidianTasksWrapper,
  settings: { syncTag?: string },
): Promise<void>
```

For each task where `wrapper.extractId(original)` returns null:
- `mapper.toMarkdown(task, settings.syncTag)` → `wrapper.updateTaskInVault(original, markdown)`

### Step 5: Simplify SyncEngine

- `normalize()` no longer needs pre-assigned IDs — adapter does it
- Remove `applyObsidianChanges()` → `this.obsidianAdapter.applyChanges()`
- Remove `writeBackIds()` → `this.obsidianAdapter.writeBackIds()`
- Remove `generateTaskId` import
- Persist created mappings from `ObsidianApplyResult`

### Step 6: Update tests

| File | Action |
|------|--------|
| `src/caldav/vtodoMapper.test.ts` | Update for CommonTask (title vs description) |
| `src/sync/caldavAdapter.test.ts` | Simplify — no more ObsidianTask DTO |
| `src/tasks/obsidianMapper.test.ts` | **NEW** — toCommonTask + toMarkdown tests (from adapter + wrapper) |
| `src/sync/obsidianAdapter.test.ts` | Remove toCommonTask/toMarkdown/toTaskFields/getContentHash, add normalize (with ID gen), applyChanges, writeBackIds |
| `src/tasks/obsidianTasksWrapper.test.ts` | Remove toMarkdown tests |
| `src/sync/syncEngine.test.ts` | Remove mockToMarkdown from wrapper mock, simplify apply assertions |
| `test/e2e/syncRoundTrip.e2e.test.ts` | Use ObsidianMapper.toMarkdown |

## Files to change

| File | Change |
|------|--------|
| `src/caldav/vtodoMapper.ts` | Replace ObsidianTask with CommonTask |
| `src/sync/caldavAdapter.ts` | Simplify toCommonTask/fromCommonTask |
| `src/tasks/obsidianMapper.ts` | **NEW** — parse + serialize (parallel to VTODOMapper) |
| `src/sync/obsidianAdapter.ts` | Use mapper, normalize assigns IDs, add applyChanges + writeBackIds |
| `src/sync/syncEngine.ts` | Remove apply/writeback, simplify normalize call |
| Tests (7 files) | See Step 6 |

## Verification

1. `npm test` — all tests pass with coverage thresholds
2. `npm run build` — no new errors from our source
3. `npm run lint` — no new lint errors

## Important notes

- The worktree must be created from master at commit `b057393` (latest)
- Master has uncommitted changes to 9 files — these ARE the starting point (prior refactoring sessions)
- Create worktree, then copy uncommitted changes from main tree before starting work
- CommonTask uses `body` (not `notes`) — this was already renamed in commit `4165fc0`
