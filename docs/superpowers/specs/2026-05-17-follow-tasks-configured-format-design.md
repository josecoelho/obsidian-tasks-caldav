# Follow obsidian-tasks' configured format — design

Supersedes the user-facing parts of `2026-05-17-dataview-format-support-design.md`
(issue #68 / PR #85). Read stays the same; the write side stops having its own
format setting.

## Problem

PR #85 added our own `taskFormat` setting plus a warning telling users to keep
it matching obsidian-tasks' format, and `detectFormat`-based per-task
preservation. This is a footgun (two settings that can disagree) and avoidable
complexity. obsidian-tasks already has the authoritative format setting.

## Principle

Read format-agnostically (obsidian-tasks parses both emoji and dataview —
unchanged). Serialise in obsidian-tasks' own configured format. The tasks
plugin is the single source of truth. No setting, no warning, no detection, no
possible mismatch.

## Changes

### `ObsidianTasksWrapper` — new `getConfiguredFormat()`

```
getConfiguredFormat(): Promise<'emoji' | 'dataview'>
```

- Access `app.plugins.plugins['obsidian-tasks-plugin']`.
- `const data = await plugin.loadData()` and read `data?.taskFormat`.
  (Spike-proven: obsidian-tasks keeps settings in a module closure;
  `plugin.settings` is unreliable, `loadData()` returns the persisted object.)
- Return `data?.taskFormat === 'dataview' ? 'dataview' : 'emoji'`.
- Missing key, plugin absent, or `loadData()` throwing → `'emoji'`
  (obsidian-tasks' own default is `tasksPluginEmoji`).
- Resolved per sync so a change in obsidian-tasks takes effect on the next
  sync.

### `ObsidianMapper`

- Keep `toMarkdown(task, syncTag?, format)` (still serialises to a given
  format).
- **Delete `detectFormat`** and its unit tests. No per-task detection.

### `ObsidianAdapter`

- Remove `taskFormat` from `ObsidianSyncSettings`.
- In `applyChanges` and `writeBackIds`, resolve the format once via
  `wrapper.getConfiguredFormat()` and pass it to every `toMarkdown` call
  (create, update, writeBackIds). No detection, no `?? setting ?? 'emoji'`
  chain — one resolved format for the whole pass.
- Behaviour: updating an existing emoji task while obsidian-tasks is set to
  dataview rewrites it in dataview — consistent with how obsidian-tasks itself
  rewrites tasks it edits.

### `src/types.ts`, `syncEngine.ts`, `main.ts`

- Remove `taskFormat` from `CalDAVSettings` and `DEFAULT_CALDAV_SETTINGS`.
- `syncEngine.ts`: stop passing `settings.taskFormat` into the adapter.
- `main.ts`: delete the "Task format" dropdown Setting and the
  "match your tasks plugin format" warning Setting block.

## Back-compat

Follow obsidian-tasks, no migration. A leftover `taskFormat` key in a user's
plugin `data.json` is silently ignored (settings merge keeps unknown keys
harmless; nothing reads it). A user who had set our dropdown to `dataview`
while obsidian-tasks is emoji will see sync output realign to emoji — the
correct, consistent behaviour.

## Tests

- Delete `ObsidianMapper.detectFormat` tests.
- Keep `toMarkdown` dataview serialisation tests (format arg still drives
  output).
- `obsidianAdapter` tests: replace the `taskFormat`-setting / detect cases
  with cases that mock `wrapper.getConfiguredFormat()` returning `emoji` and
  `dataview`, asserting the serialised markdown matches.
- New `ObsidianTasksWrapper.getConfiguredFormat` unit tests: obsidian-tasks
  `loadData` → `{taskFormat:'dataview'}` → `'dataview'`;
  `{taskFormat:'tasksPluginEmoji'}` → `'emoji'`; missing key → `'emoji'`;
  plugin absent → `'emoji'`; `loadData` throws → `'emoji'`.
- wdio: simplify `test/wdio/helpers/dataviewVault.ts` `openDataviewVault()` —
  remove the runtime flip of our (now-deleted) setting; obsidian-tasks'
  fixture `data.json` (`taskFormat: dataview`) already drives it. The
  `dataviewRoundTrip.e2e.ts` assertions are unchanged (`[id:: ` present,
  `🆔` absent, `- [x]` completion).

## Out of scope

- The read/parse path (unchanged — obsidian-tasks parses both).
- Per-task format preservation on update (intentionally removed).
- obsidian-tasks API changes (no public settings accessor exists; we read its
  persisted `data.json` via the plugin instance's `loadData()`).

## Risks

- `loadData()` is async; the adapter must resolve the format with `await`
  before serialising. `applyChanges`/`writeBackIds` are already async.
- obsidian-tasks could rename `taskFormat` or its enum in a future major. The
  mapping is centralised in one wrapper method, so drift is one-line to fix
  and covered by the wrapper unit tests; unknown values fall back to `'emoji'`
  (safe — never throws, never produces a worse outcome than today's default).
