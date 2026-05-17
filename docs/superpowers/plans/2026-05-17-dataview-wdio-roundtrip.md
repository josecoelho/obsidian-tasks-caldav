# Dataview full round-trip wdio spec — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one wdio spec proving the full Obsidian↔CalDAV sync round-trip works when obsidian-tasks and our plugin are configured for dataview format, in a clean dataview-from-start fixture vault.

**Architecture:** A sibling fixture vault `test/wdio/vault-dataview/` presets both plugins to dataview. A new spec switches into it via wdio-obsidian-service's runtime vault reload, then mirrors `bidirectionalUpdate.e2e.ts` end-to-end and additionally asserts the vault write-back uses dataview (`[id:: …]`, not `🆔`). Two runtime unknowns (the service's vault-switch call signature and obsidian-tasks' settings shape) are resolved by a spike task first, so all later tasks use concrete committed values.

**Tech Stack:** WebdriverIO + wdio-obsidian-service v3, Mocha, real Obsidian + real obsidian-tasks plugin, Docker Radicale, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-17-dataview-wdio-roundtrip-design.md`

---

## File Structure

- `test/wdio/vault-dataview/` (new fixture vault)
  - `.obsidian/community-plugins.json` — enables both plugins
  - `.obsidian/plugins/tasks-caldav-sync/data.json` — our settings, `taskFormat: "dataview"`
  - `.obsidian/plugins/obsidian-tasks-plugin/data.json` — obsidian-tasks settings with dataview format (exact shape captured in Task 1)
  - `Tasks.md`, `Inbox.md`
- `scripts/prepare-wdio-vault.mjs` (modify) — copy built plugin into both vaults
- `test/wdio/helpers/dataviewVault.ts` (new) — one helper that reloads Obsidian into the dataview vault
- `test/wdio/specs/dataviewRoundTrip.e2e.ts` (new) — the spec

---

### Task 1: Install deps and spike the two runtime unknowns

**Files:** none committed except a scratch spec deleted at end of task.

- [ ] **Step 1: Install post-merge dependencies**

Run: `npm ci`
Expected: exits 0; `node_modules/wdio-obsidian-service` and `node_modules/@wdio` now exist. (The #88 merge added these to `package.json` devDependencies; the worktree's `node_modules` predates the merge.)

- [ ] **Step 2: Confirm the wdio-obsidian-service vault-switch API**

Run: `grep -rn "reloadObsidian" node_modules/wdio-obsidian-service/dist node_modules/wdio-obsidian-service/*.d.ts 2>/dev/null | head; sed -n '1,200p' node_modules/wdio-obsidian-service/README.md | grep -niE "reloadObsidian|vault" | head`

Expected: documentation/signature for `browser.reloadObsidian(...)`. Record the exact options object it accepts for switching vault and plugins. The v3 API is `await browser.reloadObsidian({ vault: <absolutePath>, plugins: [...] })`. Write the confirmed signature into a scratch note you keep for Step 4 and Task 3 (e.g. paste it into the task's working notes).

- [ ] **Step 3: Build the plugin and prepare the existing emoji vault (needed to launch wdio at all)**

Run: `node scripts/prepare-wdio-vault.mjs`
Expected: prints `wdio fixture vault prepared`; `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/main.js` exists.

- [ ] **Step 4: Capture obsidian-tasks' real settings shape via a throwaway spec**

Create `test/wdio/specs/_spike.e2e.ts`:

```ts
import { browser } from '@wdio/globals';
import { writeFileSync } from 'node:fs';

describe('spike: capture obsidian-tasks settings', function () {
  it('dumps the live obsidian-tasks settings object', async function () {
    const settings = await browser.executeObsidian(({ app }) => {
      const tp = (app as { plugins: { plugins: Record<string, { settings?: unknown }> } }).plugins.plugins['obsidian-tasks-plugin'];
      return JSON.stringify(tp.settings);
    });
    writeFileSync('test/wdio/_spike-tasks-settings.json', settings);
  });
});
```

- [ ] **Step 5: Run only the spike spec**

Run: `node scripts/ensure-servers.mjs --only radicale && wdio run wdio.conf.mts --spec test/wdio/specs/_spike.e2e.ts`
Expected: 1 passing test; `test/wdio/_spike-tasks-settings.json` written.

- [ ] **Step 6: Read the captured settings and identify the dataview format key**

Run: `cat test/wdio/_spike-tasks-settings.json | python3 -m json.tool | grep -iE "format|emoji|dataview"`
Expected: a key whose value is the emoji default. obsidian-tasks stores the global format as `"taskFormat": "tasksPluginEmoji"` (the dataview value is `"dataview"`). Record the exact full settings JSON — Task 2 commits a copy of it with **only** that one key changed to `"dataview"`.

- [ ] **Step 7: Remove the spike artifacts**

Run: `rm test/wdio/specs/_spike.e2e.ts && git status --porcelain`
Expected: `test/wdio/specs/_spike.e2e.ts` gone; `test/wdio/_spike-tasks-settings.json` still present (uncommitted, consumed by Task 2). No commit in this task — it is investigation only. Carry forward two concrete artifacts: the confirmed `reloadObsidian` signature and `test/wdio/_spike-tasks-settings.json`.

---

### Task 2: Create the dataview fixture vault

**Files:**
- Create: `test/wdio/vault-dataview/.obsidian/community-plugins.json`
- Create: `test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync/data.json`
- Create: `test/wdio/vault-dataview/.obsidian/plugins/obsidian-tasks-plugin/data.json`
- Create: `test/wdio/vault-dataview/Tasks.md`
- Create: `test/wdio/vault-dataview/Inbox.md`

- [ ] **Step 1: Create the community-plugins file**

Create `test/wdio/vault-dataview/.obsidian/community-plugins.json`:

```json
["obsidian-tasks-plugin", "tasks-caldav-sync"]
```

- [ ] **Step 2: Create our plugin's settings with dataview format**

Create `test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync/data.json` (the emoji fixture's `data.json` content plus `taskFormat`):

```json
{
  "calendars": [],
  "syncInterval": 5,
  "newTasksDestination": "Inbox.md",
  "requireManualConflictResolution": false,
  "autoResolveObsidianWins": false,
  "syncCompletedTasks": true,
  "deleteBehavior": "deleteCalDAV",
  "includeObsidianLink": false,
  "taskFormat": "dataview"
}
```

- [ ] **Step 2a: Verify our settings JSON matches the current `CalDAVSettings` shape**

Run: `grep -nE "taskFormat|showAutoSyncNotifications|includeObsidianLink" src/types.ts`
Expected: `CalDAVSettings` includes `taskFormat: 'emoji' | 'dataview'`. Note: `showAutoSyncNotifications` exists in the type with a default of `false`; the fixture omits it intentionally — the plugin's `loadSettings()` merges `DEFAULT_CALDAV_SETTINGS` over loaded data (`main.ts` `Object.assign({}, DEFAULT_CALDAV_SETTINGS, loaded)`), so omitted fields take their defaults. This matches the existing emoji fixture, which also omits it. No change needed; this step only confirms the assumption holds.

- [ ] **Step 3: Create obsidian-tasks' settings with dataview format**

Take the full JSON captured in `test/wdio/_spike-tasks-settings.json` (Task 1), change **only** the format key identified in Task 1 Step 6 from its emoji value to `"dataview"`, and write the result to `test/wdio/vault-dataview/.obsidian/plugins/obsidian-tasks-plugin/data.json`.

Run to produce it deterministically (replace `taskFormat` if Task 1 found a different key name):

```bash
python3 -c "import json; d=json.load(open('test/wdio/_spike-tasks-settings.json')); d['taskFormat']='dataview'; json.dump(d, open('test/wdio/vault-dataview/.obsidian/plugins/obsidian-tasks-plugin/data.json','w'), indent=2)"
```

Then run: `python3 -m json.tool test/wdio/vault-dataview/.obsidian/plugins/obsidian-tasks-plugin/data.json | grep -i "dataview"`
Expected: the format key now shows `"dataview"`.

- [ ] **Step 4: Create the markdown files**

Create `test/wdio/vault-dataview/Tasks.md`:

```
# Tasks
```

Create `test/wdio/vault-dataview/Inbox.md`:

```
# Inbox
```

- [ ] **Step 5: Delete the spike capture file**

Run: `rm test/wdio/_spike-tasks-settings.json`
Expected: file removed (its content now lives in the committed fixture).

- [ ] **Step 6: Commit**

```bash
git add test/wdio/vault-dataview
git commit -m "test(wdio): dataview-preset fixture vault"
```

Append (blank line before):

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 3: Prepare-script copies the plugin into both vaults

**Files:**
- Modify: `scripts/prepare-wdio-vault.mjs`

- [ ] **Step 1: Read the current script**

Run: `cat scripts/prepare-wdio-vault.mjs`
Expected: it builds, then copies `main.js`/`manifest.json`/`styles.css` into the single dir `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync`.

- [ ] **Step 2: Update it to copy into both vault plugin dirs**

Replace the entire contents of `scripts/prepare-wdio-vault.mjs` with:

```js
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

execSync('npm run build', { stdio: 'inherit' });

const dests = [
  'test/wdio/vault/.obsidian/plugins/tasks-caldav-sync',
  'test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync',
];
for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    cpSync(f, `${dest}/${f}`);
  }
}
console.log('wdio fixture vaults prepared');
```

- [ ] **Step 3: Run it and verify both vaults received the plugin**

Run: `node scripts/prepare-wdio-vault.mjs && ls test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/main.js test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync/main.js`
Expected: prints `wdio fixture vaults prepared`; both `main.js` paths listed (no "No such file").

- [ ] **Step 4: Confirm copied plugin artifacts are git-ignored**

Run: `git status --porcelain test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync/main.js`
Expected: no output (ignored). The repo's `.gitignore` already ignores the emoji vault's copied `main.js`; verify the same pattern covers `vault-dataview`. If `git status` shows the file as untracked, add a `.gitignore` entry mirroring the existing emoji-vault rule (run `grep -n "wdio/vault" .gitignore` to see the existing rule and replicate it for `vault-dataview`). Only the fixture source files from Task 2 are committed, never the built `main.js`.

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-wdio-vault.mjs .gitignore
git commit -m "test(wdio): prepare both fixture vaults with built plugin"
```

(If `.gitignore` was unchanged, `git add .gitignore` is a no-op — that is fine.) Append (blank line before):

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Vault-switch helper

**Files:**
- Create: `test/wdio/helpers/dataviewVault.ts`

- [ ] **Step 1: Write the helper**

Create `test/wdio/helpers/dataviewVault.ts`. Use the exact `reloadObsidian` signature confirmed in Task 1 Step 2. The expected v3 form:

```ts
import path from 'node:path';
import { browser } from '@wdio/globals';

const DATAVIEW_VAULT = path.resolve('test/wdio/vault-dataview');

/** Reload Obsidian into the dataview-preset fixture vault, with both plugins
 *  enabled. Call once in the spec's `before` hook. */
export async function openDataviewVault(): Promise<void> {
  await browser.reloadObsidian({
    vault: DATAVIEW_VAULT,
    plugins: [
      path.resolve('test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync'),
      { id: 'obsidian-tasks-plugin' },
    ],
  });
}
```

If Task 1 found the option keys differ (e.g. the service expects `plugins` entries in another shape, or a different method name), adjust this call to the confirmed signature while keeping the function name and behavior identical (reload into `DATAVIEW_VAULT` with both plugins enabled). Mirror how `wdio.conf.mts` lists the same two plugins.

- [ ] **Step 2: Type-check the helper compiles under the wdio tsconfig**

Run: `npx tsc -p test/wdio/tsconfig.json --noEmit`
Expected: exits 0 (no errors). If `test/wdio/tsconfig.json` does not include this file by glob, confirm with `cat test/wdio/tsconfig.json` that `test/wdio/**/*` is covered (it is per #88's config).

- [ ] **Step 3: Commit**

```bash
git add test/wdio/helpers/dataviewVault.ts
git commit -m "test(wdio): helper to open the dataview fixture vault"
```

Append (blank line before):

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 5: The dataview round-trip spec

**Files:**
- Create: `test/wdio/specs/dataviewRoundTrip.e2e.ts`

- [ ] **Step 1: Write the spec**

Create `test/wdio/specs/dataviewRoundTrip.e2e.ts`. This mirrors `test/wdio/specs/bidirectionalUpdate.e2e.ts` (read it first for the exact helper usage and the UID-parsing/unfold idiom) but opens the dataview vault and adds dataview write-back assertions:

```ts
import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';
import { appendTaskLine, replaceInFile } from '../helpers/vaultEdit';
import { openDataviewVault } from '../helpers/dataviewVault';

async function readFile(filePath: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, p) => {
    const f = app.vault.getAbstractFileByPath(p);
    return f ? app.vault.read(f as Parameters<typeof app.vault.read>[0]) : '';
  }, filePath);
}

describe('dataview full round-trip', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  before(async function () {
    await openDataviewVault();
  });

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('syncs Obsidian<->CalDAV with obsidian-tasks in dataview format', async function () {
    const original = `Plan trip ${Date.now()}`;
    const edited = `${original} EDITED`;

    // Phase 1: create in Obsidian -> server
    await appendTaskLine('Tasks.md', `- [ ] ${original} #sync`);
    await waitForTaskInCache(original);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(original),
      { timeout: 15000, interval: 500, timeoutMsg: `original "${original}" not on server` });

    // Phase 2: write-back used dataview, not emoji
    await browser.waitUntil(async () => {
      const tasks = await readFile('Tasks.md');
      return tasks.includes(original) && tasks.includes('[id:: ') && !tasks.includes('🆔');
    }, { timeout: 15000, interval: 500, timeoutMsg: 'write-back did not use dataview format ([id:: ] expected, 🆔 absent)' });

    // Phase 3: edit in Obsidian -> server
    await replaceInFile('Tasks.md', original, edited);
    await waitForTaskInCache(edited);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(edited),
      { timeout: 15000, interval: 500, timeoutMsg: `edited "${edited}" not on server` });

    // Phase 4: complete on server -> Obsidian, still dataview
    const ical = await fetchVtodos(calendarName);
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const uidMatch = unfolded.match(/^UID:(.+)$/m);
    if (!uidMatch) throw new Error(`could not parse UID from server response:\n${ical}`);
    const uid = uidMatch[1].trim();
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, edited, { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' }));
    await syncNow();

    await browser.waitUntil(async () => {
      const tasks = await readFile('Tasks.md');
      return /- \[x\][^\n]*EDITED/.test(tasks) && tasks.includes('[id:: ') && !tasks.includes('🆔');
    }, { timeout: 15000, interval: 500, timeoutMsg: 'server completion not reflected in dataview format' });
  });
});
```

- [ ] **Step 2: Type-check the spec**

Run: `npx tsc -p test/wdio/tsconfig.json --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 3: Run the full wdio suite (emoji specs + new dataview spec)**

Run: `npm run test:wdio`
Expected: all specs pass, including `dataview full round-trip` and the four pre-existing emoji specs. The emoji specs run against the default `test/wdio/vault` (the dataview spec's `before` reload only affects its own describe block; confirm the emoji specs still pass — if wdio-obsidian-service does not auto-restore the default vault for subsequent spec files, add an equivalent `before` to the dataview spec that is scoped to it only, which it already is via `reloadObsidian` being called in this spec's `before`; the service starts each spec file from the configured default unless reloaded). If an emoji spec fails because the dataview vault persisted, that is a real ordering bug — STOP and report it, do not weaken assertions.

- [ ] **Step 4: Commit**

```bash
git add test/wdio/specs/dataviewRoundTrip.e2e.ts
git commit -m "test(wdio): dataview full round-trip spec"
```

Append (blank line before):

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 6: Documentation + final verification

**Files:**
- Modify: `CLAUDE.md` (the "Obsidian smoke tests (wdio)" section)

- [ ] **Step 1: Note the dataview spec and second vault in CLAUDE.md**

In `CLAUDE.md`, find the `### Obsidian smoke tests (wdio)` section. Its **Scope** line currently reads:

```
**Scope:** four happy-path scenarios only — Obsidian→CalDAV create, CalDAV→Obsidian create, bidirectional update, completion+delete. Edge cases and error paths stay in the Jest unit/E2E suites.
```

Replace that line with:

```
**Scope:** four emoji happy-path scenarios (Obsidian→CalDAV create, CalDAV→Obsidian create, bidirectional update, completion+delete) plus one dataview full round-trip in a dedicated dataview-preset vault (`test/wdio/vault-dataview/`). Edge cases and error paths stay in the Jest unit/E2E suites.
```

And update the **Maintenance** line:

```
**Maintenance:** `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json` must be kept in sync with the `CalDAVSettings` shape in `src/types.ts` whenever settings fields change.
```

to:

```
**Maintenance:** the `tasks-caldav-sync/data.json` in both `test/wdio/vault/` and `test/wdio/vault-dataview/` must be kept in sync with the `CalDAVSettings` shape in `src/types.ts` whenever settings fields change.
```

- [ ] **Step 2: Full local verification (no regressions)**

Run: `npm run lint && npx tsc -noEmit -skipLibCheck && npm run test:unit`
Expected: lint 0 errors; tsc exit 0; unit suite all green (the dataview wdio work touches no `src/` code, so unit/coverage are unaffected — this confirms it).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note dataview wdio round-trip and second fixture vault"
```

Append (blank line before):

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 4: Push and confirm CI**

```bash
git push origin feat/dataview-support
```

Then watch the `wdio.yml` workflow run for the new commit (the dataview spec runs in the existing wdio job — `gh run list --branch feat/dataview-support --limit 3`, then `gh run view <id>`). Expected: the wdio job passes including `dataview full round-trip`. If the wdio job is flaky on CI for infra reasons unrelated to assertions, report the exact failure rather than weakening the spec.

---

## Self-Review

**Spec coverage:**
- New fixture vault `test/wdio/vault-dataview/` with both plugins dataview-preset → Task 2 (+ Task 1 spike for obsidian-tasks shape) ✓
- `prepare-wdio-vault.mjs` copies into both vaults → Task 3 ✓
- Spec switches into dataview vault via runtime reload → Task 4 (helper) + Task 5 (`before`) ✓
- Round-trip mirrors `bidirectionalUpdate` + dataview write-back assertion (`[id:: ]`, no `🆔`) → Task 5 ✓
- CI auto-picks the spec, both vaults get built plugin → Task 3 + Task 6 Step 4 ✓
- Out of scope (migration, separate caldav→obsidian-only spec, wdio.conf capability changes) → not present ✓
- Risks de-risked: vault-switch signature + obsidian-tasks settings key → Task 1 ✓

**Placeholder scan:** No "TBD"/"handle edge cases". The two runtime unknowns are resolved by concrete spike commands in Task 1 whose outputs feed Tasks 2/4 with exact procedures (including a deterministic `python3` transform); the expected obsidian-tasks key (`taskFormat`/`dataview`) is stated as the value to verify, with an explicit "adjust if different" instruction — not a blind placeholder.

**Type consistency:** `openDataviewVault()` defined in Task 4, imported in Task 5. Helper names reused from existing harness verbatim (`useCalendar`, `waitForTaskInCache`, `syncNow`, `fetchVtodos`, `buildVtodoIcs`, `putVtodo`, `appendTaskLine`, `replaceInFile`). Settings JSON in Task 2 matches `CalDAVSettings` (Task 2 Step 2a verifies). `data.json` filenames consistent across Tasks 2/3/6.
