# Subtask sync — design

**Issue:** [#61](https://github.com/josecoelho/obsidian-tasks-caldav/issues/61) — subtask support
**Date:** 2026-05-17
**Status:** Approved (brainstorming), pending implementation plan

## Problem

Issue #61 requests subtask support, two ways:

1. Indented (Todoist-style) subtasks within a note.
2. Relation-by-id ("dependon") subtasks, possibly across notes.

obsidian-tasks offers only one relational primitive — `⛔ dependsOn` (a "blocked by"
graph, not containment) — and has no native parent/child field. Markdown list
**indentation** is the natural, Todoist-like way users already express subtasks.
CalDAV/VTODO models subtasks as a containment tree: the child VTODO carries
`RELATED-TO;RELTYPE=PARENT:<parent-uid>`, the only form Tasks.org / Nextcloud Tasks /
Apple Reminders render as nested subtasks.

Today the plugin's body parser (`extractBodyFromFile`) treats *every* indented
`- ...` line under a task as that task's description, so an indented checkbox is
silently swallowed into the parent's body.

## Decisions

| Decision | Choice |
| --- | --- |
| Obsidian hierarchy source | List **indentation within a note** (Todoist-style). Parent = nearest preceding checkbox task at a shallower indent in the same file. |
| CalDAV wire format | Child VTODO carries `RELATED-TO;RELTYPE=PARENT:<parent-caldav-uid>`. |
| Nesting depth | Arbitrary. |
| Completion behavior | Independent — structure only, **no** completion cascade. |
| Sync trigger | Children **inherit** sync eligibility from any synced ancestor; `🆔` auto-assigned, no per-subtask tag. |
| Parent deletion | **No explicit cascade.** On Obsidian, a subtask is a body fragment whose parent is determined by indentation; deleting the parent line leaves indented children with no structural parent → they re-normalize to `parentUid=null` and naturally become top-level on CalDAV via the per-UID diff. CalDAV clients (Tasks.org, Nextcloud) typically delete children when their parent is deleted; the per-UID diff propagates each of those deletes to Obsidian. (Note: Obsidian-side vault deletion is a separate pre-existing gap — see issue link below.) |
| `dependsOn` / cross-note | **Out of scope** — deferred to a future issue. |
| New settings | None. |

## Architecture

Follows the existing **Mapper → Adapter → I/O** pattern with `CommonTask` as the
shared type. Parent links are carried as the parent's **sync UID**; `IdMapping`
translates to/from CalDAV UID at the I/O edge, exactly like the existing `uid`.

### 1. Data model — `src/sync/types.ts`

`CommonTask` gains:

```ts
parentUid: string | null; // parent task's sync UID; null = top-level
```

`tasksEqual()` in `diff.ts` includes `parentUid`. Re-parenting and un-parenting
therefore flow through the existing three-way diff as ordinary updates — no
special move logic.

### 2. Obsidian side

**Shared predicate `isTaskLine(line)`** — matches a list item with a checkbox:
`^\s*[-*+]\s+\[.\]\s` or ordered `^\s*\d+\.\s+\[.\]\s`.

**`extractBodyFromFile` (`obsidianTasksWrapper.ts`):** body = consecutive indented
list lines immediately under the task that are **not** task lines; stop at the first
task line, at a dedent to ≤ the task's indent, or at a non-list line. This removes
today's behavior of swallowing indented checkboxes into the body.

**Parent map:** built per-file from raw content (the wrapper already reads files in
`loadBodies`). Indent compared by leading-whitespace width. Each task's structural
parent = nearest preceding line with smaller indent that is itself a task line.
`TaskWithBody` gains a parent reference (the parent `ObsidianTask`, or null).

**`ObsidianAdapter.normalize`:** after assigning/looking-up IDs for all tasks in the
batch, a second pass sets each `CommonTask.parentUid` to the parent task's assigned
sync UID (build a `Map<ObsidianTask, string>` during the first pass for reverse
lookup).

**Inheritance — `filterByTag` (`obsidianTasksWrapper.ts`):** keep a task if it *or
any ancestor* (walk the parent map) carries the sync tag. Children with no `🆔`
get one written back via the existing `writeBackIds` path.

**Indentation preservation:**
- `ObsidianMapper.toMarkdown(task, syncTag?, indent?)` — emits the task line at the
  given indent; body bullet lines indented relative to the task line.
- `updateTaskInVault` (`obsidianTasksWrapper.ts`) — preserves the matched task
  line's own indentation on rewrite, and its body-replacement loop uses
  `isTaskLine` so it stops at (never clobbers) child task lines.

### 3. CalDAV side

**`VTODOMapper.taskToVTODO`:** when a resolved parent CalDAV UID is supplied, emit
`RELATED-TO;RELTYPE=PARENT:<parent-caldav-uid>`. The mapper stays pure — it receives
the resolved parent UID, it does not consult `IdMapping`.

**`CalDAVAdapter.fromCommonTask` / `applyChanges`:** resolve
`parentCaldavUid = idMapping.taskIdToCaldavUid[task.parentUid] ?? task.parentUid`
and pass it to the mapper.

**`VTODOMapper.vtodoToTask`:** parse `RELATED-TO`. Treat `RELTYPE=PARENT` or an
absent `RELTYPE` as the parent link; ignore `RELTYPE=CHILD` / `RELTYPE=SIBLING`.
Returns the parent's CalDAV UID.

**`CalDAVAdapter.normalize`:** map the parent CalDAV UID back to the parent's sync
UID via `idMapping.caldavUidToTaskId[parentCaldavUid] ?? parentCaldavUid` (same
fallback pattern as `uid`), and set `CommonTask.parentUid`.

### 4. Ordering

**Obsidian → CalDAV (new parent + new child, same sync):** for Obsidian-origin
tasks the CalDAV UID *equals* the sync UID, so
`parentCaldavUid = idMapping[parentUid] ?? parentUid` is correct even before the
mapping is persisted.

**CalDAV → Obsidian (new parent + new child, same sync):**
- `toObsidian` creates are ordered **parent-before-child** (topological by
  `parentUid`).
- A within-batch `caldavUid → newObsidianId` map is built as tasks are created.
- A CalDAV-origin subtask is written **indented beneath the parent's task line**
  (after the parent's body) in the parent's note. Top-level CalDAV tasks still go
  to `newTasksDestination` / `newTasksSection` as today.
- Parent lookup falls back to `IdMapping` / `findTaskById` for a parent synced in
  an earlier run.

### 5. Deletion / re-parenting

No dedicated cascade. The per-UID diff handles every gesture correctly given the
asymmetric model: an Obsidian subtask is a body fragment whose parent is purely
structural (indentation), while a CalDAV subtask is a first-class VTODO.

- **Re-indent / un-indent in Obsidian** → child's `parentUid` recomputed by
  `ObsidianAdapter.normalize` → diff emits an `update` → `CalDAVAdapter` rewrites
  `RELATED-TO`.
- **CalDAV parent deletion** → Tasks.org / Nextcloud Tasks delete the child VTODOs
  as part of that gesture, so the server emits per-UID deletes for parent + every
  child. Per-UID diff propagates each to Obsidian independently.
- **Obsidian parent line deleted, indented children remain** → children re-normalize
  with `parentUid=null` (no shallower ancestor in the file) → per-UID diff emits
  `delete` for the parent and `update` (removing `RELATED-TO`) for each child.
  Children become top-level on CalDAV.
- **Obsidian parent + all child lines deleted** → per-UID `delete` for each.

**Pre-existing gap (out of scope for this issue):** `ObsidianAdapter.delete` is a
no-op — a task deleted on CalDAV is not removed from the Obsidian vault, only from
the ID mapping/baseline. The `deleteBehavior` setting in `src/types.ts` is declared
but read nowhere. Both are tracked in
[#99](https://github.com/josecoelho/obsidian-tasks-caldav/issues/99) and apply to
*all* deletes, not just subtasks.

## Files touched

- `src/sync/types.ts` — `parentUid` on `CommonTask`.
- `src/sync/diff.ts` — `parentUid` in `tasksEqual`.
- `src/sync/syncEngine.ts` — unchanged (per-UID diff handles all cases).
- `src/caldav/vtodoMapper.ts` — emit/parse `RELATED-TO;RELTYPE=PARENT`.
- `src/sync/caldavAdapter.ts` — resolve `parentUid` ↔ parent CalDAV UID via `IdMapping`.
- `src/tasks/obsidianTasksWrapper.ts` — `isTaskLine`; indentation-aware parent map; refined body extraction; sync-tag inheritance; indent-preserving update; nested insert for CalDAV-origin children.
- `src/tasks/obsidianMapper.ts` — `toMarkdown` indent argument; body indent relative to task.
- `src/sync/obsidianAdapter.ts` — resolve structural parent → `parentUid` in `normalize`; create children nested under parent.

## Testing

- **Unit:** `isTaskLine`; body-vs-subtask split in `extractBodyFromFile`; parent-map
  construction (multi-level, mixed body+subtask, dedent, sibling, re-ascent);
  `tasksEqual` with `parentUid`; VTODO `RELATED-TO` emit/parse incl. absent RELTYPE
  and CHILD/SIBLING ignored; adapter parentUid ↔ CalDAV UID resolution both
  directions; sync-tag inheritance via ancestor; `insertSubtask` placement edges;
  indent-preserving `updateTaskInVault`.
- **E2E (real Radicale):** round-trip a parent + nested child — create in Obsidian
  shape, push, fetch, assert `RELATED-TO;RELTYPE=PARENT`; reparent (re-indent).
- **wdio smoke:** extend within the existing happy-path scope — create a parent
  with one indented subtask, sync, assert nested subtask on CalDAV. No new
  settings, so `test/wdio/.../data.json` is unchanged.

`npm test` must pass (work is done when it does). Coverage thresholds for
`src/sync`, `src/caldav`, `src/tasks` must hold.

## Non-goals

- `⛔ dependsOn` mapping (future issue).
- Cross-note subtasks (indentation cannot span notes; future `dependsOn` work).
- Completion cascade (parent/child completion stays independent).
- New settings / UI surface.
