# Sync direction (pull/push/both) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-calendar sync direction (`both` / `pull` / `push`) so a calendar can pull from CalDAV only, push to CalDAV only, or sync both ways (today's behavior).

**Architecture:** The pure, symmetric `diff()` is unchanged. A new pure helper `applicableChanges(changeset, direction)` strips the suppressed side's content changes (keeping identity-only `reconcile` entries). `SyncEngine.sync()` runs that filter once, then feeds the *filtered* changeset to every downstream step (apply, IdMapping, baseline) so no phantom state is recorded. `conflictStrategy()` is forced by direction so a conflict's resolving change always lands on the side that actually applies.

**Tech Stack:** TypeScript, Jest (unit + Docker-backed E2E against Radicale), esbuild, Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-06-21-sync-direction-design.md`

---

## File structure

- `src/types.ts` — **modify**: add `SyncDirection` type + optional `CalendarMapping.syncDirection`.
- `src/sync/applicableChanges.ts` — **create**: pure direction filter.
- `src/sync/applicableChanges.test.ts` — **create**: unit tests for the filter.
- `src/sync/syncEngine.ts` — **modify**: resolve direction, force conflict strategy, run the filter, feed filtered changeset downstream.
- `src/sync/syncEngine.test.ts` — **modify**: direction behavior tests.
- `main.ts` — **modify**: per-calendar "Sync direction" dropdown + import.
- `test/e2e/syncRoundTrip.e2e.test.ts` — **modify**: two directional round-trips against the real server.

A note on coverage: `src/ui` and the `main.ts` settings tab are not unit-tested (per `jest.config.js` exclusions and the absence of a settings harness). The dropdown is verified by typecheck/lint/build + manual; the engine's reading of `syncDirection` is fully covered by the `syncEngine.test.ts` tests below. No `data.json` / wdio fixture change is needed — `syncDirection` is optional and defaults to `both`.

---

## Task 1: Add the `SyncDirection` type and field

**Files:**
- Modify: `src/types.ts:1-8`

- [ ] **Step 1: Add the type and the optional field**

In `src/types.ts`, replace the `CalendarMapping` interface (currently lines 1-8) with:

```ts
export type SyncDirection = 'both' | 'pull' | 'push';

export interface CalendarMapping {
  obsidianTag: string;
  caldavCategory: string;
  calendarName: string;
  serverUrl: string;
  username: string;
  password: string;
  /** Direction of sync for this calendar. Absent ⇒ 'both' (bidirectional). */
  syncDirection?: SyncDirection;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors (optional field; nothing else references it yet).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add per-calendar SyncDirection field"
```

---

## Task 2: `applicableChanges` pure helper (TDD)

**Files:**
- Create: `src/sync/applicableChanges.ts`
- Test: `src/sync/applicableChanges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sync/applicableChanges.test.ts`:

```ts
import { applicableChanges } from './applicableChanges';
import { Changeset, CommonTask, SyncChange } from './types';

function task(uid: string): CommonTask {
  return {
    uid,
    title: uid,
    status: 'TODO',
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: '',
    body: '',
  };
}

function change(type: SyncChange['type'], uid: string): SyncChange {
  return { type, task: task(uid) };
}

function makeChangeset(): Changeset {
  return {
    toObsidian: [change('create', 'o-create'), change('reconcile', 'o-recon')],
    toCalDAV: [change('update', 'c-update'), change('delete', 'c-delete'), change('reconcile', 'c-recon')],
    conflicts: [
      { uid: 'x', obsidianVersion: task('x'), caldavVersion: task('x'), baselineVersion: task('x') },
    ],
  };
}

describe('applicableChanges', () => {
  it('both: returns the changeset unchanged', () => {
    const cs = makeChangeset();
    const result = applicableChanges(cs, 'both');
    expect(result.toObsidian).toEqual(cs.toObsidian);
    expect(result.toCalDAV).toEqual(cs.toCalDAV);
    expect(result.conflicts).toEqual(cs.conflicts);
  });

  it('pull: drops toCalDAV content changes but keeps reconcile and toObsidian', () => {
    const result = applicableChanges(makeChangeset(), 'pull');
    expect(result.toObsidian.map(c => c.type)).toEqual(['create', 'reconcile']);
    expect(result.toCalDAV.map(c => c.type)).toEqual(['reconcile']);
    expect(result.conflicts).toHaveLength(1);
  });

  it('push: drops toObsidian content changes but keeps reconcile and toCalDAV', () => {
    const result = applicableChanges(makeChangeset(), 'push');
    expect(result.toObsidian.map(c => c.type)).toEqual(['reconcile']);
    expect(result.toCalDAV.map(c => c.type)).toEqual(['update', 'delete', 'reconcile']);
    expect(result.conflicts).toHaveLength(1);
  });

  it('does not mutate the input changeset', () => {
    const cs = makeChangeset();
    applicableChanges(cs, 'pull');
    expect(cs.toCalDAV.map(c => c.type)).toEqual(['update', 'delete', 'reconcile']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/applicableChanges.test.ts`
Expected: FAIL — `Cannot find module './applicableChanges'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/sync/applicableChanges.ts`:

```ts
import { SyncDirection } from '../types';
import { Changeset, SyncChange } from './types';

const CONTENT_TYPES: ReadonlySet<SyncChange['type']> = new Set([
  'create',
  'update',
  'complete',
  'delete',
]);

/**
 * Keep only identity-only changes (reconcile). Drops every content change
 * (create/update/complete/delete) so the side it belongs to is never written.
 */
function reconcileOnly(changes: SyncChange[]): SyncChange[] {
  return changes.filter((c) => !CONTENT_TYPES.has(c.type));
}

/**
 * Filter a changeset to the changes that should actually be applied for the
 * given sync direction. `reconcile` entries are kept on both sides regardless
 * of direction — they carry no content and only link IDs (de-duplication).
 */
export function applicableChanges(changeset: Changeset, direction: SyncDirection): Changeset {
  if (direction === 'pull') {
    return { ...changeset, toCalDAV: reconcileOnly(changeset.toCalDAV) };
  }
  if (direction === 'push') {
    return { ...changeset, toObsidian: reconcileOnly(changeset.toObsidian) };
  }
  return changeset;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/applicableChanges.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/applicableChanges.ts src/sync/applicableChanges.test.ts
git commit -m "feat(sync): add applicableChanges direction filter"
```

---

## Task 3: Wire direction into SyncEngine (TDD)

**Files:**
- Modify: `src/sync/syncEngine.ts` (imports; `sync()` body lines 85-97; `conflictStrategy()` lines 122-126)
- Test: `src/sync/syncEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `src/sync/syncEngine.test.ts`, just before the final closing `});` of the top-level `describe('SyncEngine', ...)`:

```ts
  describe('sync direction', () => {
    it('pull-only: applies CalDAV→Obsidian creates but never writes to the server', async () => {
      mockFetchVTODOs.mockResolvedValue([makeCalObj('cal-pull-1', 'Pulled task')]);
      mockGetAllTasksWithBody.mockResolvedValue([]);

      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping({ syncDirection: 'pull' }),
        makeSettings(),
      );
      await engine.initialize();
      const result = await engine.sync();

      expect(result.success).toBe(true);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
      expect(mockCreateVTODO).not.toHaveBeenCalled();
      expect(mockUpdateVTODO).not.toHaveBeenCalled();
      expect(mockDeleteVTODOByUID).not.toHaveBeenCalled();
    });

    it('pull-only: a new local task is never pushed to the server', async () => {
      const localTask = makeObsidianTask({ description: 'Local only', id: '20250101-loc', tags: ['#sync'] });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(localTask));
      mockFetchVTODOs.mockResolvedValue([]);

      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping({ syncDirection: 'pull' }),
        makeSettings(),
      );
      await engine.initialize();
      const result = await engine.sync();

      expect(result.success).toBe(true);
      expect(mockCreateVTODO).not.toHaveBeenCalled();
      // No phantom mapping recorded for the un-pushed task.
      const idMapping = mockSetIdMapping.mock.calls.at(-1)?.[0];
      expect(idMapping?.taskIdToCaldavUid['20250101-loc']).toBeUndefined();
    });

    it('push-only: pushes new Obsidian tasks but never creates tasks in Obsidian', async () => {
      const localTask = makeObsidianTask({ description: 'Push me', id: '20250101-psh', tags: ['#sync'] });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(localTask));
      mockFetchVTODOs.mockResolvedValue([makeCalObj('cal-srv-only', 'Server only task')]);

      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping({ syncDirection: 'push' }),
        makeSettings(),
      );
      await engine.initialize();
      const result = await engine.sync();

      expect(result.success).toBe(true);
      expect(mockCreateVTODO).toHaveBeenCalledTimes(1);
      expect(mockCreateTask).not.toHaveBeenCalled();
    });

    it('pull-only: forces caldav-wins even when autoResolveObsidianWins is true', async () => {
      const baseline = {
        uid: '20250101-abc',
        description: 'Original task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [] as string[],
        recurrenceRule: '',
        body: '',
      };
      const obsTask = makeObsidianTask({
        description: 'Updated in Obsidian',
        id: '20250101-abc',
        tags: ['#sync'],
        originalMarkdown: '- [ ] Updated in Obsidian [id::20250101-abc] #sync',
      });
      const vtodo = makeCalObj('caldav-abc', 'Updated in CalDAV');
      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([vtodo]);
      mockGetBaseline.mockReturnValue([baseline]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-abc': 'caldav-abc' },
        caldavUidToTaskId: { 'caldav-abc': '20250101-abc' },
      });

      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping({ syncDirection: 'pull' }),
        makeSettings({ autoResolveObsidianWins: true }),
      );
      await engine.initialize();
      const result = await engine.sync({ dryRun: true });

      expect(result.conflicts).toBe(1);
      expect(result.updated.toObsidian).toBe(1);
      expect(result.updated.toCalDAV).toBe(0);
      expect(result.details.toObsidian[0].task.title).toBe('Updated in CalDAV');
    });

    it('pull-only: a CalDAV deletion still removes the task in Obsidian (mirror)', async () => {
      // Task is in baseline + Obsidian but gone from CalDAV ⇒ deleted on server.
      const obsTask = makeObsidianTask({ description: 'Gone on server', id: '20250101-gone', tags: ['#sync'] });
      mockGetAllTasksWithBody.mockResolvedValue(withBody(obsTask));
      mockFetchVTODOs.mockResolvedValue([]);
      mockGetBaseline.mockReturnValue([{
        uid: '20250101-gone',
        description: 'Gone on server',
        status: 'TODO',
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none',
        tags: [],
        recurrenceRule: '',
        body: '',
      }]);
      mockGetIdMapping.mockReturnValue({
        taskIdToCaldavUid: { '20250101-gone': 'caldav-gone' },
        caldavUidToTaskId: { 'caldav-gone': '20250101-gone' },
      });

      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping({ syncDirection: 'pull' }),
        makeSettings(),
      );
      await engine.initialize();
      const result = await engine.sync();

      expect(result.success).toBe(true);
      expect(result.deleted.toObsidian).toBe(1);
      expect(mockDeleteVTODOByUID).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts -t "sync direction"`
Expected: FAIL — `makeCalendarMapping` accepts `syncDirection` (Task 1), but `SyncEngine` still pushes/pulls both ways, so e.g. `mockCreateVTODO` *is* called in the pull-only test and `mockCreateTask` *is* called in the push-only test.

- [ ] **Step 3: Add imports to `syncEngine.ts`**

In `src/sync/syncEngine.ts`, update the type import (line 5) and add the helper import after the `diff` import (line 8):

```ts
import { CalDAVSettings, CalendarMapping, IdMapping, SyncDirection } from "../types";
```

```ts
import { applicableChanges } from "./applicableChanges";
```

- [ ] **Step 4: Add the `direction()` helper and make `conflictStrategy()` direction-aware**

In `src/sync/syncEngine.ts`, replace `conflictStrategy()` (lines 122-126) with:

```ts
	private direction(): SyncDirection {
		return this.calendar.syncDirection ?? "both";
	}

	private conflictStrategy(): ConflictStrategy {
		const direction = this.direction();
		if (direction === "pull") return "caldav-wins";
		if (direction === "push") return "obsidian-wins";
		return this.settings.autoResolveObsidianWins
			? "obsidian-wins"
			: "caldav-wins";
	}
```

- [ ] **Step 5: Filter the changeset and feed the filtered version downstream**

In `src/sync/syncEngine.ts`, replace the body of `sync()` from the `diff(...)` line through the final `return this.buildResult(...)` (currently lines 85-97) with:

```ts
			const changeset = diff(obsidianTasks, caldavTasks, baseline, this.conflictStrategy());
			const applied = applicableChanges(changeset, this.direction());

			if (dryRun) return this.buildResult(applied, obsidianTasks, caldavTasks, baseline, true, showProgress);

			const { createdMappings, completionRemappings } = await this.obsidianAdapter.applyChanges(applied.toObsidian);
			await this.caldavAdapter.applyChanges(applied.toCalDAV, idMapping);
			await this.obsidianAdapter.writeBackIds(obsidianTasks);

			this.updateIdMapping(idMapping, createdMappings, completionRemappings, applied);
			this.persistState(obsidianTasks, caldavTasks, applied, idMapping);
			await this.storage.save();

			return this.buildResult(applied, obsidianTasks, caldavTasks, baseline, false, showProgress);
```

Note: the apply calls stay unconditional. After filtering, the suppressed side holds only `reconcile` entries, whose adapter handlers are no-ops — so no content is written and `createdMappings` is empty for that side. The filter is the single point of control.

- [ ] **Step 6: Run the direction tests to verify they pass**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts -t "sync direction"`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full SyncEngine + diff suites to confirm no regressions**

Run: `npx jest --selectProjects unit src/sync/`
Expected: PASS (all existing tests still green — `both` is unchanged behavior).

- [ ] **Step 8: Commit**

```bash
git add src/sync/syncEngine.ts src/sync/syncEngine.test.ts
git commit -m "feat(sync): apply sync direction in SyncEngine"
```

---

## Task 4: Per-calendar "Sync direction" dropdown (UI)

**Files:**
- Modify: `main.ts:2` (import), `main.ts:317-327` (inside `renderCalendarMapping`, after the "Calendar N" heading)

No unit test — the settings tab is outside Jest coverage and has no harness. Verified by typecheck/lint/build and manual check.

- [ ] **Step 1: Import `SyncDirection`**

In `main.ts`, change line 2 to:

```ts
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS, SyncDirection } from './src/types';
```

- [ ] **Step 2: Add the dropdown**

In `main.ts`, inside `renderCalendarMapping`, immediately after the `Calendar ${index + 1}` heading `Setting` block (the one ending at line 327 with the Remove button) and before the `Obsidian tag` setting (line 329), insert:

```ts
		new Setting(containerEl)
			.setName('Sync direction')
			.setDesc('Both keeps Obsidian and the server in sync. Pull from server only brings server changes into Obsidian and never writes to the server. Push to server only sends Obsidian changes to the server and never changes your notes.')
			.addDropdown(dropdown => dropdown
				.addOption('both', 'Both')
				.addOption('pull', 'Pull from server only')
				.addOption('push', 'Push to server only')
				.setValue(calendar.syncDirection ?? 'both')
				.onChange(async (value) => {
					calendar.syncDirection = value as SyncDirection;
					await this.plugin.saveSettings();
					this.display();
				}));
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `npm run build`
Expected: typecheck + esbuild succeed.

Run: `npm run lint`
Expected: no errors (sentence-case names/descriptions; no floating promises — the `onChange` is `async` and awaited internally).

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "feat(ui): add per-calendar sync direction dropdown"
```

---

## Task 5: E2E round-trips against the real server (TDD)

**Files:**
- Modify: `test/e2e/syncRoundTrip.e2e.test.ts` (import + two new `it` blocks inside the existing `describe('Sync round-trip E2E', ...)`)

Requires Docker (Radicale). These prove the real HTTP side-effects of directional sync, which the mocked unit tests can't.

- [ ] **Step 1: Add the import**

In `test/e2e/syncRoundTrip.e2e.test.ts`, add after the `diff` import (line 4):

```ts
import { applicableChanges } from '../../src/sync/applicableChanges';
```

- [ ] **Step 2: Write the failing tests**

Inside the `describe('Sync round-trip E2E', ...)` block, add:

```ts
  it('pull-only: a divergent Obsidian state never mutates the server', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const keepUid = `e2e-pull-keep-${Date.now()}`;
    const delUid = `e2e-pull-del-${Date.now()}`;
    await client.createVTODO(buildVTODO(keepUid, 'Server task to edit'), keepUid);
    await client.createVTODO(buildVTODO(delUid, 'Server task to delete locally'), delUid);

    // Baseline = what we last pulled.
    const baseline = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);

    // Obsidian diverges: edit one task, delete the other — locally only.
    const obsidianTasks: CommonTask[] = baseline
      .filter(t => t.uid !== delUid)
      .map(t => (t.uid === keepUid ? { ...t, title: 'Locally edited' } : t));

    const caldavTasks = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    // Sanity: bidirectional would push an update and a delete to the server.
    expect(changeset.toCalDAV.some(c => c.type === 'update')).toBe(true);
    expect(changeset.toCalDAV.some(c => c.type === 'delete')).toBe(true);

    // Pull-only strips them, so applying touches nothing on the server.
    const applied = applicableChanges(changeset, 'pull');
    await caldavAdapter.applyChanges(applied.toCalDAV, emptyIdMapping);

    const after = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    expect(after).toHaveLength(2);
    expect(after.find(t => t.uid === keepUid)?.title).toBe('Server task to edit'); // not 'Locally edited'
    expect(after.find(t => t.uid === delUid)).toBeDefined();                       // not deleted
  });

  it('push-only: local changes reach the server; a server-only task is not pulled', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const serverOnlyUid = `e2e-push-srvonly-${Date.now()}`;
    await client.createVTODO(buildVTODO(serverOnlyUid, 'Server-only task'), serverOnlyUid);

    const caldavTasks = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    const baseline: CommonTask[] = [];

    const localUid = `obs-push-${Date.now()}`;
    const obsidianTasks: CommonTask[] = [{
      uid: localUid,
      title: 'Local task to push',
      status: 'TODO',
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none',
      tags: [],
      recurrenceRule: '',
      body: '',
    }];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'obsidian-wins');
    // Sanity: bidirectional would create the server-only task in Obsidian.
    expect(changeset.toObsidian.some(c => c.type === 'create')).toBe(true);

    const applied = applicableChanges(changeset, 'push');
    expect(applied.toObsidian.every(c => c.type === 'reconcile')).toBe(true); // nothing to pull

    await caldavAdapter.applyChanges(applied.toCalDAV, emptyIdMapping);

    const after = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    expect(after.find(t => t.title === 'Local task to push')).toBeDefined();      // push happened
    expect(after.find(t => t.uid === serverOnlyUid)).toBeDefined();               // untouched
  });
```

- [ ] **Step 3: Run the new E2E tests**

Run: `npx jest --selectProjects e2e test/e2e/syncRoundTrip.e2e.test.ts -t "pull-only|push-only"`
Expected: PASS (2 tests). If Radicale isn't up, start it per `docker-compose.yml` first.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/syncRoundTrip.e2e.test.ts
git commit -m "test(e2e): directional sync round-trips against real server"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the complete suite with coverage**

Run: `npm test`
Expected: all unit + E2E pass; coverage thresholds for `src/sync/` (80% lines / 80% branches) still met. **Work is done when this passes.**

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Final commit (only if anything was adjusted during verification)**

```bash
git add -A
git commit -m "chore(sync): finalize sync direction feature"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** data model → Task 1; `applicableChanges` (incl. reconcile-kept) → Task 2; suppression + filtered bookkeeping + forced conflict strategy + `writeBackIds` in all modes → Task 3; mirror deletions → Task 3 (test) and falls out of `diff`; UI → Task 4; unit matrix → Tasks 2-3; E2E pull/push round-trips → Task 5.
- **Normal tag behavior** (spec decision #3) needs no code: nothing in these tasks touches the Obsidian tag filter or stamping, so it keeps working exactly as today.
- **Divergent-edit consequence** (spec) is a cross-sync property of the existing baseline logic; no code targets it, and no test asserts the multi-sync revert (out of scope, documented in the spec).
- **Out of scope:** dead `syncCompletedTasks` / `requireManualConflictResolution` settings; dry-run discoverability reply on the issue.
