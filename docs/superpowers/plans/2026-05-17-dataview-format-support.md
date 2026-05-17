# Dataview format support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the plugin serialize obsidian-tasks in dataview format (`[due:: 2025-01-15]`) as well as emoji, choosing per the spec's option "D": a global default for new tasks, auto-detected format preservation for updates.

**Architecture:** Add a `taskFormat` setting. `ObsidianMapper.toMarkdown` gains a positional `format` arg (default `'emoji'`, keeping all existing call sites and tests untouched) and dispatches to `toEmojiMarkdown` (current logic, moved) or new `toDataviewMarkdown`. A new pure `detectFormat(line)` reads the format off an existing task line. `ObsidianAdapter` chooses format per change: creates use the setting, updates/writeBacks use `detectFormat() ?? setting`.

**Tech Stack:** TypeScript, Jest (unit project), esbuild, Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-05-17-dataview-format-support-design.md`

**Signature note (deliberate refinement of spec):** The spec proposed an options object `toMarkdown(task, { syncTag, format })`. We instead use a positional third parameter `toMarkdown(task, syncTag?, format = 'emoji')`. Rationale: 15 existing tests and 3 adapter call sites already pass `syncTag` positionally; a default-valued positional `format` keeps every one of them working without churn, and matches the existing positional `syncTag` style. Behaviour is identical to the spec.

---

### Task 1: Add `taskFormat` setting to types

**Files:**
- Modify: `src/types.ts:9-31`

- [ ] **Step 1: Add the field to the interface and the default**

In `src/types.ts`, add `taskFormat` to the `CalDAVSettings` interface (after `includeObsidianLink`):

```ts
export interface CalDAVSettings {
  calendars: CalendarMapping[];
  syncInterval: number;
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
  includeObsidianLink: boolean;
  taskFormat: 'emoji' | 'dataview';
}
```

And add it to `DEFAULT_CALDAV_SETTINGS` (after `includeObsidianLink: false,`):

```ts
export const DEFAULT_CALDAV_SETTINGS: CalDAVSettings = {
  calendars: [],
  syncInterval: 5,
  newTasksDestination: 'Inbox.md',
  newTasksSection: undefined,
  requireManualConflictResolution: true,
  autoResolveObsidianWins: false,
  syncCompletedTasks: false,
  deleteBehavior: 'ask',
  includeObsidianLink: false,
  taskFormat: 'emoji',
};
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exits 0, no errors. (Existing settings users get `taskFormat: 'emoji'` via the `Object.assign({}, DEFAULT_SETTINGS, await loadData())` merge in `main.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add taskFormat setting (default emoji)"
```

---

### Task 2: `ObsidianMapper.detectFormat`

**Files:**
- Modify: `src/tasks/obsidianMapper.ts`
- Test: `src/tasks/ObsidianMapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('ObsidianMapper', ...)` in `src/tasks/ObsidianMapper.test.ts` (e.g. after the `toMarkdown` block):

```ts
  describe('detectFormat', () => {
    it('detects emoji from a date emoji', () => {
      expect(mapper.detectFormat('- [ ] Task 📅 2025-01-15 🆔 abc')).toBe('emoji');
    });

    it('detects emoji from the id emoji alone', () => {
      expect(mapper.detectFormat('- [ ] Task 🆔 abc')).toBe('emoji');
    });

    it('detects dataview from a bracket field', () => {
      expect(mapper.detectFormat('- [ ] Task [due:: 2025-01-15] [id:: abc]')).toBe('dataview');
    });

    it('returns null for a bare task line with no metadata', () => {
      expect(mapper.detectFormat('- [ ] Just a task')).toBeNull();
    });

    it('prefers dataview when a line mixes both', () => {
      expect(mapper.detectFormat('- [ ] Task 📅 2025-01-15 [id:: abc]')).toBe('dataview');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit -t detectFormat`
Expected: FAIL — `mapper.detectFormat is not a function`.

- [ ] **Step 3: Implement `detectFormat`**

In `src/tasks/obsidianMapper.ts`, add this public method to the `ObsidianMapper` class (place it right after `toMarkdown`, before the private helpers):

```ts
  /**
   * Detect which metadata format a task line uses, or null if it has none.
   * Dataview is checked first so a line that mixes both resolves to the
   * unambiguous bracket syntax.
   */
  detectFormat(line: string): 'emoji' | 'dataview' | null {
    if (/\[(due|scheduled|start|completion|repeat|recurrence|id|priority)::/.test(line)) {
      return 'dataview';
    }
    if (/[📅⏳🛫✅🔁🆔]/u.test(line)) {
      return 'emoji';
    }
    return null;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit -t detectFormat`
Expected: PASS, 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianMapper.ts src/tasks/ObsidianMapper.test.ts
git commit -m "feat: add ObsidianMapper.detectFormat"
```

---

### Task 3: Dataview serialization in `toMarkdown`

**Files:**
- Modify: `src/tasks/obsidianMapper.ts:37-86`
- Test: `src/tasks/ObsidianMapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('ObsidianMapper', ...)` in `src/tasks/ObsidianMapper.test.ts`:

```ts
  describe('toMarkdown — dataview format', () => {
    const baseTask: CommonTask = {
      uid: 'test-id', title: 'Test task', status: 'TODO',
      dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
      priority: 'none', tags: [], recurrenceRule: '', body: '',
    };

    it('serializes a TODO with id', () => {
      expect(mapper.toMarkdown(baseTask, 'sync', 'dataview'))
        .toBe('- [ ] Test task [id:: test-id] #sync');
    });

    it('serializes a DONE task', () => {
      const task = { ...baseTask, status: 'DONE' as const };
      expect(mapper.toMarkdown(task, 'sync', 'dataview'))
        .toBe('- [x] Test task [id:: test-id] #sync');
    });

    it('emits all dates with dataview keys in start/scheduled/due/completion order', () => {
      const task: CommonTask = {
        ...baseTask, status: 'DONE',
        dueDate: '2025-01-15', startDate: '2025-01-08',
        scheduledDate: '2025-01-10', completedDate: '2025-01-12',
      };
      const md = mapper.toMarkdown(task, 'sync', 'dataview');
      expect(md).toContain('[start:: 2025-01-08]');
      expect(md).toContain('[scheduled:: 2025-01-10]');
      expect(md).toContain('[due:: 2025-01-15]');
      expect(md).toContain('[completion:: 2025-01-12]');
      expect(md.indexOf('[start::')).toBeLessThan(md.indexOf('[scheduled::'));
      expect(md.indexOf('[scheduled::')).toBeLessThan(md.indexOf('[due::'));
      expect(md.indexOf('[due::')).toBeLessThan(md.indexOf('[completion::'));
    });

    it('emits recurrence as repeat with human-readable text', () => {
      const task = { ...baseTask, recurrenceRule: 'FREQ=DAILY', dueDate: '2026-02-15' };
      const md = mapper.toMarkdown(task, 'sync', 'dataview');
      expect(md).toContain('[repeat:: every day]');
      expect(md).not.toContain('FREQ=DAILY');
    });

    it('places non-sync tags before dataview fields and sync tag last', () => {
      const task = { ...baseTask, tags: ['sync', 'shopping'], dueDate: '2025-01-15' };
      const md = mapper.toMarkdown(task, 'sync', 'dataview');
      expect(md.indexOf('#shopping')).toBeLessThan(md.indexOf('[due::'));
      expect(md.indexOf('[id:: test-id]')).toBeLessThan(md.indexOf('#sync'));
      expect((md.match(/#sync/g) || []).length).toBe(1);
    });

    it('appends body as indented bullets', () => {
      const task = { ...baseTask, uid: 'id', title: 'Task with body', body: 'First note\nSecond note' };
      expect(mapper.toMarkdown(task, 'sync', 'dataview'))
        .toBe('- [ ] Task with body [id:: id] #sync\n    - First note\n    - Second note');
    });

    it('defaults to emoji when no format argument is given', () => {
      expect(mapper.toMarkdown(baseTask, 'sync'))
        .toBe('- [ ] Test task 🆔 test-id #sync');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit -t "toMarkdown — dataview format"`
Expected: FAIL — `toMarkdown` ignores the 3rd argument and emits emoji output (e.g. expected `[id:: test-id]` but got `🆔 test-id`).

- [ ] **Step 3: Refactor `toMarkdown` to dispatch, move emoji logic, add dataview**

In `src/tasks/obsidianMapper.ts`, replace the entire current `toMarkdown` method (lines 33-86, from the `/** Serialize: ... */` doc comment through the closing `}` of `toMarkdown`) with the following three methods:

```ts
  /**
   * Serialize: CommonTask → obsidian-tasks markdown string.
   * Uses task.uid for the id field. `format` defaults to 'emoji' so
   * existing callers are unaffected.
   */
  toMarkdown(task: CommonTask, syncTag?: string, format: 'emoji' | 'dataview' = 'emoji'): string {
    return format === 'dataview'
      ? this.toDataviewMarkdown(task, syncTag)
      : this.toEmojiMarkdown(task, syncTag);
  }

  private toEmojiMarkdown(task: CommonTask, syncTag?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = syncTag?.replace(/^#/, '').trim();
    const nonSyncTags = task.tags.filter(t => t !== syncTagName);
    for (const tag of nonSyncTags) {
      line += ` #${tag}`;
    }

    // Dates in obsidian-tasks order: start, scheduled, due, completed
    if (task.startDate) {
      line += ` 🛫 ${task.startDate}`;
    }
    if (task.scheduledDate) {
      line += ` ⏳ ${task.scheduledDate}`;
    }
    if (task.dueDate) {
      line += ` 📅 ${task.dueDate}`;
    }
    if (task.completedDate) {
      line += ` ✅ ${task.completedDate}`;
    }

    // Recurrence rule in obsidian-tasks format
    if (task.recurrenceRule) {
      const text = this.rruleToText(task.recurrenceRule);
      if (text) {
        line += ` 🔁 ${text}`;
      }
    }

    // Task ID in obsidian-tasks emoji format
    line += ` 🆔 ${task.uid}`;

    // Sync tag after ID
    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    return this.appendBody(line, task.body);
  }

  private toDataviewMarkdown(task: CommonTask, syncTag?: string): string {
    let line = task.status === 'DONE' ? '- [x] ' : '- [ ] ';

    line += task.title;

    const syncTagName = syncTag?.replace(/^#/, '').trim();
    const nonSyncTags = task.tags.filter(t => t !== syncTagName);
    for (const tag of nonSyncTags) {
      line += ` #${tag}`;
    }

    // Dates in obsidian-tasks order: start, scheduled, due, completed
    if (task.startDate) {
      line += ` [start:: ${task.startDate}]`;
    }
    if (task.scheduledDate) {
      line += ` [scheduled:: ${task.scheduledDate}]`;
    }
    if (task.dueDate) {
      line += ` [due:: ${task.dueDate}]`;
    }
    if (task.completedDate) {
      line += ` [completion:: ${task.completedDate}]`;
    }

    if (task.recurrenceRule) {
      const text = this.rruleToText(task.recurrenceRule);
      if (text) {
        line += ` [repeat:: ${text}]`;
      }
    }

    line += ` [id:: ${task.uid}]`;

    if (syncTag && syncTag.trim() !== '') {
      const tag = syncTag.startsWith('#') ? syncTag : `#${syncTag}`;
      line += ` ${tag}`;
    }

    return this.appendBody(line, task.body);
  }

  /** Append the task body as indented bullet lines, if any. */
  private appendBody(line: string, body: string): string {
    if (!body) return line;
    const bodyLines = body.split('\n').map(l => `    - ${l}`);
    return line + '\n' + bodyLines.join('\n');
  }
```

Note: `appendBody` is a DRY extraction of the identical body logic that was inline in the old `toMarkdown`; both serializers now call it.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest --selectProjects unit -t "toMarkdown — dataview format"`
Expected: PASS, 7 passing.

- [ ] **Step 5: Run the full mapper test file to confirm no regression**

Run: `npx jest --selectProjects unit ObsidianMapper.test.ts`
Expected: PASS — all existing emoji `toMarkdown` tests and `toCommonTask` tests still green (they call `toMarkdown(task, 'sync')`, which defaults to emoji).

- [ ] **Step 6: Commit**

```bash
git add src/tasks/obsidianMapper.ts src/tasks/ObsidianMapper.test.ts
git commit -m "feat: dataview serialization in ObsidianMapper.toMarkdown"
```

---

### Task 4: Adapter chooses format per change

**Files:**
- Modify: `src/sync/obsidianAdapter.ts:17-24` (interface), `:108-145` (create/update), `:204-224` (writeBackIds)
- Test: `src/sync/obsidianAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('ObsidianAdapter', ...)` in `src/sync/obsidianAdapter.test.ts`:

```ts
  describe('applyChanges — task format selection', () => {
    const commonTask = {
      uid: 'task-001', title: 'New task', status: 'TODO' as const,
      dueDate: null, startDate: null, scheduledDate: null, completedDate: null,
      priority: 'none' as const, tags: [], recurrenceRule: '', body: '',
    };

    it('creates new tasks using the configured dataview format', async () => {
      const createTask = jest.fn().mockResolvedValue(undefined);
      const wrapper = { ...dummyWrapper, createTask } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, {
        syncTag: 'sync', newTasksDestination: 'Inbox.md', taskFormat: 'dataview',
      });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      const written = createTask.mock.calls[0][0] as string;
      expect(written).toContain('[id:: ');
      expect(written).not.toContain('🆔');
    });

    it('creates new tasks using emoji when taskFormat is emoji', async () => {
      const createTask = jest.fn().mockResolvedValue(undefined);
      const wrapper = { ...dummyWrapper, createTask } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, {
        syncTag: 'sync', newTasksDestination: 'Inbox.md', taskFormat: 'emoji',
      });

      await adapter.applyChanges([{ type: 'create', task: commonTask }]);

      expect(createTask.mock.calls[0][0] as string).toContain('🆔 ');
    });

    it('preserves an existing task\'s dataview format on update even when setting is emoji', async () => {
      const updateTaskInVault = jest.fn().mockResolvedValue(undefined);
      const existing = makeTask({
        id: 'task-001',
        originalMarkdown: '- [ ] Old [due:: 2025-01-01] [id:: task-001] #sync',
      });
      const wrapper = {
        ...dummyWrapper,
        findTaskById: jest.fn().mockReturnValue(existing),
        updateTaskInVault,
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, {
        syncTag: 'sync', newTasksDestination: 'Inbox.md', taskFormat: 'emoji',
      });

      await adapter.applyChanges([{ type: 'update', task: commonTask }]);

      const written = updateTaskInVault.mock.calls[0][1] as string;
      expect(written).toContain('[id:: task-001]');
      expect(written).not.toContain('🆔');
    });

    it('falls back to the configured format when an updated task has no detectable format', async () => {
      const updateTaskInVault = jest.fn().mockResolvedValue(undefined);
      const existing = makeTask({
        id: 'task-001',
        originalMarkdown: '- [ ] Bare task',
      });
      const wrapper = {
        ...dummyWrapper,
        findTaskById: jest.fn().mockReturnValue(existing),
        updateTaskInVault,
      } as unknown as ObsidianTasksWrapper;
      const adapter = new ObsidianAdapter(wrapper, {
        syncTag: 'sync', newTasksDestination: 'Inbox.md', taskFormat: 'dataview',
      });

      await adapter.applyChanges([{ type: 'update', task: commonTask }]);

      expect(updateTaskInVault.mock.calls[0][1] as string).toContain('[id:: task-001]');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit -t "task format selection"`
Expected: FAIL — `taskFormat` is not a known property of `ObsidianSyncSettings` (TS error) and/or output is emoji because the adapter never passes a format to `toMarkdown`.

- [ ] **Step 3: Add `taskFormat` to `ObsidianSyncSettings`**

In `src/sync/obsidianAdapter.ts`, extend the interface (currently lines 17-24):

```ts
export interface ObsidianSyncSettings {
	syncTag?: string;
	newTasksDestination: string;
	newTasksSection?: string;
	includeObsidianLink?: boolean;
	taskFormat?: 'emoji' | 'dataview';
	// Called at normalize time so vault renames are picked up without reconstructing the adapter.
	getVaultName?: () => string;
}
```

It is optional so existing test settings objects (e.g. `defaultSettings`, which omits it) keep compiling; `undefined` is treated as `'emoji'`.

- [ ] **Step 4: Use the format in create**

In `src/sync/obsidianAdapter.ts`, in `applyChanges`, the `case "create":` block currently calls:

```ts
							const markdown = this.mapper.toMarkdown(
								taskWithId,
								this.settings.syncTag,
							);
```

Replace that call with:

```ts
							const markdown = this.mapper.toMarkdown(
								taskWithId,
								this.settings.syncTag,
								this.settings.taskFormat ?? 'emoji',
							);
```

- [ ] **Step 5: Use detected format in update**

In the same `applyChanges`, the `case "update":` block currently calls:

```ts
						const markdown = this.mapper.toMarkdown(
							change.task,
							this.settings.syncTag,
						);
```

Replace that call with:

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

(`existingTask` is already in scope in this block.)

- [ ] **Step 6: Use detected format in writeBackIds**

In `writeBackIds`, the call currently reads:

```ts
				const markdown = this.mapper.toMarkdown(
					task,
					this.settings.syncTag,
				);
```

Replace it with:

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

(`original` is the `ObsidianTask` already fetched at the top of the loop in `writeBackIds`.)

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `npx jest --selectProjects unit -t "task format selection"`
Expected: PASS, 4 passing.

- [ ] **Step 8: Run the full adapter test file to confirm no regression**

Run: `npx jest --selectProjects unit obsidianAdapter.test.ts`
Expected: PASS — existing tests still green (they use `defaultSettings` with no `taskFormat`, so the `?? 'emoji'` fallback keeps emoji output).

- [ ] **Step 9: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat: adapter selects task format (setting for create, detected for update)"
```

---

### Task 5: Wire the setting into the engine and the settings UI

**Files:**
- Modify: `src/sync/syncEngine.ts:46-52`
- Modify: `main.ts:244-252` (add a dropdown after the "Include Obsidian link" setting)

- [ ] **Step 1: Pass `taskFormat` from settings into the adapter**

In `src/sync/syncEngine.ts`, the `new ObsidianAdapter(...)` call currently is:

```ts
		this.obsidianAdapter = new ObsidianAdapter(wrapper, {
			syncTag: calendar.tag,
			newTasksDestination: settings.newTasksDestination,
			newTasksSection: settings.newTasksSection,
			includeObsidianLink: settings.includeObsidianLink,
			getVaultName: () => app.vault.getName(),
		});
```

Add the `taskFormat` line:

```ts
		this.obsidianAdapter = new ObsidianAdapter(wrapper, {
			syncTag: calendar.tag,
			newTasksDestination: settings.newTasksDestination,
			newTasksSection: settings.newTasksSection,
			includeObsidianLink: settings.includeObsidianLink,
			taskFormat: settings.taskFormat,
			getVaultName: () => app.vault.getName(),
		});
```

- [ ] **Step 2: Add the settings dropdown**

In `main.ts`, immediately after the existing "Include Obsidian link in synced tasks" `new Setting(...)` block (the one ending at line ~252 with `await this.plugin.saveSettings(); }));`) and before the `new Setting(containerEl).setName('Conflict resolution').setHeading();` block, insert:

```ts
		new Setting(containerEl)
			.setName('Task format')
			.setDesc('Format used when writing new tasks back to your vault. Existing tasks keep their current format on update. Emoji uses 📅 ⏳ 🆔; Dataview uses [due:: ...] [id:: ...].')
			.addDropdown(dropdown => dropdown
				.addOption('emoji', 'Emoji')
				.addOption('dataview', 'Dataview')
				.setValue(this.plugin.settings.taskFormat)
				.onChange(async (value) => {
					this.plugin.settings.taskFormat = value as 'emoji' | 'dataview';
					await this.plugin.saveSettings();
				}));
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc -noEmit -skipLibCheck && npm run lint`
Expected: both exit 0. (Sentence-case UI text per project conventions: name "Task format", options "Emoji"/"Dataview".)

- [ ] **Step 4: Commit**

```bash
git add src/sync/syncEngine.ts main.ts
git commit -m "feat: wire taskFormat into sync engine and settings UI"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm test`
Expected: all unit + e2e projects pass; coverage thresholds for `src/sync/`, `src/caldav/`, `src/tasks/` still met. This is the project's definition of done (per CLAUDE.md). If coverage on `src/tasks/` or `src/sync/` dropped below threshold, add targeted cases (the new `detectFormat` branch for `priority`/`recurrence` keys, and an emoji-preservation update test) until green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: exits 0, `main.js` regenerated.

- [ ] **Step 3: Final commit if anything changed**

```bash
git add -A
git commit -m "test: ensure coverage thresholds for dataview format support" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Setting `taskFormat: 'emoji' | 'dataview'` default `'emoji'` → Task 1 ✓
- Settings UI dropdown, sentence case → Task 5 ✓
- `toMarkdown` dispatch + `toEmojiMarkdown`/`toDataviewMarkdown` split → Task 3 ✓ (positional `format` arg instead of options object — documented deviation, behaviour identical)
- Dataview field set/order/keys, recurrence via `rruleToText`, inline tags, sync-tag placement, indented body → Task 3 tests + impl ✓
- `detectFormat` order (dataview regex → emoji chars → null) → Task 2 ✓
- Adapter: create=setting, update=detect??setting, writeBackIds=detect??setting, complete unchanged → Task 4 ✓ (complete path is untouched — no task needed, matching spec)
- Tests: mapper dataview + detectFormat cases, adapter create/update/fallback cases → Tasks 2,3,4 ✓
- Out of scope (priority, per-calendar, custom prefix) → not implemented ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step has full code; every command has expected output.

**Type consistency:** `detectFormat(line: string): 'emoji' | 'dataview' | null` and `toMarkdown(task, syncTag?, format?)` signatures are consistent across Tasks 2, 3, 4. `taskFormat` typed identically (`'emoji' | 'dataview'`) in `src/types.ts` (required) and `ObsidianSyncSettings` (optional) — the optionality difference is intentional and the `?? 'emoji'` fallback in Task 4 bridges it. `appendBody(line, body)` defined once in Task 3 and used by both serializers.
