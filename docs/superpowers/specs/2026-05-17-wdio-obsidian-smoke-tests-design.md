# wdio Obsidian smoke-test layer — design

Date: 2026-05-17
Issue: [#50](https://github.com/josecoelho/obsidian-tasks-caldav/issues/50)

## Context

The Obsidian side of the sync is fully mocked in tests. `src/tasks/` already has
~94% line / ~85% branch coverage, so the gap is **fidelity, not line count**:

- Every unit test feeds hand-built `ObsidianTask` fixtures that conform to our
  *own* `ObsidianTask` interface — the real obsidian-tasks `Task`/`getTasks()`
  is never exercised.
- `ObsidianTasksWrapper.getAllTasks()` → `tasksPlugin.getTasks()` is powered by
  obsidian-tasks' `Cache`, which is driven by Obsidian's `MetadataCache` events
  and **cannot run outside Electron**. Nothing tests this path.
- If obsidian-tasks changes its undocumented API, we find out in production.

A secondary, day-to-day pain point: the only way to verify a real sync today is
to build the plugin, load it in Obsidian by hand, and click around. We want to
stop building and testing manually.

`jest-environment-obsidian` was evaluated and rejected as the primary tool: it
is WIP, ships no `getTasks()`/`Cache` (lives outside `Task.ts`, needs
`MetadataCache`), has no stateful vault, and would still require a hand-built
in-memory vault double. It only adds value as a fast mapper-contract layer,
which the existing Jest unit tests already cover with fixtures. Decision:
**wdio-only**, happy-path smoke tests only.

## Goals

- Exercise the real runtime: real Obsidian + real obsidian-tasks plugin + real
  CalDAV sync, end to end.
- Catch obsidian-tasks API drift loudly (a real plugin install breaks if their
  API changes).
- Replace the manual build → load → click verification loop with an automated
  suite, runnable locally and in CI.

## Non-goals

- Edge cases, malformed input, recurrence variants, server quirks — these stay
  in the existing fast Jest unit/E2E suites.
- Multi-version Obsidian matrix (single pinned latest-stable version only;
  matrix is a possible later issue).
- Replacing or modifying the Jest suites, config, or coverage gates.
- Contributing to the Jest `coverageThreshold` gate (wdio runs in Electron and
  will not feed Jest coverage — accepted; this layer is about fidelity).

## Architecture & tooling

- **Runner:** `wdio-obsidian-service` (WebdriverIO + Mocha). Launches a real
  Obsidian Electron app on a **single pinned latest-stable** Obsidian version.
- **obsidian-tasks:** installed automatically by community ID
  (`{ id: 'obsidian-tasks' }`) so the real `getTasks()`/`Cache` runs.
- **CalDAV server:** Radicale via the existing Docker setup, started with
  `scripts/ensure-servers.mjs --only radicale`. CalDAV-side assertions and
  isolated calendars reuse the existing E2E helpers (`FetchHttpClient`,
  `createIsolatedCalendar()`).
- **Coexistence:** new directory `test/wdio/`, `wdio.conf.ts`, npm scripts
  `test:wdio` (local) and `test:wdio:ci`. Jest config, projects, and coverage
  thresholds are untouched. The two suites are independent.

## Test vault & plugin wiring

- Committed fixture vault at `test/wdio/vault/` with a `.obsidian/`:
  - pre-seeded `data.json` for our plugin (CalDAV URL pointing at the local
    Radicale port, sync tag, and any required defaults),
  - obsidian-tasks enabled in `community-plugins.json`.
- **Plugin delivery:** a pretest step runs `npm run build` and copies
  `main.js` + `manifest.json` + `styles.css` into the fixture vault's
  `.obsidian/plugins/tasks-caldav-sync/` directory (build + copy, not symlink —
  deterministic in CI). This step is what removes the manual build/load loop.
- **Isolation:** `obsidianPage.resetVault()` between tests; each test obtains a
  fresh Radicale calendar via `createIsolatedCalendar()`.

## Smoke tests (happy-path only)

Each test is full-runtime: mutate one side → trigger sync via
`browser.executeObsidianCommand('tasks-caldav-sync:sync-now')` → assert both
sides (vault file via `obsidianPage.readFile()`, CalDAV via HTTP).

1. **Obsidian → CalDAV create:** write a sync-tagged task line into a vault
   note → sync → assert a matching VTODO exists on Radicale.
2. **CalDAV → Obsidian create:** PUT a VTODO to Radicale → sync → assert a
   matching task line appears in the vault file.
3. **Bidirectional update:** change title + done state + due date on one side,
   then on the other → sync each time → assert propagation the opposite way.
4. **Completion + delete:** mark a task done on one side and delete a task on
   one side → sync → assert both sides reflect the completion and the deletion.

## CI

- GitHub Actions: a **separate job** from the existing Jest job so a slow or
  flaky Electron boot never blocks unit feedback.
- Steps: checkout → Node setup → `npm ci` → start Docker Radicale → build +
  copy plugin into fixture vault → run `test:wdio:ci` under Xvfb
  (`GabrielBB/xvfb-action`).
- Cache the downloaded Obsidian binary between runs.

## Verification

- Local: `npm run test:wdio` brings up Radicale, builds+copies the plugin,
  launches Obsidian, and the four smoke tests pass.
- CI: the new GitHub Actions job is green; the existing Jest job is unchanged
  and still green.
- Manual sanity (one-time): confirm the fixture-vault `data.json` matches the
  plugin's current settings schema so sync runs without UI configuration.

## Risks

- **Electron flakiness/slowness:** mitigated by single version, four tests
  only, `resetVault()` isolation, and a separate CI job.
- **obsidian-tasks community install breaking:** acceptable — that breakage is
  exactly the API-drift signal we want. Pin a known-good obsidian-tasks version
  in the fixture if installs prove non-deterministic.
- **Settings-schema drift:** the fixture `data.json` must track the plugin's
  settings type; called out in Verification as a one-time check and a
  maintenance note.
