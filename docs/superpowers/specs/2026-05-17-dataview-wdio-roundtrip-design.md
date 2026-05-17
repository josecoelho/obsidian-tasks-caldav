# Dataview full round-trip wdio spec — design

Related: issue #68 / PR #85 (dataview format support); builds on #88 (wdio
real-Obsidian smoke-test layer).

## Problem

PR #85 adds dataview serialization. Unit and Jest E2E cover our mapper /
adapter / detection, but none exercise the **real obsidian-tasks runtime**
with dataview format configured. The maintainer does not use dataview and
cannot easily verify it manually, so a real-Obsidian proof is wanted before
merging.

## Goal

One wdio spec proving the full sync round-trip works when obsidian-tasks
**and** our plugin are configured for **dataview** format, in a clean
dataview-from-start vault. No format-migration scenario.

## New fixture vault: `test/wdio/vault-dataview/`

A sibling of `test/wdio/vault/`, same structure, dataview-preset:

- `.obsidian/community-plugins.json` — `["obsidian-tasks-plugin","tasks-caldav-sync"]`
- `.obsidian/plugins/tasks-caldav-sync/data.json` — same fields as the emoji
  fixture's `data.json` **plus** `"taskFormat": "dataview"`
- `.obsidian/plugins/obsidian-tasks-plugin/data.json` — obsidian-tasks
  settings with its global task format set to dataview. The exact
  key/value is confirmed during planning by inspecting the real plugin's
  settings object in the wdio runtime (obsidian-tasks stores its format under
  a `taskFormat`-style key with a dataview enum value); the fixture contains
  the minimal settings object needed to select dataview, nothing more.
- `Tasks.md` (`# Tasks`), `Inbox.md` (`# Inbox`)

`scripts/prepare-wdio-vault.mjs` is extended to copy the freshly built
`main.js` / `manifest.json` / `styles.css` into **both** vault plugin dirs
(one additional destination in the existing copy loop).

## The spec: `test/wdio/specs/dataviewRoundTrip.e2e.ts`

`before`: switch into the dataview vault via
`browser.reloadObsidian({ vault: <vault-dataview path> })`. The exact call
signature for wdio-obsidian-service v3 is locked during planning (the v3
service supports runtime vault switching; this is the one mechanism detail to
de-risk first).

`beforeEach` / `afterEach`: as in `bidirectionalUpdate.e2e.ts` —
`createIsolatedCalendar()` + `useCalendar()` to bind an isolated Radicale
calendar; `cleanup()` after.

Steps (mirrors `bidirectionalUpdate`, dataview-configured runtime):

1. Append a task to `Tasks.md`: `- [ ] Plan trip <ts> #sync`. (A bare task
   line is format-agnostic; obsidian-tasks parses it. The dataview format
   setting governs how obsidian-tasks and our plugin **write**.)
2. `waitForTaskInCache(title)` → `syncNow()` → assert a VTODO containing the
   title appears on the server (`fetchVtodos(calendarName)`).
3. Assert the vault write-back used dataview: the `Tasks.md` task line now
   contains `[id:: ` and does **not** contain `🆔`. This proves our
   serializer + format detection ran in real Obsidian.
4. Edit the task in Obsidian (`replaceInFile`) → `waitForTaskInCache` →
   `syncNow()` → assert the edited title appears on the server.
5. Complete on the server: `putVtodo` with a `STATUS:COMPLETED` VTODO for the
   synced UID → `syncNow()` → assert obsidian-tasks reflects completion: the
   `Tasks.md` line is `- [x] …` and retains dataview metadata
   (`[id:: ` present, no `🆔`).

Reused as-is: `createIsolatedCalendar`, `useCalendar`, `waitForTaskInCache`,
`syncNow`, `fetchVtodos`, `buildVtodoIcs`, `putVtodo`, `appendTaskLine`,
`replaceInFile`. Only the vault switch is new.

## CI

`wdio.yml` already globs `test/wdio/specs/**/*.e2e.ts`; the new spec runs in
the same job with no workflow change. The `prepare-wdio-vault.mjs` change
ensures both fixture vaults receive the freshly built plugin.

## Out of scope

- Format migration / converting an existing emoji task to dataview.
- A separate CalDAV→Obsidian-only dataview spec (the round-trip already
  includes a server→Obsidian completion leg).
- Changing or duplicating `wdio.conf.mts` capabilities (runtime vault switch
  keeps a single config and leaves the emoji specs' default vault untouched).

## Risks / de-risk in planning

1. **wdio-obsidian-service vault switch** — confirm the exact
   `browser.reloadObsidian({ vault, plugins })` signature and that it
   re-enables both plugins against the new vault. Spike this before writing
   the spec body.
2. **obsidian-tasks settings shape** — confirm the precise settings key and
   dataview enum value by reading the live settings object via
   `browser.executeObsidian` in the spike, then bake it into the fixture
   `data.json`.
