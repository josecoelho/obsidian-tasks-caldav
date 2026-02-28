# Tag-Per-Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-calendar sync with N independent sync loops, one per tag-calendar mapping, each with its own CalDAV connection and storage.

**Architecture:** Each `CalendarMapping` in settings is a self-contained sync job. The plugin loops over `settings.calendars`, instantiating one `SyncEngine` per entry. Each engine has its own `CalDAVClientDirect`, `SyncStorage` (per-calendar directory), and filters by its own tag. The diff engine, adapters, and `CommonTask` type are unchanged.

**Tech Stack:** TypeScript, Jest, Obsidian API (`Plugin`, `PluginSettingTab`, `Setting`)

---

### Task 1: Add `CalendarMapping` type and update `CalDAVSettings`

**Files:**
- Modify: `src/types.ts:1-30`

**Step 1: Write the failing test**

No test file for types — this is a pure type change. We'll verify compilation in the next tasks.

**Step 2: Update the types**

In `src/types.ts`, add `CalendarMapping` and update `CalDAVSettings`:

```typescript
// Individual calendar connection configuration
export interface CalendarMapping {
  tag: string;              // without #, e.g. "work"
  calendarName: string;     // e.g. "Work"
  serverUrl: string;
  username: string;
  password: string;
}

// CalDAV plugin settings
export interface CalDAVSettings {
  calendars: CalendarMapping[];
  syncInterval: number; // minutes
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
}

export const DEFAULT_CALDAV_SETTINGS: CalDAVSettings = {
  calendars: [],
  syncInterval: 5,
  newTasksDestination: 'Inbox.md',
  newTasksSection: undefined,
  requireManualConflictResolution: true,
  autoResolveObsidianWins: false,
  syncCompletedTasks: false,
  deleteBehavior: 'ask',
};
```

Remove the old `serverUrl`, `username`, `password`, `calendarName`, `syncTag` fields.

**Step 3: Fix all type errors**

The compiler will now flag every usage of the old fields. Do NOT fix them yet — just verify the type change compiles in isolation. Run:

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -50
```

Expected: Type errors in `SyncEngine.ts`, `main.ts`, `calDAVClientDirect.ts`, test files. This is correct — we'll fix them in subsequent tasks.

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add CalendarMapping type, remove single-calendar fields from CalDAVSettings"
```

---

### Task 2: Update `SyncStorage` to support per-calendar directories

**Files:**
- Modify: `src/storage/SyncStorage.ts:13-36` (constructor + paths)
- Modify: `src/storage/SyncStorage.ts:42-64` (initialize)
- Modify: `src/storage/syncStorage.test.ts`

**Step 1: Write the failing test**

Add a new test to `src/storage/syncStorage.test.ts`:

```typescript
describe('per-calendar storage', () => {
  it('stores files under calendars/{calendarId}/ when calendarId is provided', async () => {
    const adapter = createMockAdapter();
    const app = createMockApp(adapter);
    const storage = new SyncStorage(app, 'work');
    setupFreshAdapter(adapter);

    await storage.initialize();

    // Should create the calendar-specific directory
    expect(adapter.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('.caldav-sync/calendars/work')
    );
  });

  it('reads baseline from calendar-specific path', async () => {
    const adapter = createMockAdapter();
    const app = createMockApp(adapter);
    const storage = new SyncStorage(app, 'work');
    const baseline = [makeCommonTask({ uid: 'cal-task' })];

    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars/work/baseline.json')) return true;
      if (path.includes('calendars/work')) return true;
      return path.includes('.caldav-sync');
    });
    adapter.mkdir.mockResolvedValue(undefined);
    adapter.write.mockResolvedValue(undefined);
    adapter.read.mockImplementation((path: string) => {
      if (path.includes('calendars/work/baseline.json')) return JSON.stringify(baseline);
      if (path.includes('state.json')) return JSON.stringify({ lastSyncTime: '', conflicts: [] });
      throw new Error('File not found');
    });

    await storage.initialize();

    expect(storage.getBaseline()).toEqual(baseline);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest --testPathPattern='syncStorage.test' --no-coverage -t 'per-calendar storage' 2>&1
```

Expected: FAIL — `SyncStorage` constructor doesn't accept a second argument.

**Step 3: Update `SyncStorage` constructor to accept optional `calendarId`**

In `src/storage/SyncStorage.ts`, change the constructor (lines 30-36):

```typescript
constructor(app: App, calendarId?: string) {
  this.app = app;
  if (calendarId) {
    this.syncDir = normalizePath(`.caldav-sync/calendars/${calendarId}`);
  } else {
    this.syncDir = normalizePath('.caldav-sync');
  }
  this.statePath = normalizePath(`${this.syncDir}/state.json`);
  this.baselinePath = normalizePath(`${this.syncDir}/baseline.json`);
  this.idMappingPath = normalizePath(`${this.syncDir}/id-mapping.json`);
}
```

Also update `initialize()` to create parent directories. The `mkdir` call at line 47 already creates `this.syncDir`, but for nested paths like `.caldav-sync/calendars/work/`, the vault adapter's `mkdir` may need the parent to exist. Add an ensure-parents step:

```typescript
async initialize(): Promise<void> {
  const adapter = this.app.vault.adapter;

  // Create directory tree if it doesn't exist
  if (!(await adapter.exists(this.syncDir))) {
    // Ensure parent directories exist for nested calendar paths
    const parent = this.syncDir.substring(0, this.syncDir.lastIndexOf('/'));
    if (parent && !(await adapter.exists(parent))) {
      await adapter.mkdir(parent);
    }
    await adapter.mkdir(this.syncDir);
  }

  // ... rest unchanged
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest --testPathPattern='syncStorage.test' --no-coverage 2>&1
```

Expected: All tests PASS (existing tests use `SyncStorage(app)` without calendarId — still works).

**Step 5: Commit**

```bash
git add src/storage/SyncStorage.ts src/storage/syncStorage.test.ts
git commit -m "feat: SyncStorage supports per-calendar directory via optional calendarId"
```

---

### Task 3: Update `CalDAVClientDirect` to accept `CalendarMapping` instead of `CalDAVSettings`

**Files:**
- Modify: `src/caldav/calDAVClientDirect.ts:30-38` (constructor)
- Modify: `src/caldav/calDAVClientDirect.test.ts`

**Step 1: Write the failing test**

In `src/caldav/calDAVClientDirect.test.ts`, add or update a test that constructs the client with a `CalendarMapping`:

```typescript
it('should accept CalendarMapping for construction', () => {
  const mapping: CalendarMapping = {
    tag: 'work',
    calendarName: 'Work',
    serverUrl: 'https://caldav.example.com',
    username: 'user',
    password: 'pass',
  };
  const client = new CalDAVClientDirect(mapping);
  expect(client).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest --testPathPattern='calDAVClientDirect.test' --no-coverage -t 'should accept CalendarMapping' 2>&1
```

Expected: FAIL — type mismatch (expects `CalDAVSettings`).

**Step 3: Update `CalDAVClientDirect` constructor**

The client only uses `serverUrl`, `username`, `password`, and `calendarName` from settings. Define a minimal interface:

```typescript
export interface CalDAVConnectionConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarName: string;
}
```

Change the constructor to accept `CalDAVConnectionConfig`:

```typescript
constructor(config: CalDAVConnectionConfig, httpClient?: HttpClient) {
  this.config = config;
  // ... rest uses config.serverUrl, config.username, etc.
}
```

This interface is satisfied by both `CalendarMapping` (it has all four fields) and the old `CalDAVSettings` (it also had them). Update internal references from `this.settings` to `this.config`.

**Step 4: Run all CalDAVClientDirect tests**

```bash
npx jest --testPathPattern='calDAVClientDirect.test' --no-coverage 2>&1
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/caldav/calDAVClientDirect.ts src/caldav/calDAVClientDirect.test.ts
git commit -m "refactor: CalDAVClientDirect accepts CalDAVConnectionConfig instead of full settings"
```

---

### Task 4: Update `SyncEngine` to accept `CalendarMapping` + global settings

**Files:**
- Modify: `src/sync/SyncEngine.ts:28-46` (constructor)
- Modify: `src/sync/SyncEngine.ts:57-84` (sync method)
- Modify: `src/sync/syncEngine.test.ts`

**Step 1: Update test helpers**

In `src/sync/syncEngine.test.ts`, update `makeSettings()` to return new-format settings and add a `makeCalendarMapping()` helper:

```typescript
function makeCalendarMapping(overrides: Partial<CalendarMapping> = {}): CalendarMapping {
  return {
    tag: '',
    calendarName: 'TestCalendar',
    serverUrl: 'https://caldav.example.com',
    username: 'user',
    password: 'pass',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<CalDAVSettings> = {}): CalDAVSettings {
  return {
    ...DEFAULT_CALDAV_SETTINGS,
    ...overrides,
  };
}
```

Update all `new SyncEngine(new App(), makeSettings(...))` calls to `new SyncEngine(new App(), makeCalendarMapping(...), makeSettings(...))`.

For tests that set `syncTag`, move that to `makeCalendarMapping({ tag: 'sync' })`.

**Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern='syncEngine.test' --no-coverage 2>&1 | head -20
```

Expected: FAIL — constructor signature mismatch.

**Step 3: Update `SyncEngine` constructor**

```typescript
export class SyncEngine {
  private calendar: CalendarMapping;
  private settings: CalDAVSettings;
  private storage: SyncStorage;
  private caldavAdapter: CalDAVAdapter;
  private obsidianAdapter: ObsidianAdapter;

  constructor(app: App, calendar: CalendarMapping, settings: CalDAVSettings) {
    this.calendar = calendar;
    this.settings = settings;
    const wrapper = new ObsidianTasksWrapper(app);
    this.storage = new SyncStorage(app, calendar.calendarName);
    this.caldavAdapter = new CalDAVAdapter(
      new CalDAVClientDirect(calendar),
    );
    this.obsidianAdapter = new ObsidianAdapter(wrapper, {
      syncTag: calendar.tag,
      newTasksDestination: settings.newTasksDestination,
      newTasksSection: settings.newTasksSection,
    });
  }
```

Update `sync()` to use `this.calendar.tag` instead of `this.settings.syncTag`:

```typescript
async sync(dryRun: boolean = false): Promise<SyncResult> {
  try {
    new Notice(`${dryRun ? "[DRY RUN] " : ""}Starting sync for ${this.calendar.calendarName}...`);

    const syncTag = this.calendar.tag;
    // ... rest stays the same
```

Update `conflictStrategy()` — still reads from `this.settings`.

**Step 4: Run tests to verify they pass**

```bash
npx jest --testPathPattern='syncEngine.test' --no-coverage 2>&1
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/SyncEngine.ts src/sync/syncEngine.test.ts
git commit -m "feat: SyncEngine accepts CalendarMapping + global settings"
```

---

### Task 5: Update `main.ts` — plugin lifecycle with multi-calendar loop

**Files:**
- Modify: `main.ts:9-148`

**Step 1: Update plugin class**

Replace single `syncEngine` with an array:

```typescript
export default class CalDAVSyncPlugin extends Plugin {
  settings: CalDAVSettings;
  private syncEngines: SyncEngine[] = [];
  private autoSync: AutoSyncScheduler | null = null;
```

Update `onload()` to initialize engines per calendar:

```typescript
async onload() {
  await this.loadSettings();

  await this.initializeEngines();

  // Commands stay mostly the same but loop over engines
  // ... (see Step 2)

  this.addSettingTab(new CalDAVSettingTab(this.app, this));

  this.autoSync = new AutoSyncScheduler(
    () => this.syncAll(),
    (id) => this.registerInterval(id),
  );
  this.autoSync.start(this.settings.syncInterval);
}
```

Add helper methods:

```typescript
private async initializeEngines(): Promise<void> {
  this.syncEngines = [];
  for (const calendar of this.settings.calendars) {
    const engine = new SyncEngine(this.app, calendar, this.settings);
    const ready = await engine.initialize();
    if (ready) {
      this.syncEngines.push(engine);
    }
  }
  if (this.syncEngines.length === 0 && this.settings.calendars.length > 0) {
    new Notice('CalDAV sync: obsidian-tasks plugin not available');
  }
}

private async syncAll(): Promise<void> {
  for (const engine of this.syncEngines) {
    await engine.sync();
  }
}
```

Update the `sync-now` command to loop and merge results:

```typescript
this.addCommand({
  id: 'sync-now',
  name: 'Sync with CalDAV now',
  callback: async () => {
    if (this.syncEngines.length === 0) {
      new Notice('No calendars configured');
      return;
    }
    for (const engine of this.syncEngines) {
      const result = await engine.sync();
      new SyncResultModal(this.app, result, false).open();
    }
  }
});
```

Update `sync-dry-run` similarly. Update `view-sync-status` to show all engines. Update `saveSettings` to call `initializeEngines()`.

**Step 2: Verify build compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1
```

Expected: No errors (or only unrelated ones).

**Step 3: Commit**

```bash
git add main.ts
git commit -m "feat: plugin loops over calendars, one SyncEngine per CalendarMapping"
```

---

### Task 6: Update settings UI for multi-calendar configuration

**Files:**
- Modify: `main.ts:150-274` (CalDAVSettingTab)

**Step 1: Rewrite `display()` method**

Replace the single connection fields with a dynamic calendar list:

```typescript
display(): void {
  const { containerEl } = this;
  containerEl.empty();

  // --- Calendar mappings ---
  new Setting(containerEl)
    .setName('Calendars')
    .setHeading();

  for (let i = 0; i < this.plugin.settings.calendars.length; i++) {
    this.renderCalendarMapping(containerEl, i);
  }

  new Setting(containerEl)
    .addButton(button => button
      .setButtonText('Add calendar')
      .onClick(async () => {
        this.plugin.settings.calendars.push({
          tag: '',
          calendarName: '',
          serverUrl: '',
          username: '',
          password: '',
        });
        await this.plugin.saveSettings();
        this.display();
      }));

  // --- General settings (unchanged) ---
  new Setting(containerEl)
    .setName('General')
    .setHeading();

  // syncInterval, newTasksDestination, conflict resolution — keep as-is
  // ...
}

private renderCalendarMapping(containerEl: HTMLElement, index: number): void {
  const calendar = this.plugin.settings.calendars[index];

  new Setting(containerEl)
    .setName(`Calendar ${index + 1}`)
    .setHeading()
    .addButton(button => button
      .setButtonText('Remove')
      .setWarning()
      .onClick(async () => {
        this.plugin.settings.calendars.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      }));

  new Setting(containerEl)
    .setName('Tag')
    .setDesc('Tag that routes tasks to this calendar (without #)')
    .addText(text => text
      .setPlaceholder('work')
      .setValue(calendar.tag)
      .onChange(async (value) => {
        calendar.tag = value;
        await this.plugin.saveSettings();
      }));

  new Setting(containerEl)
    .setName('Calendar name')
    .setDesc('Name of the calendar on the server')
    .addText(text => text
      .setPlaceholder('Work')
      .setValue(calendar.calendarName)
      .onChange(async (value) => {
        calendar.calendarName = value;
        await this.plugin.saveSettings();
      }));

  new Setting(containerEl)
    .setName('Server URL')
    .setDesc('CalDAV server URL')
    .addText(text => text
      .setPlaceholder('https://caldav.example.com')
      .setValue(calendar.serverUrl)
      .onChange(async (value) => {
        calendar.serverUrl = value;
        await this.plugin.saveSettings();
      }));

  new Setting(containerEl)
    .setName('Username')
    .addText(text => text
      .setPlaceholder('Enter username')
      .setValue(calendar.username)
      .onChange(async (value) => {
        calendar.username = value;
        await this.plugin.saveSettings();
      }));

  new Setting(containerEl)
    .setName('Password')
    .addText(text => {
      text.inputEl.type = 'password';
      text
        .setPlaceholder('Enter password')
        .setValue(calendar.password)
        .onChange(async (value) => {
          calendar.password = value;
          await this.plugin.saveSettings();
        });
    });
}
```

**Step 2: Verify build compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1
```

Expected: No errors.

**Step 3: Commit**

```bash
git add main.ts
git commit -m "feat: settings UI supports dynamic list of calendar mappings"
```

---

### Task 7: Settings migration (old single-calendar → new multi-calendar)

**Files:**
- Modify: `main.ts:136-138` (loadSettings)

**Step 1: Write migration logic in `loadSettings()`**

```typescript
async loadSettings() {
  const loaded = (await this.loadData()) ?? {};
  this.settings = Object.assign({}, DEFAULT_CALDAV_SETTINGS, loaded);

  // Migrate old single-calendar settings to new multi-calendar format
  const legacy = loaded as Record<string, unknown>;
  if (legacy.serverUrl && !legacy.calendars) {
    this.settings.calendars = [{
      tag: (legacy.syncTag as string) ?? 'sync',
      calendarName: (legacy.calendarName as string) ?? '',
      serverUrl: (legacy.serverUrl as string) ?? '',
      username: (legacy.username as string) ?? '',
      password: (legacy.password as string) ?? '',
    }];
    await this.saveData(this.settings);
  }
}
```

This converts the old flat settings into a single-entry `calendars` array on first load.

**Step 2: Verify build compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1
```

**Step 3: Commit**

```bash
git add main.ts
git commit -m "feat: migrate old single-calendar settings to calendars array on load"
```

---

### Task 8: Storage migration (old flat files → per-calendar directory)

**Files:**
- Modify: `src/storage/SyncStorage.ts` (add static migration method)
- Add test in: `src/storage/syncStorage.test.ts`

**Step 1: Write the failing test**

```typescript
describe('migrateToPerCalendarStorage', () => {
  it('moves flat baseline.json and id-mapping.json into calendar subdirectory', async () => {
    const adapter = createMockAdapter();
    const app = createMockApp(adapter);

    const baseline = [makeCommonTask({ uid: 'migrated-task' })];
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { 'task-1': 'cal-1' },
      caldavUidToTaskId: { 'cal-1': 'task-1' },
    };

    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars')) return false;
      if (path.includes('baseline.json')) return true;
      if (path.includes('id-mapping.json')) return true;
      return path.includes('.caldav-sync');
    });
    adapter.read.mockImplementation((path: string) => {
      if (path === '.caldav-sync/baseline.json') return JSON.stringify(baseline);
      if (path === '.caldav-sync/id-mapping.json') return JSON.stringify(idMapping);
      throw new Error('not found');
    });
    adapter.mkdir.mockResolvedValue(undefined);
    adapter.write.mockResolvedValue(undefined);

    await SyncStorage.migrateToPerCalendarStorage(app, 'MyCalendar');

    // Should write to calendar-specific paths
    const writePaths = adapter.write.mock.calls.map((c: unknown[]) => c[0]);
    expect(writePaths).toContainEqual(
      expect.stringContaining('calendars/MyCalendar/baseline.json')
    );
    expect(writePaths).toContainEqual(
      expect.stringContaining('calendars/MyCalendar/id-mapping.json')
    );
  });

  it('skips migration when per-calendar directory already exists', async () => {
    const adapter = createMockAdapter();
    const app = createMockApp(adapter);

    adapter.exists.mockImplementation((path: string) => {
      if (path.includes('calendars/MyCalendar')) return true;
      return true;
    });

    await SyncStorage.migrateToPerCalendarStorage(app, 'MyCalendar');

    expect(adapter.write).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest --testPathPattern='syncStorage.test' --no-coverage -t 'migrateToPerCalendarStorage' 2>&1
```

Expected: FAIL — `SyncStorage.migrateToPerCalendarStorage` doesn't exist.

**Step 3: Implement the static migration method**

Add to `SyncStorage`:

```typescript
static async migrateToPerCalendarStorage(app: App, calendarName: string): Promise<void> {
  const adapter = app.vault.adapter;
  const syncDir = normalizePath('.caldav-sync');
  const calendarDir = normalizePath(`.caldav-sync/calendars/${calendarName}`);

  // Skip if already migrated
  if (await adapter.exists(calendarDir)) return;

  const oldBaseline = normalizePath(`${syncDir}/baseline.json`);
  const oldIdMapping = normalizePath(`${syncDir}/id-mapping.json`);

  const hasOldBaseline = await adapter.exists(oldBaseline);
  const hasOldIdMapping = await adapter.exists(oldIdMapping);

  if (!hasOldBaseline && !hasOldIdMapping) return;

  // Create calendar directory tree
  const calendarsDir = normalizePath(`${syncDir}/calendars`);
  if (!(await adapter.exists(calendarsDir))) {
    await adapter.mkdir(calendarsDir);
  }
  await adapter.mkdir(calendarDir);

  // Copy files to new location
  if (hasOldBaseline) {
    const content = await adapter.read(oldBaseline);
    await adapter.write(normalizePath(`${calendarDir}/baseline.json`), content);
  }
  if (hasOldIdMapping) {
    const content = await adapter.read(oldIdMapping);
    await adapter.write(normalizePath(`${calendarDir}/id-mapping.json`), content);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest --testPathPattern='syncStorage.test' --no-coverage 2>&1
```

Expected: PASS

**Step 5: Wire migration into plugin load**

In `main.ts`, call migration in `onload()` after `loadSettings()`:

```typescript
async onload() {
  await this.loadSettings();

  // Migrate flat sync files to per-calendar directories
  if (this.settings.calendars.length === 1) {
    await SyncStorage.migrateToPerCalendarStorage(
      this.app,
      this.settings.calendars[0].calendarName,
    );
  }

  await this.initializeEngines();
  // ...
}
```

**Step 6: Commit**

```bash
git add src/storage/SyncStorage.ts src/storage/syncStorage.test.ts main.ts
git commit -m "feat: migrate flat sync storage to per-calendar directories"
```

---

### Task 9: Update `requestDumper` and any other callers of old settings shape

**Files:**
- Modify: `src/caldav/requestDumper.ts` (uses `CalDAVSettings` to create a client)

**Step 1: Find all references to old settings fields**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'serverUrl|syncTag|calendarName' | head -20
```

Fix each caller. The `requestDumper.ts` likely constructs a `CalDAVClientDirect` — it needs updating to accept the new config shape or work with individual calendar mappings.

**Step 2: Fix all remaining type errors**

Update each file to use `CalendarMapping` or `CalDAVConnectionConfig` as appropriate.

**Step 3: Run full type check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1
```

Expected: No errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: update all callers to use new CalendarMapping / CalDAVSettings shape"
```

---

### Task 10: Update E2E tests for multi-calendar

**Files:**
- Modify: `test/e2e/syncRoundTrip.e2e.test.ts`
- Modify: `test/e2e/caldavAdapter.e2e.test.ts`
- Modify: `test/e2e/caldavClient.e2e.test.ts`

**Step 1: Update E2E test settings helpers**

The E2E tests create settings objects to pass to `CalDAVClientDirect`. Update them to use `CalDAVConnectionConfig` or `CalendarMapping` instead of `CalDAVSettings`.

**Step 2: Run E2E tests**

```bash
npm test 2>&1
```

Expected: PASS for all tests.

**Step 3: Commit**

```bash
git add test/
git commit -m "test: update E2E tests for new CalendarMapping config shape"
```

---

### Task 11: Add integration test for multi-calendar tag routing

**Files:**
- Modify: `src/sync/syncEngine.test.ts`

**Step 1: Write the test**

```typescript
describe('multi-calendar tag routing', () => {
  it('should only sync tasks matching the calendar tag', async () => {
    const workTask = makeObsidianTask({
      description: 'Work task',
      id: '20250101-work',
      tags: ['#work'],
    });
    const personalTask = makeObsidianTask({
      description: 'Personal task',
      id: '20250101-personal',
      tags: ['#personal'],
    });
    mockGetAllTasksWithBody.mockResolvedValue(withBody(workTask, personalTask));

    const workMapping = makeCalendarMapping({ tag: 'work', calendarName: 'Work' });
    const engine = new SyncEngine(new App(), workMapping, makeSettings());
    await engine.initialize();
    const result = await engine.sync(true);

    // Only the #work task should be synced to CalDAV
    expect(result.created.toCalDAV).toBe(1);
    expect(result.details.toCalDAV[0].task.title).toBe('Work task');
  });

  it('should not sync tasks without any matching tag', async () => {
    const untaggedTask = makeObsidianTask({
      description: 'Untagged task',
      id: '20250101-none',
      tags: [],
    });
    mockGetAllTasksWithBody.mockResolvedValue(withBody(untaggedTask));

    const workMapping = makeCalendarMapping({ tag: 'work', calendarName: 'Work' });
    const engine = new SyncEngine(new App(), workMapping, makeSettings());
    await engine.initialize();
    const result = await engine.sync(true);

    expect(result.created.toCalDAV).toBe(0);
  });
});
```

**Step 2: Run tests**

```bash
npx jest --testPathPattern='syncEngine.test' --no-coverage -t 'multi-calendar tag routing' 2>&1
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/sync/syncEngine.test.ts
git commit -m "test: add multi-calendar tag routing tests"
```

---

### Task 12: Run full test suite and fix any remaining issues

**Step 1: Run full test suite**

```bash
npm test 2>&1
```

**Step 2: Run lint**

```bash
npm run lint 2>&1
```

**Step 3: Run build**

```bash
npm run build 2>&1
```

**Step 4: Fix any failures**

Iterate until all three pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: fix remaining issues from tag-per-calendar migration"
```
