# Hide automatic sync notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a setting that silences the routine "Starting sync…" / "Sync complete!" notices for automatic background sync only; manual sync and errors always notify.

**Architecture:** Add `showAutoSyncNotifications` to `CalDAVSettings` (default `false`). Thread a `background` flag into `SyncEngine.sync()`. The two routine notices are gated by `!background || settings.showAutoSyncNotifications`; the error notice is never gated. `main.ts` passes `background=true` from the auto-sync path and `false` from manual commands, and exposes the setting as a toggle.

**Tech Stack:** TypeScript, Obsidian plugin API, Jest (unit), esbuild.

Spec: `docs/superpowers/specs/2026-05-17-hide-sync-notifications-design.md`

---

### Task 1: Make the `Notice` test mock spyable

**Files:**
- Modify: `__mocks__/obsidian.ts:25-29`

- [ ] **Step 1: Replace the inert `Notice` class with a jest mock function**

In `__mocks__/obsidian.ts`, replace this block:

```ts
export class Notice {
    constructor(_message: string, _timeout?: number) {
        // Mock notice - does nothing in tests
    }
}
```

with:

```ts
export const Notice = jest.fn(function Notice(_message: string, _timeout?: number) {
    // Mock notice - records calls so tests can assert
});
```

`jest.fn` is callable with `new`, so existing `new Notice(...)` call sites keep working. `jest.clearAllMocks()` (already in the `beforeEach` of `syncEngine.test.ts`) resets it between tests.

- [ ] **Step 2: Verify the existing suite still passes**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts`
Expected: PASS (no behavior change yet; this only swaps the mock implementation).

- [ ] **Step 3: Commit**

```bash
git add __mocks__/obsidian.ts
git commit -m "test: make Notice mock spyable"
```

---

### Task 2: Add the `showAutoSyncNotifications` setting

**Files:**
- Modify: `src/types.ts:9-31`

- [ ] **Step 1: Add the field to the interface**

In `src/types.ts`, inside `interface CalDAVSettings`, add the field after `includeObsidianLink: boolean;`:

```ts
  includeObsidianLink: boolean;
  showAutoSyncNotifications: boolean;
}
```

- [ ] **Step 2: Add the default value**

In `DEFAULT_CALDAV_SETTINGS`, add after `includeObsidianLink: false,`:

```ts
  includeObsidianLink: false,
  showAutoSyncNotifications: false,
};
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add showAutoSyncNotifications setting (default off)"
```

---

### Task 3: Gate the "Starting sync…" notice on the background flag

**Files:**
- Modify: `src/sync/syncEngine.ts:64-66`
- Test: `src/sync/syncEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `src/sync/syncEngine.test.ts`, immediately after the `describe('error handling', ...)` block closes (before the final closing of `describe('SyncEngine', ...)`). Add `Notice` to the obsidian import on line 1 so it reads:

```ts
import { App, Notice } from 'obsidian';
```

Then add:

```ts
  describe('sync notifications', () => {
    it('suppresses the start notice for background sync when the setting is off', async () => {
      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping(),
        makeSettings({ showAutoSyncNotifications: false }),
      );
      await engine.initialize();

      await engine.sync(false, true);

      const startCalls = (Notice as jest.Mock).mock.calls
        .filter(([msg]) => typeof msg === 'string' && msg.includes('Starting sync'));
      expect(startCalls).toHaveLength(0);
    });

    it('shows the start notice for background sync when the setting is on', async () => {
      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping(),
        makeSettings({ showAutoSyncNotifications: true }),
      );
      await engine.initialize();

      await engine.sync(false, true);

      const startCalls = (Notice as jest.Mock).mock.calls
        .filter(([msg]) => typeof msg === 'string' && msg.includes('Starting sync'));
      expect(startCalls.length).toBeGreaterThan(0);
    });

    it('shows the start notice for manual sync even when the setting is off', async () => {
      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping(),
        makeSettings({ showAutoSyncNotifications: false }),
      );
      await engine.initialize();

      await engine.sync(false, false);

      const startCalls = (Notice as jest.Mock).mock.calls
        .filter(([msg]) => typeof msg === 'string' && msg.includes('Starting sync'));
      expect(startCalls.length).toBeGreaterThan(0);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit -t "sync notifications"`
Expected: FAIL. The first test fails because `sync()` ignores the (currently non-existent) second argument and always fires the start notice.

- [ ] **Step 3: Add the `background` param and gate the start notice**

In `src/sync/syncEngine.ts`, change the `sync` signature (line 64) and the start notice (line 66):

```ts
	async sync(dryRun: boolean = false, background: boolean = false): Promise<SyncResult> {
		try {
			const showProgress = !background || this.settings.showAutoSyncNotifications;
			if (showProgress) {
				new Notice(`${dryRun ? "[DRY RUN] " : ""}Starting sync for ${this.calendar.calendarName}...`);
			}
```

Leave the rest of the `try` body unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit -t "sync notifications"`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncEngine.ts src/sync/syncEngine.test.ts
git commit -m "feat: gate sync start notice on background flag"
```

---

### Task 4: Gate the completion notice; keep the error notice unconditional

**Files:**
- Modify: `src/sync/syncEngine.ts:77,87,245-251,268,307-310`
- Test: `src/sync/syncEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe('sync notifications', ...)` block created in Task 3:

```ts
    it('suppresses the completion notice for background sync when the setting is off but still returns the result', async () => {
      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping(),
        makeSettings({ showAutoSyncNotifications: false }),
      );
      await engine.initialize();

      const result = await engine.sync(false, true);

      const completeCalls = (Notice as jest.Mock).mock.calls
        .filter(([msg]) => typeof msg === 'string' && msg.includes('Sync complete'));
      expect(completeCalls).toHaveLength(0);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Sync complete');
    });

    it('always shows the error notice for background sync even when the setting is off', async () => {
      mockConnect.mockRejectedValue(new Error('Connection refused'));
      const engine = new SyncEngine(
        new App(),
        makeCalendarMapping(),
        makeSettings({ showAutoSyncNotifications: false }),
      );
      await engine.initialize();

      const result = await engine.sync(false, true);

      const errorCalls = (Notice as jest.Mock).mock.calls
        .filter(([msg]) => typeof msg === 'string' && msg.includes('Sync failed'));
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(result.success).toBe(false);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit -t "sync notifications"`
Expected: FAIL on "suppresses the completion notice…" — `buildResult` still calls `new Notice(message, ...)` unconditionally. The "always shows the error notice…" test should already PASS (the error notice is untouched); keep it as a regression guard.

- [ ] **Step 3: Thread `showProgress` into `buildResult` and gate the completion notice**

In `src/sync/syncEngine.ts`:

a. In `sync()`, pass `showProgress` to both `buildResult` calls. Replace line 77:

```ts
			if (dryRun) return this.buildResult(changeset, obsidianTasks, caldavTasks, baseline, true, showProgress);
```

and replace line 87:

```ts
			return this.buildResult(changeset, obsidianTasks, caldavTasks, baseline, false, showProgress);
```

b. Add the parameter to the `buildResult` signature (lines 245-251):

```ts
	private buildResult(
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[]; conflicts: Conflict[] },
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		baseline: CommonTask[],
		dryRun: boolean,
		showProgress: boolean,
	): SyncResult {
```

c. Gate the completion notice (line 268):

```ts
		if (showProgress) {
			new Notice(message, dryRun ? 10000 : 5000);
		}
```

Do **not** modify `buildErrorResult` (line ~307-310) — its `new Notice(message, 8000)` must stay unconditional.

- [ ] **Step 4: Run the full sync-notifications group to verify it passes**

Run: `npx jest --selectProjects unit -t "sync notifications"`
Expected: PASS (all five tests in the group).

- [ ] **Step 5: Run the whole syncEngine suite for regressions**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts`
Expected: PASS (existing tests use `sync(true)` / `sync(false)` → `background` defaults to `false` → notices still fire as before).

- [ ] **Step 6: Commit**

```bash
git add src/sync/syncEngine.ts src/sync/syncEngine.test.ts
git commit -m "feat: gate sync completion notice; keep error notice unconditional"
```

---

### Task 5: Wire the background flag from `main.ts` and add the settings toggle

**Files:**
- Modify: `main.ts:165-177` (sync call sites)
- Modify: `main.ts:244-252` (settings UI — add toggle after the "Include Obsidian link" setting)

- [ ] **Step 1: Pass `background=true` from the auto-sync path**

In `main.ts`, in `syncAll()` (the method passed to `AutoSyncScheduler`), change:

```ts
	private async syncAll(): Promise<void> {
		for (const engine of this.syncEngines) {
			await engine.sync(false, true);
		}
	}
```

- [ ] **Step 2: Keep manual commands explicit and unchanged in behavior**

In `main.ts`, in `syncAllEngines(dryRun)`, change the call to be explicit:

```ts
	private async syncAllEngines(dryRun: boolean): Promise<SyncResult[]> {
		const results: SyncResult[] = [];
		for (const engine of this.syncEngines) {
			results.push(await engine.sync(dryRun, false));
		}
		return results;
	}
```

- [ ] **Step 3: Add the settings toggle**

In `main.ts`, immediately after the "Include Obsidian link in synced tasks" `new Setting(containerEl)...` block (ends at line ~252, before the `new Setting(containerEl).setName('Conflict resolution').setHeading();` block), insert:

```ts
		new Setting(containerEl)
			.setName('Show automatic sync notifications')
			.setDesc('Show progress notices when sync runs automatically in the background. Manual sync and errors always notify.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showAutoSyncNotifications)
				.onChange(async (value) => {
					this.plugin.settings.showAutoSyncNotifications = value;
					await this.plugin.saveSettings();
				}));
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc -noEmit -skipLibCheck && npm run lint`
Expected: PASS (no type errors, no lint errors).

- [ ] **Step 5: Commit**

```bash
git add main.ts
git commit -m "feat: silence background sync notices via setting; manual always notifies"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm test`
Expected: PASS — all unit + e2e tests green, and `src/sync/` coverage still ≥ 80% lines / 80% branches (the new `showProgress` branch is exercised by the Task 3/4 tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: PASS (type check + esbuild bundle succeed).

- [ ] **Step 3: Final commit (only if anything is uncommitted)**

```bash
git status --porcelain
```

Expected: empty output. If not empty, review and commit the remaining changes with an appropriate message.
