# Sync direction (pull-only / push-only / both)

- **Date:** 2026-06-21
- **Issue:** [#117 — Possibility for a Pull-only mode?](https://github.com/josecoelho/obsidian-tasks-caldav/issues/117)
- **Status:** Approved design, pending implementation plan

## Motivation

A user wants to pull CalDAV tasks into Obsidian (to run dataview reports over
completed tasks per category) without ever pushing anything back. Their attempted
workaround — setting an Obsidian tag that no local task carries, so nothing
matches the push filter — fails, because the plugin stamps that tag onto every
pulled task, making them eligible to push again.

A true one-directional mode solves this regardless of tags: the push side is
suppressed at the engine level, not via the tag filter.

## Goals

- Per-calendar **sync direction**: `both` (today's behavior), `pull` (CalDAV →
  Obsidian only), `push` (Obsidian → CalDAV only).
- Default is `both`; existing configurations are unaffected and require no
  migration.
- One-way modes must never mutate the suppressed side — including no phantom
  sync-state (baseline / IdMapping) recorded for changes that were not applied.

## Non-goals

- No per-calendar conflict settings. In a one-way mode the source side always
  wins (see Conflicts below); the existing global conflict settings simply do
  not apply to a one-way calendar.
- No change to the dead `syncCompletedTasks` / `requireManualConflictResolution`
  settings (neither is read by the engine today). Cleaning those up is a
  separate concern.
- The issue's secondary remark that dry-run "doesn't seem to be present" is a
  discoverability matter — dry-run exists as the command **"Preview sync (dry
  run - no changes)"** (`main.ts:74`). Worth a reply on the issue, not a code
  change here.
- No wdio coverage (see Testing).

## Decisions (resolved during brainstorming)

1. **Granularity:** per-calendar (field on `CalendarMapping`).
2. **Deletions:** mirror — a deletion on the source side propagates to the
   target; the target side's deletions do not flow back.
3. **Obsidian tag in pull-only:** unchanged behavior. If a tag is set it is
   stamped and filtered as today; if blank, nothing is stamped and all local
   tasks are visible. One-way-ness comes purely from suppressing the push side,
   so no special tag handling is needed. (Stamping + filtering stay coupled to
   the same setting, so pulled tasks never vanish from the filter view.)
4. **Conflict strategy is forced by direction** (see below).
5. **Testing:** unit matrix (primary) + 2 targeted E2E round-trips. No wdio.

## Data model

Add to `CalendarMapping` (`src/types.ts`):

```ts
syncDirection?: 'both' | 'pull' | 'push';   // absent ⇒ 'both'
```

Optional field ⇒ existing `data.json` and the wdio fixture need no migration.

## Engine design (`src/sync/syncEngine.ts`)

Chosen approach: filter the changeset at a single chokepoint, then feed the
filtered changeset to everything downstream unchanged. The diff stays pure and
symmetric; no direction logic leaks into `diff()`.

### `applicableChanges(changeset, direction)` — pure exported helper

Returns a changeset with the **content** changes (`create` / `update` /
`complete` / `delete`) for the suppressed side removed:

- `pull` → drop `toCalDAV` content changes.
- `push` → drop `toObsidian` content changes.
- `both` → unchanged.

`reconcile` entries are **kept on both sides regardless of direction**: they
carry no content (both adapter handlers are no-ops) and only link an Obsidian
UID to a CalDAV UID in the IdMapping. Dropping them in a one-way mode would lose
orphan de-duplication.

Extracting this as a pure function keeps `sync()` thin and makes the core
direction logic unit-testable and E2E-testable without a vault.

### `sync()` flow

1. `diff(...)` exactly as today.
2. `const applied = applicableChanges(changeset, direction)`.
3. Apply `applied.toObsidian` only if `direction !== 'push'`.
4. Apply `applied.toCalDAV` only if `direction !== 'pull'`.
5. Pass **`applied`** (not the raw changeset) to `updateIdMapping` and
   `computeNewBaseline`, so no phantom create/mapping/baseline entry is recorded
   for a change that was never applied.
6. `writeBackIds` runs in **all** modes — it stamps identity (the `🆔`/`[id::]`
   marker), not content. Push-only still needs it, or every push duplicates
   server-side.

### Conflict strategy forced by direction

`conflictStrategy()` becomes direction-aware:

- `pull` → `'caldav-wins'`
- `push` → `'obsidian-wins'`
- `both` → existing logic (`autoResolveObsidianWins ? 'obsidian-wins' : 'caldav-wins'`)

Rationale: `diff()` emits a conflict's resolving change toward the winning side
(`diff.ts:89-93`). If the strategy pointed at the suppressed side, the conflict
change would be filtered out and the conflict silently dropped — neither side
updated. Forcing the strategy guarantees the resolving change lands on the side
we actually apply.

## Behavior matrix

| Situation | both | pull | push |
|---|---|---|---|
| New on CalDAV | create in Obsidian | create in Obsidian | (suppressed) |
| New in Obsidian | create on CalDAV | (suppressed) | create on CalDAV |
| Edited on CalDAV | update Obsidian | update Obsidian | (suppressed) |
| Edited in Obsidian | update CalDAV | (suppressed) | update CalDAV |
| Deleted on CalDAV | delete in Obsidian | delete in Obsidian | (suppressed) |
| Deleted in Obsidian | delete on CalDAV | (suppressed) | delete on CalDAV |
| Both edited (conflict) | resolved by settings | CalDAV wins (Obsidian overwritten) | Obsidian wins (server overwritten) |
| Equal orphans on both sides | reconcile (link IDs) | reconcile | reconcile |

**Conflicts in one-way modes** are still detected and counted, but always
auto-resolve toward the source. They are reported as informational ("the target
was overwritten"), not as something requiring manual resolution.

### Divergent edits across syncs (consequence of the existing baseline logic)

The matrix above describes a *single* sync. A one-sided edit to an
already-synced task has a cross-sync consequence that falls out of the current
`computeNewBaseline` (which seeds the new baseline from Obsidian first). We
accept this rather than redesign the baseline — the change stays a pure
changeset filter.

- **Pull-only, local edit to a synced task:** suppressed on the current sync;
  the baseline absorbs the local value, so on the *next* sync the unchanged
  CalDAV value reads as the divergent one and is re-pulled — i.e. the local edit
  is **reverted to the server version** within a sync or two. This matches
  "CalDAV is the source of truth" and is the desired behavior for the issue's
  use case.
- **Push-only, server-side edit to a synced task:** suppressed and **not
  actively reverted**. Because the Obsidian task itself did not change, no push
  is emitted, so the server keeps its edit and it is silently ignored (never
  pulled, never overwritten) until the Obsidian task changes again.

This asymmetry is intentional for now. Making push-only forcibly overwrite
server-side edits would require baseline-tracks-source semantics — out of scope;
a follow-up if desired.

## UI (`main.ts`, `renderCalendarMapping`)

A per-calendar **"Sync direction"** dropdown (sentence case):

- Both — Obsidian and server stay in sync
- Pull from server only
- Push to server only

Default selection: Both. When pull/push is selected, soften the "Obsidian tag" /
"Server category" descriptions to reflect which filter is active, and update the
`updateHint` text accordingly.

## Testing

### Unit (primary)

- New `applicableChanges` suite: each direction drops the right content changes
  and preserves `reconcile` on both sides.
- `syncEngine.test.ts`, per direction:
  - suppressed side's adapter `applyChanges` is never invoked with content
    changes;
  - baseline + IdMapping record **only** the applied side (the phantom-create
    regression guard);
  - conflicts auto-resolve toward the source (forced strategy);
  - deletions mirror correctly;
  - completion flows in pull-only;
  - `reconcile` links survive in one-way modes.
- Settings round-trip test for the new `syncDirection` field.

### E2E (`test/e2e/syncRoundTrip.e2e.test.ts`)

The E2E layer uses the real CalDAV adapter + real Radicale + pure `diff()`, with
the Obsidian side as in-memory `CommonTask[]` (no `SyncEngine` / vault). Two
focused round-trips, driven through the exported `applicableChanges`:

1. **Pull-only = server untouched.** Seed a task on Radicale, build a divergent
   local state (local edit + local delete) so `diff()` would emit `toCalDAV`
   changes, run `applicableChanges(cs, 'pull')`, apply via the real adapter,
   re-fetch, and assert the server object is byte-for-byte unchanged. Directly
   validates issue #117 against a real server.
2. **Push-only = local changes land, server-only changes don't return.** Local
   create + update + delete reach Radicale; a task created out-of-band on the
   server stays absent from the applied local changes.

### Not covered by wdio

wdio's distinct value is fidelity against the real obsidian-tasks API / vault
path. Direction modes reuse vault write paths already exercised by the existing
happy-path scenarios; the new logic is suppression ("the push side did not
run"), which is an assert-absence concern better served by unit mocks and the
pull-only E2E. Adding a wdio spec would be slow and assert a negative — low
marginal value.
