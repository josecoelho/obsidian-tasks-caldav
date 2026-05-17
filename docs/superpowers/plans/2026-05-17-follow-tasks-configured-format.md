# Follow obsidian-tasks' configured format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop having our own task-format setting/detection; serialise tasks back in obsidian-tasks' own configured format, read from its persisted settings.

**Architecture:** Add `ObsidianTasksWrapper.getConfiguredFormat()` (reads obsidian-tasks' `loadData().taskFormat`). The adapter resolves the format once per write pass and passes it to `ObsidianMapper.toMarkdown`. Delete the `taskFormat` setting (type/default/UI), `ObsidianMapper.detectFormat`, and the per-task detection/fallback chains. Net change is mostly deletion.

**Tech Stack:** TypeScript, Jest (unit + e2e), wdio-obsidian-service, esbuild, Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-05-17-follow-tasks-configured-format-design.md`

---

## File Structure

- `src/tasks/obsidianTasksWrapper.ts` (modify) — new `getConfiguredFormat()`
- `src/sync/obsidianAdapter.ts` (modify) — use wrapper format; drop `taskFormat` from `ObsidianSyncSettings`; remove detect/fallback at the 3 `toMarkdown` sites
- `src/sync/syncEngine.ts` (modify) — stop passing `taskFormat` into the adapter
- `src/tasks/obsidianMapper.ts` (modify) — delete `detectFormat`
- `src/types.ts` (modify) — drop `taskFormat` from `CalDAVSettings` + default
- `main.ts` (modify) — delete the "Task format" Setting block
- Tests: `src/tasks/obsidianTasksWrapper.test.ts`, `src/sync/obsidianAdapter.test.ts`, `src/tasks/obsidianMapper.test.ts`, `test/wdio/helpers/dataviewVault.ts`

Task order matters: Task 1 adds the wrapper method; Task 2 switches the adapter to it AND removes `ObsidianSyncSettings.taskFormat` together with the now-broken `syncEngine.ts` line (coupled); Task 3 deletes the now-unused `detectFormat`; Task 4 removes the remaining `CalDAVSettings.taskFormat` + UI; Task 5 simplifies the wdio helper; Task 6 verifies.

---

### Task 1: `ObsidianTasksWrapper.getConfiguredFormat()`

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts` (add method after `getToggleCommand()`, near line 432)
- Test: `src/tasks/obsidianTasksWrapper.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/tasks/obsidianTasksWrapper.test.ts`, add this `describe` block at the end of the top-level `describe('ObsidianTasksWrapper', …)` (the file already mocks `mockApp` with `plugins: { plugins: {} }` and constructs the wrapper as `new ObsidianTasksWrapper(mockApp as unknown as App)` — match whatever construction the existing tests use; check an existing test in the file for the exact `as unknown as App` cast):

```ts
  describe('getConfiguredFormat', () => {
    function wrapperWith(tasksPlugin: unknown): ObsidianTasksWrapper {
      const app = { vault: {}, plugins: { plugins: tasksPlugin ? { 'obsidian-tasks-plugin': tasksPlugin } : {} } };
      return new ObsidianTasksWrapper(app as unknown as App);
    }

    it("returns 'dataview' when obsidian-tasks is configured for dataview", async () => {
      const w = wrapperWith({ loadData: jest.fn().mockResolvedValue({ taskFormat: 'dataview' }) });
      await expect(w.getConfiguredFormat()).resolves.toBe('dataview');
    });

    it("returns 'emoji' when obsidian-tasks is configured for tasksPluginEmoji", async () => {
      const w = wrapperWith({ loadData: jest.fn().mockResolvedValue({ taskFormat: 'tasksPluginEmoji' }) });
      await expect(w.getConfiguredFormat()).resolves.toBe('emoji');
    });

    it("returns 'emoji' when taskFormat key is missing", async () => {
      const w = wrapperWith({ loadData: jest.fn().mockResolvedValue({}) });
      await expect(w.getConfiguredFormat()).resolves.toBe('emoji');
    });

    it("returns 'emoji' when loadData returns null", async () => {
      const w = wrapperWith({ loadData: jest.fn().mockResolvedValue(null) });
      await expect(w.getConfiguredFormat()).resolves.toBe('emoji');
    });

    it("returns 'emoji' when the obsidian-tasks plugin is absent", async () => {
      const w = wrapperWith(null);
      await expect(w.getConfiguredFormat()).resolves.toBe('emoji');
    });

    it("returns 'emoji' when loadData throws", async () => {
      const w = wrapperWith({ loadData: jest.fn().mockRejectedValue(new Error('boom')) });
      await expect(w.getConfiguredFormat()).resolves.toBe('emoji');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit obsidianTasksWrapper.test.ts -t getConfiguredFormat`
Expected: FAIL — `w.getConfiguredFormat is not a function`.

- [ ] **Step 3: Implement the method**

In `src/tasks/obsidianTasksWrapper.ts`, add this method immediately after `getToggleCommand()` (mirror that method's `app.plugins.plugins` access pattern; do not use `this.tasksPlugin`):

```ts
    /**
     * The task format obsidian-tasks itself is configured to write.
     * Read from its persisted settings (its in-memory settings live in a
     * module closure and are not reliably exposed). Anything other than
     * 'dataview' — including a missing plugin or a read error — maps to
     * 'emoji', which is obsidian-tasks' own default.
     */
    async getConfiguredFormat(): Promise<'emoji' | 'dataview'> {
        const appWithPlugins = this.app as App & {
            plugins: { plugins: Record<string, { loadData?: () => Promise<unknown> }> };
        };
        const tasksPlugin = appWithPlugins.plugins.plugins['obsidian-tasks-plugin'];
        if (!tasksPlugin || typeof tasksPlugin.loadData !== 'function') {
            return 'emoji';
        }
        try {
            const data = await tasksPlugin.loadData();
            const fmt = (data as { taskFormat?: unknown } | null)?.taskFormat;
            return fmt === 'dataview' ? 'dataview' : 'emoji';
        } catch {
            return 'emoji';
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit obsidianTasksWrapper.test.ts -t getConfiguredFormat`
Expected: PASS, 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: read obsidian-tasks' configured task format"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 2: Adapter serialises in the configured format

**Files:**
- Modify: `src/sync/obsidianAdapter.ts` (interface ~17-24; `applyChanges` create ~115-119 and update ~140-148; `writeBackIds` ~218-226)
- Modify: `src/sync/syncEngine.ts` (~line 58, the `taskFormat:` line in the `new ObsidianAdapter(...)` options)
- Test: `src/sync/obsidianAdapter.test.ts`

- [ ] **Step 1: Update the failing tests**

In `src/sync/obsidianAdapter.test.ts`:

(a) Add `getConfiguredFormat` to `dummyWrapper` (the object literal starting `const dummyWrapper = {`), after the `getToggleCommand:` line:

```ts
  getConfiguredFormat: jest.fn().mockResolvedValue('emoji'),
```

(b) Replace the ENTIRE `describe('applyChanges — task format selection', …)` block and the ENTIRE `describe('writeBackIds — format detection', …)` block with the following single block (it removes all `taskFormat`-in-settings and `detectFormat` semantics; format now comes only from `wrapper.getConfiguredFormat()`):

```ts
  describe('applyChanges / writeBackIds — serialise in obsidian-tasks configured format', () => {
    const commonTask: CommonTask = {
      uid: 'task-001', title: 'Configured format task', status: 'TODO',
      dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
      priority: 'none', tags: [], recurrenceRule: '', body: '',
    };

    it('creates new tasks in dataview when obsidian-tasks is configured for dataview', async () => {
      let written = '';
      const createTask = jest.fn().mockImplementation((markdown: string) => { written = markdown; return Promise.resolve(); });
      const wrapper = {
        ...dummyWrapper, createTask,
        getConfiguredFormat: jest.fn().mockResolvedValue('dataview'),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      expect(written).toContain('[id:: ');
      expect(written).not.toContain('🆔');
    });

    it('creates new tasks in emoji when obsidian-tasks is configured for emoji', async () => {
      let written = '';
      const createTask = jest.fn().mockImplementation((markdown: string) => { written = markdown; return Promise.resolve(); });
      const wrapper = {
        ...dummyWrapper, createTask,
        getConfiguredFormat: jest.fn().mockResolvedValue('emoji'),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      expect(written).toContain('🆔 ');
      expect(written).not.toContain('[id:: ');
    });

    it('rewrites an updated task in the configured format regardless of its prior format', async () => {
      let written = '';
      const updateTaskInVault = jest.fn().mockImplementation((_t: unknown, markdown: string) => { written = markdown; return Promise.resolve(); });
      const existing = makeTask({ id: 'task-001', originalMarkdown: '- [ ] Old 📅 2025-01-01 🆔 task-001 #sync' });
      const wrapper = {
        ...dummyWrapper,
        findTaskById: jest.fn().mockReturnValue(existing),
        updateTaskInVault,
        getConfiguredFormat: jest.fn().mockResolvedValue('dataview'),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      await adapter.applyChanges([{ type: 'update', task: commonTask }]);

      expect(written).toContain('[id:: task-001]');
      expect(written).not.toContain('🆔');
    });

    it('writes back a generated id in the configured format', async () => {
      let written = '';
      const updateTaskInVault = jest.fn().mockImplementation((_t: unknown, markdown: string) => { written = markdown; return Promise.resolve(); });
      const noIdTask = makeTask({ id: '', originalMarkdown: '- [ ] New task #sync' });
      const wrapper = {
        ...dummyWrapper,
        extractId: jest.fn().mockReturnValue(null),
        updateTaskInVault,
        getConfiguredFormat: jest.fn().mockResolvedValue('dataview'),
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, { syncTag: 'sync', newTasksDestination: 'Inbox.md' });

      const [normalized] = adapter.normalize([withBody(noIdTask)], () => null);
      await adapter.writeBackIds([normalized]);

      expect(updateTaskInVault).toHaveBeenCalledTimes(1);
      expect(written).toContain('[id:: ');
      expect(written).not.toContain('🆔');
    });
  });
```

Note: keep all OTHER existing describes in this file unchanged. If `CommonTask` is not already imported in the test file, check the top imports — it is used via `makeTask`/`withBody` helpers already in the file; only add an import if `tsc` later complains (it should not, the file already references these types).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit obsidianAdapter.test.ts -t "configured format"`
Expected: FAIL — adapter still reads `this.settings.taskFormat`/`this.mapper.detectFormat`; `getConfiguredFormat` is not consulted, so dataview cases produce `🆔`.

- [ ] **Step 3: Remove `taskFormat` from `ObsidianSyncSettings`**

In `src/sync/obsidianAdapter.ts`, delete this line from the `ObsidianSyncSettings` interface:

```ts
	taskFormat?: 'emoji' | 'dataview';
```

- [ ] **Step 4: Resolve format from the wrapper in `applyChanges`**

In `applyChanges`, immediately before the `for (const change of changes)` loop, add:

```ts
		const format = await this.wrapper.getConfiguredFormat();
```

Then in `case "create":` replace:

```ts
						const markdown = this.mapper.toMarkdown(
							taskWithId,
							this.settings.syncTag,
							this.settings.taskFormat ?? 'emoji',
						);
```

with:

```ts
						const markdown = this.mapper.toMarkdown(
							taskWithId,
							this.settings.syncTag,
							format,
						);
```

And in `case "update":` replace:

```ts
						const format =
							this.mapper.detectFormat(existingTask.originalMarkdown) ??
							this.settings.taskFormat ??
							'emoji';
						const markdown = this.mapper.toMarkdown(
							change.task,
							this.settings.syncTag,
							format,
						);
```

with:

```ts
						const markdown = this.mapper.toMarkdown(
							change.task,
							this.settings.syncTag,
							format,
						);
```

(The loop-scoped `format` const from the top of `applyChanges` is in scope in both `case` blocks.)

- [ ] **Step 5: Resolve format from the wrapper in `writeBackIds`**

In `writeBackIds`, immediately before the `for (const task of obsidianTasks)` loop, add:

```ts
		const format = await this.wrapper.getConfiguredFormat();
```

Then replace:

```ts
				const format =
					this.mapper.detectFormat(original.originalMarkdown) ??
					this.settings.taskFormat ??
					'emoji';
				const markdown = this.mapper.toMarkdown(
					task,
					this.settings.syncTag,
					format,
				);
```

with:

```ts
				const markdown = this.mapper.toMarkdown(
					task,
					this.settings.syncTag,
					format,
				);
```

- [ ] **Step 6: Remove the now-broken `syncEngine.ts` pass-through**

In `src/sync/syncEngine.ts`, in the `new ObsidianAdapter(wrapper, { … })` options object, delete the line:

```ts
			taskFormat: settings.taskFormat,
```

(`ObsidianSyncSettings` no longer has the field, so leaving it is a type error. `CalDAVSettings.taskFormat` still exists until Task 4 — that is fine, it is just unused now.)

- [ ] **Step 7: Run the adapter tests + type-check**

Run: `npx jest --selectProjects unit obsidianAdapter.test.ts`
Expected: PASS — the new "configured format" block (4 tests) passes; all other adapter tests still green.

Run: `./node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: exit 0 (no `taskFormat` type errors in adapter/syncEngine).

- [ ] **Step 8: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/sync/syncEngine.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat: serialise tasks in obsidian-tasks' configured format"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 3: Delete `ObsidianMapper.detectFormat`

**Files:**
- Modify: `src/tasks/obsidianMapper.ts` (remove `detectFormat`, ~lines 133-152)
- Modify: `src/tasks/obsidianMapper.test.ts` (remove the `describe('detectFormat', …)` block, ~lines 272-295)

- [ ] **Step 1: Confirm there are no remaining callers**

Run: `grep -rn "detectFormat" --include="*.ts" src main.ts test`
Expected: matches ONLY in `src/tasks/obsidianMapper.ts` (the method) and `src/tasks/obsidianMapper.test.ts` (its tests). If any other file still calls it, STOP — Task 2 was incomplete; fix that first.

- [ ] **Step 2: Delete the method**

In `src/tasks/obsidianMapper.ts`, delete the entire `detectFormat` method including its doc comment — from the `/**` line that begins "Detect which metadata format a task line uses" through the closing `}` of the method (the block that contains `if (/\[(due|scheduled|start|completion|repeat|recurrence|id|priority)::/.test(line))` and `if (/[📅⏳🛫✅🔁🆔]/u.test(line))`). Leave the surrounding methods (`toMarkdown`, `cleanDescription`, etc.) intact.

- [ ] **Step 3: Delete its tests**

In `src/tasks/obsidianMapper.test.ts`, delete the entire `describe('detectFormat', () => { … })` block (every `it` that calls `mapper.detectFormat(...)`). Leave the `toMarkdown` and other describes intact.

- [ ] **Step 4: Verify mapper tests pass and no dangling references**

Run: `grep -rn "detectFormat" --include="*.ts" src main.ts test || echo "NONE"`
Expected: `NONE`.

Run: `npx jest --selectProjects unit obsidianMapper.test.ts`
Expected: PASS — remaining mapper tests green (including the `toMarkdown` dataview tests, which still pass an explicit `format` arg).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianMapper.ts src/tasks/obsidianMapper.test.ts
git commit -m "refactor: remove ObsidianMapper.detectFormat (format now comes from obsidian-tasks)"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Remove the `taskFormat` setting and UI

**Files:**
- Modify: `src/types.ts` (interface ~line 19; default ~line 33)
- Modify: `main.ts` (the "Task format" `new Setting(...)` block, ~lines 273-282)

- [ ] **Step 1: Remove from `CalDAVSettings` and the default**

In `src/types.ts`, delete the line `  taskFormat: 'emoji' | 'dataview';` from the `CalDAVSettings` interface, and delete the line `  taskFormat: 'emoji',` from `DEFAULT_CALDAV_SETTINGS`.

- [ ] **Step 2: Remove the settings UI block**

In `main.ts`, delete the entire Setting block for task format — the block beginning:

```ts
		new Setting(containerEl)
			.setName('Task format')
```

through the end of its `.addDropdown(...)` chain (the closing `}));` of that `new Setting` call, just before the next `new Setting(containerEl)` for 'Show automatic sync notifications'). Remove that block entirely (its `.setDesc(...)` contained the "match this to your tasks plugin format" warning — it goes with the block). Do not touch the surrounding "Include Obsidian link" or "Show automatic sync notifications" blocks.

- [ ] **Step 3: Verify nothing references `taskFormat` anymore**

Run: `grep -rn "taskFormat" --include="*.ts" src main.ts test`
Expected: NO matches (empty output). If anything remains, remove it (it is dead by now).

- [ ] **Step 4: Type-check, lint, build**

Run: `./node_modules/.bin/tsc -noEmit -skipLibCheck`
Expected: exit 0.

Run: `npm run lint`
Expected: 0 errors (an `rtk` hook may misreport the exit code and ESLint may flag a stale `.obsidian-cache/` artifact from a prior local wdio run — that path is NOT part of this change; judge by whether any `src/`/`main.ts` file has errors).

Run: `npm run build`
Expected: exit 0; `main.js` regenerated.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts main.ts
git commit -m "feat: drop taskFormat setting; follow obsidian-tasks format"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 5: Simplify the wdio dataview helper

**Files:**
- Modify: `test/wdio/helpers/dataviewVault.ts`

- [ ] **Step 1: Confirm current content**

Run: `cat test/wdio/helpers/dataviewVault.ts`
Expected: it calls `browser.reloadObsidian({ vault: DATAVIEW_VAULT, plugins: [...] })` then a `browser.executeObsidian(...)` block that sets `plugin.settings.taskFormat = 'dataview'` on `tasks-caldav-sync`.

- [ ] **Step 2: Remove the runtime taskFormat flip**

Replace the entire contents of `test/wdio/helpers/dataviewVault.ts` with:

```ts
import path from 'node:path';
import { browser } from '@wdio/globals';

const DATAVIEW_VAULT = path.resolve('test/wdio/vault-dataview');

/** Reload Obsidian into the dataview-preset fixture vault with both plugins
 *  enabled. The vault's `obsidian-tasks-plugin/data.json` sets obsidian-tasks
 *  to dataview; our plugin now follows that automatically, so no runtime
 *  configuration is needed here. Call once in the spec's `before` hook.
 *
 *  The `plugins` list selects from the plugins already registered in
 *  `wdio.conf.mts` capabilities — it does not define new plugin paths. */
export async function openDataviewVault(): Promise<void> {
  await browser.reloadObsidian({
    vault: DATAVIEW_VAULT,
    plugins: ['tasks-caldav-sync', 'obsidian-tasks-plugin'],
  });
}
```

- [ ] **Step 3: Type-check the wdio project (project files only)**

Run: `./node_modules/.bin/tsc -p test/wdio/tsconfig.json --noEmit 2>&1 | grep -v node_modules | grep -E "error TS" || echo "NO PROJECT ERRORS"`
Expected: `NO PROJECT ERRORS`. (The wdio tsconfig surfaces ~19 pre-existing errors inside `node_modules/` only — those are not introduced by this change and are filtered out by the grep.)

- [ ] **Step 4: Run the full wdio suite**

Run: `npm run test:wdio`
Expected: all 6 specs pass, including `dataview full round-trip` — now proving our plugin follows obsidian-tasks' fixture dataview setting with NO runtime override. First run may download an Obsidian binary into `.obsidian-cache/` (several minutes); use a long timeout (up to 10 min); re-run if a download is interrupted (it caches). Requires Docker (Radicale). If the dataview spec fails because our plugin defaulted to emoji, that means `getConfiguredFormat()` did not read obsidian-tasks' fixture `data.json` — STOP and report it (do not re-add a runtime flip); it indicates a real Task 1/2 defect to fix at the source. Docker unavailable → report BLOCKED.

- [ ] **Step 5: Commit**

```bash
git add test/wdio/helpers/dataviewVault.ts
git commit -m "test(wdio): drop runtime taskFormat flip; plugin follows obsidian-tasks"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 6: Full verification + docs + push

**Files:**
- Modify: `CLAUDE.md` (the wdio section's dataview wording, if it references our runtime flip / taskFormat setting)

- [ ] **Step 1: Update CLAUDE.md if it references the removed setting**

Run: `grep -n "taskFormat\|Task format\|runtime in .test/wdio" CLAUDE.md`
For any line in the `### Obsidian smoke tests (wdio)` section that says our plugin's dataview is set at runtime or references a `taskFormat` setting, reword to: the dataview spec uses `test/wdio/vault-dataview/` whose obsidian-tasks settings are preset to dataview; our plugin follows obsidian-tasks' configured format automatically (no setting). Keep the rest of CLAUDE.md unchanged. If `grep` finds nothing relevant, skip this step (no commit needed for it).

- [ ] **Step 2: Full test suite with coverage**

Run: `npm test`
Expected: all unit + e2e projects pass; coverage thresholds for `src/sync/`, `src/caldav/`, `src/tasks/` still met. This change is net-deletion plus one small wrapper method (unit-tested in Task 1) — if `src/tasks/` or `src/sync/` branch coverage dipped below threshold, add a focused wrapper or adapter case until green (do not lower thresholds).

- [ ] **Step 3: Commit any CLAUDE.md change**

```bash
git add CLAUDE.md
git commit -m "docs: wdio dataview now relies on obsidian-tasks format, not a setting" || echo "nothing to commit"
```
Append a blank line then:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 4: Push and verify CI**

```bash
git push origin feat/dataview-support
```
Then watch CI for the pushed HEAD (workflows are `pull_request`-triggered for PR #85): `git rev-parse HEAD`, then `gh api "repos/:owner/:repo/commits/<sha>/check-runs" --jq '.check_runs[]|"\(.conclusion // .status) | \(.name)"'`, polling (~60s, up to ~15 min) until `lint-and-typecheck`, `test-core`, `test-e2e-*`, and `wdio` complete. Expected: all `success`. If a workflow does not appear for the new commit within a few minutes (a previously observed GitHub quirk), push an empty commit (`git commit --allow-empty -m "ci: re-trigger" && git push`) to force a fresh `pull_request` synchronize, then poll again. Report the final per-check conclusions, especially `wdio` and the Jest `test-e2e-*` jobs.

---

## Self-Review

**Spec coverage:**
- `getConfiguredFormat()` reading obsidian-tasks `loadData().taskFormat`, fallbacks (missing/absent/throw → emoji) → Task 1 ✓
- Adapter serialises via wrapper format at create/update/writeBack; no detection/setting chain → Task 2 ✓
- `detectFormat` deleted (+ tests) → Task 3 ✓
- `CalDAVSettings.taskFormat`/default/UI/warning removed; `syncEngine` pass-through removed → Tasks 2 (engine line) + 4 (type/UI) ✓
- No migration; stale key ignored → inherent (nothing reads it after Task 4); no task needed ✓
- Tests: wrapper getConfiguredFormat cases, adapter configured-format cases, detectFormat tests deleted, wdio helper simplified → Tasks 1,2,3,5 ✓
- Out of scope (read/parse path, per-task preservation, obsidian-tasks API) → untouched ✓
- Risk: async resolve before serialise → Task 2 resolves `await this.wrapper.getConfiguredFormat()` once per pass before the loop ✓

**Placeholder scan:** No TBD/"handle edge cases"; every code step shows full code; every command has expected output; the one CLAUDE.md step is conditional on a concrete `grep` result with explicit skip instruction (not a placeholder).

**Type consistency:** `getConfiguredFormat(): Promise<'emoji' | 'dataview'>` defined in Task 1, mocked in Task 2 (`jest.fn().mockResolvedValue('emoji'|'dataview')`), consumed via `await this.wrapper.getConfiguredFormat()` in Task 2. `toMarkdown(task, syncTag?, format)` signature unchanged (Task 3 only deletes `detectFormat`, not `toMarkdown`). `ObsidianSyncSettings` loses `taskFormat` (Task 2) consistently with `syncEngine.ts` line removal (Task 2 Step 6) and `CalDAVSettings` removal (Task 4). Method placed after `getToggleCommand()` and mirrors its `app.plugins.plugins` access — consistent with existing wrapper style.
