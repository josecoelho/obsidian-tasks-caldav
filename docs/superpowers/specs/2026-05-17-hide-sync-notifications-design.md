# Hide automatic sync notifications (#67)

## Problem

Sync notifications ("Starting sync…", "Sync complete!") were useful while
debugging but are now a distraction during routine background sync. There is no
way to turn them off.

GitHub issue: https://github.com/josecoelho/obsidian-tasks-caldav/issues/67

## Behavior

A new setting silences the two routine progress notices **only when sync runs
automatically in the background**.

- **Automatic background sync**: governed by the setting. Off (default) → no
  "Starting sync…" / "Sync complete!" notices.
- **Manual sync** ("Sync now" and other manual commands): always shows notices,
  regardless of the setting.
- **Errors** ("Sync failed: …"): always shown, regardless of the setting or
  trigger.

`SyncResult` (including `message`) is always built and returned, so the result
modal and "View sync status" output are unaffected.

## Changes

### 1. Setting

Add to `CalDAVSettings` in `src/types.ts`:

```ts
showAutoSyncNotifications: boolean;
```

Default in `DEFAULT_CALDAV_SETTINGS`: `false` (background sync is silent out of
the box — this is the issue author's intent and is acceptable as a behavior
change for existing users).

UI toggle in the settings tab (`main.ts`, `CalDAVSettingTab`):

- Name: "Show automatic sync notifications"
- Description: "Show progress notices when sync runs automatically in the
  background. Manual sync and errors always notify."

### 2. Thread manual vs. background into `SyncEngine.sync()`

Change signature:

```ts
async sync(dryRun: boolean = false, background: boolean = false): Promise<SyncResult>
```

Call sites in `main.ts`:

- `syncAll()` (auto-sync path, called by `AutoSyncScheduler`) →
  `engine.sync(false, true)`
- `syncAllEngines(dryRun)` (manual command path) →
  `engine.sync(dryRun, false)` (default — unchanged)

Existing `syncEngine.test.ts` calls use `sync(true)` / `sync(false)`;
`background` defaults to `false`, so their notice expectations are unchanged.

### 3. Gate the two routine notices

In `sync()`, compute once:

```ts
const showProgress = !background || this.settings.showAutoSyncNotifications;
```

- Start notice (`syncEngine.ts:66`): wrap in `if (showProgress)`.
- Completion notice (`syncEngine.ts:268`, inside `buildResult`): pass
  `showProgress` down as a parameter and gate the `new Notice(...)` there.
- Error notice (`syncEngine.ts:310`, `buildErrorResult`): untouched — always
  fires.

### 4. Test mock support

`__mocks__/obsidian.ts` currently exports `Notice` as an inert class with no
spy. Convert it to a `jest.fn()` (still constructable with `new`) so tests can
assert call counts and arguments. No existing test references `Notice`, so this
is safe.

## Testing (TDD)

`src/sync/` requires 80% lines / 80% branches.

New cases in `src/sync/syncEngine.test.ts`:

1. background = true, setting off → no start/complete `Notice`; `SyncResult`
   still fully populated.
2. background = true, setting on → start/complete notices fire.
3. background = false (manual), setting off → start/complete notices still fire.
4. background = true, setting off, sync throws → error `Notice` still fires.

`npm test` (unit + e2e, coverage) must pass.

## Out of scope

- No per-calendar notification settings.
- No new-task / non-sync notices (e.g., "No calendars configured", task-ID
  validation) — those are unrelated and stay as-is.
