# wdio Obsidian smoke-test layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast, real-runtime wdio smoke suite (real Obsidian + real obsidian-tasks + real Radicale) covering the four happy-path sync scenarios, runnable locally and in CI, so the plugin no longer has to be built and verified by hand.

**Architecture:** `wdio-obsidian-service` launches a single pinned Obsidian version with our built plugin and the obsidian-tasks community plugin installed into a committed fixture vault. Each test creates an isolated Radicale calendar (reusing existing E2E helpers), points the plugin at it via its own settings API, mutates one side, runs `tasks-caldav-sync:sync-now`, and asserts both the vault file and the CalDAV server. The suite lives alongside the untouched Jest suites.

**Tech Stack:** WebdriverIO + Mocha, `wdio-obsidian-service`, TypeScript, existing `test/helpers/` (FetchHttpClient, radicaleSetup), Docker Radicale, GitHub Actions + Xvfb.

---

## Key facts (verified in this repo)

- Plugin manifest id: **`tasks-caldav-sync`**. obsidian-tasks plugin folder/manifest id: **`obsidian-tasks-plugin`**; its community-store install id is **`obsidian-tasks`**.
- Sync command id: **`tasks-caldav-sync:sync-now`**.
- Settings persist as the raw `CalDAVSettings` object in `.obsidian/plugins/tasks-caldav-sync/data.json` (`main.ts:145` `saveData(this.settings)`).
- `CalDAVSettings` (`src/types.ts:9`): `calendars: {tag,calendarName,serverUrl,username,password}[]`, `syncInterval`, `newTasksDestination` (default `'Inbox.md'`), `requireManualConflictResolution`, `autoResolveObsidianWins`, `syncCompletedTasks` (default `false`), `deleteBehavior: 'ask'|'deleteCalDAV'|'deleteObsidian'|'keepBoth'`, `includeObsidianLink`.
- Radicale: `http://localhost:5232`, auth disabled (`docker-compose.yml`), helper user `testuser`. `createIsolatedCalendar()` in `test/helpers/radicaleSetup.ts:115` makes `/testuser/e2e-<hex>/` and returns `{ calendarName, clean, cleanup }`. `RADICALE` const exports `baseUrl`, `username`, `password`.
- `FetchHttpClient` in `test/helpers/fetchHttpClient.ts` performs raw CalDAV HTTP (used for server-side assertions).
- Servers are started by `node scripts/ensure-servers.mjs --only radicale`.

To avoid interactive modals during automated sync, the fixture settings use `requireManualConflictResolution: false`, `syncCompletedTasks: true`, and `deleteBehavior: 'deleteCalDAV'` (Obsidian-side delete propagates to CalDAV; the delete test only exercises that direction).

## Correction (post-Task 3, authoritative)

During Task 3 it was found that `PROPFIND Depth:1` returns only DAV metadata, never VTODO bodies, so the `calendarText()` PROPFIND helper sketched inside Tasks 5 and 6 below **cannot** match task titles/STATUS and is wrong. Tasks 5 and 6 MUST instead use the shared helper created in Task 3's review:

`test/wdio/helpers/calendarQuery.ts` exports `fetchVtodos(calendarName: string): Promise<string>` — issues a CalDAV `REPORT` calendar-query (reusing production `REPORT_VTODOS` from `src/caldav/templates.ts`), throws on non-207, and returns the VTODO iCal text. Wherever Tasks 5/6 call `calendarText(calendarName)`, call `fetchVtodos(calendarName)` instead and delete the local PROPFIND `calendarText` definition.

Server-VTODO writes also use a shared helper created in Task 4's review: `test/wdio/helpers/serverVtodo.ts` exports `buildVtodoIcs(uid, summary, overrides?)` (RFC-5545 VCALENDAR/VTODO, includes `CATEGORIES:sync` by default — required by `CalDAVAdapter.filterByTag` — plus trailing CRLF) and `putVtodo(calendarName, uid, ics): Promise<number>` (PUT to Radicale, throws on non-2xx). Tasks 5/6 MUST build/PUT server VTODOs via these instead of inline `.ics` arrays/`http.request`; to mutate an existing VTODO, parse its `UID:` from `fetchVtodos(calendarName)` then `putVtodo(calendarName, uid, buildVtodoIcs(uid, summary, { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' }))`.

Vault edits go through `test/wdio/helpers/vaultEdit.ts` (created in Task 5's review): `appendTaskLine(filePath, line)`, `replaceInFile(filePath, from, to)`, `removeLineContaining(filePath, text)` — these wrap the `browser.executeObsidian` read/modify boilerplate. Tasks 6+ MUST use these instead of inline `executeObsidian` vault writes (Task 6 uses `appendTaskLine` to add the task, `replaceInFile('Tasks.md','- [ ] '+title,'- [x] '+title)` to complete it, and `removeLineContaining('Tasks.md', title)` to delete it).

Also authoritative for all specs: use `function`-style mocha callbacks (NOT arrow); do NOT `import { describe, it } from 'mocha'` (they are globals); import only what is used from `@wdio/globals` (no unused `expect`); declare `let cleanup: (() => Promise<void>) | undefined;` and call `await cleanup?.();` in `afterEach`; assert observable end state via `browser.waitUntil` (timeout 15000, interval 500) — never a fixed sleep + `expect`; never weaken an assertion to make a test pass.

## File structure

- Create `wdio.conf.ts` — wdio + obsidian-service config (root).
- Create `test/wdio/vault/` — committed fixture vault:
  - `test/wdio/vault/.obsidian/community-plugins.json` — enables both plugins.
  - `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json` — baseline `CalDAVSettings` (empty `calendars`; filled per-test at runtime).
  - `test/wdio/vault/Inbox.md` — default destination for CalDAV→Obsidian tasks.
  - `test/wdio/vault/Tasks.md` — source note for Obsidian→CalDAV tasks.
- Create `test/wdio/helpers/pluginConfig.ts` — runtime helper to point the plugin at an isolated calendar and to read obsidian-tasks state.
- Create `test/wdio/specs/` — the four smoke specs (one file each).
- Create `scripts/prepare-wdio-vault.mjs` — builds the plugin and copies artifacts into the fixture vault before a run.
- Create `.github/workflows/wdio.yml` — CI job.
- Modify `package.json` — add devDeps and `test:wdio` / `test:wdio:ci` scripts.
- Modify `tsconfig.json` (or add `test/wdio/tsconfig.json`) only if wdio type resolution requires it (see Task 1).

---

### Task 1: Bootstrap harness — Obsidian boots with both plugins

**Files:**
- Modify: `package.json`
- Create: `scripts/prepare-wdio-vault.mjs`
- Create: `wdio.conf.ts`
- Create: `test/wdio/vault/.obsidian/community-plugins.json`
- Create: `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json`
- Create: `test/wdio/vault/Inbox.md`
- Create: `test/wdio/vault/Tasks.md`
- Create: `test/wdio/specs/bootstrap.e2e.ts`

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter wdio-obsidian-service wdio-obsidian-reporter obsidian-launcher tsx
```
Expected: packages added to `devDependencies`, no peer-dep errors that block install.

- [ ] **Step 2: Add npm scripts**

In `package.json` `"scripts"`, add:
```json
"test:wdio": "node scripts/ensure-servers.mjs --only radicale && node scripts/prepare-wdio-vault.mjs && wdio run wdio.conf.ts",
"test:wdio:ci": "node scripts/prepare-wdio-vault.mjs && wdio run wdio.conf.ts"
```
(`test:wdio:ci` assumes Radicale is already started by the CI job.)

- [ ] **Step 3: Write the vault-prep script**

Create `scripts/prepare-wdio-vault.mjs`:
```js
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

execSync('npm run build', { stdio: 'inherit' });

const dest = 'test/wdio/vault/.obsidian/plugins/tasks-caldav-sync';
mkdirSync(dest, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  cpSync(f, `${dest}/${f}`);
}
console.log('wdio fixture vault prepared');
```
(`styles.css` exists at repo root per the release artifact list in CLAUDE.md.)

- [ ] **Step 4: Create the fixture vault files**

`test/wdio/vault/.obsidian/community-plugins.json`:
```json
["obsidian-tasks-plugin", "tasks-caldav-sync"]
```

`test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json`:
```json
{
  "calendars": [],
  "syncInterval": 5,
  "newTasksDestination": "Inbox.md",
  "requireManualConflictResolution": false,
  "autoResolveObsidianWins": false,
  "syncCompletedTasks": true,
  "deleteBehavior": "deleteCalDAV",
  "includeObsidianLink": false
}
```

`test/wdio/vault/Inbox.md`:
```markdown
# Inbox
```

`test/wdio/vault/Tasks.md`:
```markdown
# Tasks
```

- [ ] **Step 5: Write wdio.conf.ts**

Create `wdio.conf.ts`:
```typescript
import path from 'node:path';

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['obsidian'],
  services: ['obsidian'],
  specs: ['./test/wdio/specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [{
    browserName: 'obsidian',
    'wdio:obsidianOptions': {
      appVersion: 'latest',
      installerVersion: 'latest',
      plugins: [
        path.resolve('test/wdio/vault/.obsidian/plugins/tasks-caldav-sync'),
        { id: 'obsidian-tasks' },
      ],
      vault: path.resolve('test/wdio/vault'),
    },
  }],
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  autoCompileOpts: { autoCompile: true, tsNodeOpts: { transpileOnly: true } },
};
```
NOTE: The exact option keys (`wdio:obsidianOptions` vs `obsidian:options`, `plugins` entry shape) must match the installed `wdio-obsidian-service` version. Cross-check against the official sample plugin repo `jesse-r-s-hines/wdio-obsidian-service-sample-plugin` (`wdio.conf.ts`) and adjust this file until Step 7 passes. Do not proceed to Task 2 until the bootstrap test is green.

- [ ] **Step 6: Write the bootstrap test**

Create `test/wdio/specs/bootstrap.e2e.ts`:
```typescript
import { browser, expect } from '@wdio/globals';

describe('wdio harness bootstrap', () => {
  it('loads Obsidian with both plugins enabled', async () => {
    const ids = await browser.executeObsidian(({ app }) =>
      Object.keys((app as any).plugins.plugins),
    );
    expect(ids).toContain('tasks-caldav-sync');
    expect(ids).toContain('obsidian-tasks-plugin');
  });
});
```

- [ ] **Step 7: Run the bootstrap test**

Run: `npm run test:wdio`
Expected: Radicale reachable, plugin built+copied, Obsidian downloads/launches once, the single test PASSES. If config keys are wrong, fix `wdio.conf.ts` per the Step 5 note and re-run until green.

- [ ] **Step 8: Add .gitignore entries and commit**

Append to `.gitignore`: `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/main.js`, `.../manifest.json`, `.../styles.css`, and `.obsidian/workspace*.json` under the fixture vault (build output and Obsidian-generated layout must not be committed; the `data.json` and `community-plugins.json` ARE committed).

```bash
git add package.json wdio.conf.ts scripts/prepare-wdio-vault.mjs test/wdio/ .gitignore
git commit -m "test(wdio): bootstrap real-Obsidian harness (#50)"
```

---

### Task 2: Runtime config + obsidian-tasks sync helpers

**Files:**
- Create: `test/wdio/helpers/pluginConfig.ts`
- Test: exercised by Task 3's first spec (no standalone test — this is harness code validated by the first scenario).

- [ ] **Step 1: Write the helper**

Create `test/wdio/helpers/pluginConfig.ts`:
```typescript
import { browser } from '@wdio/globals';
import { RADICALE } from '../../helpers/radicaleSetup';

/** Point the plugin at an isolated calendar and reinitialize its engines. */
export async function useCalendar(calendarName: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
    plugin.settings.calendars = [{
      tag: 'sync',
      calendarName: args.calendarName,
      serverUrl: args.serverUrl,
      username: args.username,
      password: args.password,
    }];
    await plugin.saveSettings();
  }, {
    calendarName,
    serverUrl: RADICALE.baseUrl,
    username: RADICALE.username,
    password: RADICALE.password,
  });
}

/** Wait until obsidian-tasks' cache reports a task whose description includes `text`. */
export async function waitForTaskInCache(text: string): Promise<void> {
  await browser.waitUntil(async () => {
    return browser.executeObsidian(({ app }, t) => {
      const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
      return tp.getTasks().some((task: any) => task.description.includes(t));
    }, text);
  }, { timeout: 20000, interval: 500, timeoutMsg: `task "${text}" never appeared in obsidian-tasks cache` });
}

/** Run sync and wait for it to finish (sync-now is fire-and-forget). */
export async function syncNow(): Promise<void> {
  await browser.executeObsidianCommand('tasks-caldav-sync:sync-now');
  // sync-now shows a completion Notice; give the async pipeline time to settle.
  await browser.pause(4000);
}
```
NOTE: `RADICALE.password` is exported by `test/helpers/radicaleSetup.ts`; Radicale auth is disabled so the value is accepted as-is.

- [ ] **Step 2: Commit**

```bash
git add test/wdio/helpers/pluginConfig.ts
git commit -m "test(wdio): add plugin-config and cache-wait helpers (#50)"
```

---

### Task 3: Smoke test — Obsidian → CalDAV create

**Files:**
- Create: `test/wdio/specs/obsidianToCaldav.e2e.ts`

- [ ] **Step 1: Write the spec**

Create `test/wdio/specs/obsidianToCaldav.e2e.ts`:
```typescript
import { browser, expect } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

describe('Obsidian -> CalDAV create', () => {
  let calendarName: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async () => { await cleanup(); });

  it('creates a VTODO on the server for a tagged task', async () => {
    const title = `Buy milk ${Date.now()}`;
    await browser.executeObsidian(async ({ app }, args) => {
      const file = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(file as any);
      await app.vault.modify(file as any, body + `\n- [ ] ${args.title} #sync`);
    }, { title });

    await waitForTaskInCache(title);
    await syncNow();

    const res = await http.request({
      url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`,
      method: 'PROPFIND',
      headers: { Depth: '1' },
    });
    expect(res.status).toBe(207);
    expect(res.text).toContain(title);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:wdio -- --spec test/wdio/specs/obsidianToCaldav.e2e.ts`
Expected: PASS. If the VTODO is absent, inspect the sync Notice via `browser.executeObsidian` logs and increase the `syncNow` pause or the cache wait; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add test/wdio/specs/obsidianToCaldav.e2e.ts
git commit -m "test(wdio): Obsidian->CalDAV create smoke test (#50)"
```

---

### Task 4: Smoke test — CalDAV → Obsidian create

**Files:**
- Create: `test/wdio/specs/caldavToObsidian.e2e.ts`

- [ ] **Step 1: Write the spec**

Create `test/wdio/specs/caldavToObsidian.e2e.ts`:
```typescript
import { browser, expect } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

describe('CalDAV -> Obsidian create', () => {
  let calendarName: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async () => { await cleanup(); });

  it('writes a task line into the vault for a server VTODO', async () => {
    const uid = `wdio-${Date.now()}`;
    const summary = `Server task ${Date.now()}`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//wdio//EN',
      'BEGIN:VTODO', `UID:${uid}`, `SUMMARY:${summary}`,
      'STATUS:NEEDS-ACTION', 'END:VTODO', 'END:VCALENDAR',
    ].join('\r\n');

    const put = await http.request({
      url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/${uid}.ics`,
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: ics,
    });
    expect([201, 204]).toContain(put.status);

    await syncNow();

    await browser.waitUntil(async () => {
      const inbox = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Inbox.md');
        return f ? app.vault.read(f as any) : '';
      });
      return inbox.includes(summary);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'task not written to Inbox.md' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:wdio -- --spec test/wdio/specs/caldavToObsidian.e2e.ts`
Expected: PASS (task line containing `summary` present in `Inbox.md`).

- [ ] **Step 3: Commit**

```bash
git add test/wdio/specs/caldavToObsidian.e2e.ts
git commit -m "test(wdio): CalDAV->Obsidian create smoke test (#50)"
```

---

### Task 5: Smoke test — bidirectional update

**Files:**
- Create: `test/wdio/specs/bidirectionalUpdate.e2e.ts`

- [ ] **Step 1: Write the spec**

Create `test/wdio/specs/bidirectionalUpdate.e2e.ts`:
```typescript
import { browser, expect } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

async function calendarText(calendarName: string): Promise<string> {
  const res = await http.request({
    url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`,
    method: 'PROPFIND', headers: { Depth: '1' },
  });
  return res.text;
}

describe('bidirectional update', () => {
  let calendarName: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async () => { await cleanup(); });

  it('propagates an Obsidian edit to the server, then a server edit back', async () => {
    const original = `Plan trip ${Date.now()}`;
    const edited = `${original} EDITED`;

    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      await app.vault.modify(f as any, body + `\n- [ ] ${args.original} #sync`);
    }, { original });
    await waitForTaskInCache(original);
    await syncNow();

    // Obsidian-side edit -> server
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      await app.vault.modify(f as any, body.replace(args.original, args.edited));
    }, { original, edited });
    await waitForTaskInCache(edited);
    await syncNow();
    expect(await calendarText(calendarName)).toContain(edited);

    // Server-side completion -> Obsidian
    await browser.waitUntil(async () => (await calendarText(calendarName)).includes(edited),
      { timeout: 10000, interval: 500 });
    // Toggle the VTODO to completed directly on the server, then sync back.
    // (Find the .ics href, GET, flip STATUS to COMPLETED, PUT.)
    const list = await calendarText(calendarName);
    const href = list.match(/\/[^<]+\.ics/)![0];
    const get = await http.request({ url: `${RADICALE.baseUrl}${href}`, method: 'GET', headers: {} });
    const done = get.text
      .replace('STATUS:NEEDS-ACTION', 'STATUS:COMPLETED')
      .replace('END:VTODO', 'PERCENT-COMPLETE:100\r\nEND:VTODO');
    const put = await http.request({
      url: `${RADICALE.baseUrl}${href}`, method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' }, body: done,
    });
    expect([201, 204]).toContain(put.status);

    await syncNow();

    await browser.waitUntil(async () => {
      const tasksFile = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Tasks.md');
        return app.vault.read(f as any);
      });
      return /- \[x\] .*EDITED/.test(tasksFile);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'server completion not reflected in vault' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:wdio -- --spec test/wdio/specs/bidirectionalUpdate.e2e.ts`
Expected: PASS. If the server-side `.ics` href regex misses, log `list` and adjust the match to the actual PROPFIND response shape; keep the behavioral assertions intact.

- [ ] **Step 3: Commit**

```bash
git add test/wdio/specs/bidirectionalUpdate.e2e.ts
git commit -m "test(wdio): bidirectional update smoke test (#50)"
```

---

### Task 6: Smoke test — completion + delete

**Files:**
- Create: `test/wdio/specs/completionAndDelete.e2e.ts`

- [ ] **Step 1: Write the spec**

Create `test/wdio/specs/completionAndDelete.e2e.ts`:
```typescript
import { browser, expect } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

async function calendarText(calendarName: string): Promise<string> {
  const res = await http.request({
    url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`,
    method: 'PROPFIND', headers: { Depth: '1' },
  });
  return res.text;
}

describe('completion and delete', () => {
  let calendarName: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async () => { await cleanup(); });

  it('propagates completion, then propagates an Obsidian-side delete to the server', async () => {
    const title = `Submit report ${Date.now()}`;

    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      await app.vault.modify(f as any, body + `\n- [ ] ${args.title} #sync`);
    }, { title });
    await waitForTaskInCache(title);
    await syncNow();

    // Complete in Obsidian -> server VTODO becomes COMPLETED
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      await app.vault.modify(f as any,
        body.replace(`- [ ] ${args.title}`, `- [x] ${args.title}`));
    }, { title });
    await waitForTaskInCache(title);
    await syncNow();
    await browser.waitUntil(async () => {
      const t = await calendarText(calendarName);
      return t.includes(title) && /STATUS:COMPLETED/.test(t);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'completion not propagated to server' });

    // Delete in Obsidian -> server VTODO removed (deleteBehavior: deleteCalDAV)
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      const kept = body.split('\n').filter(l => !l.includes(args.title)).join('\n');
      await app.vault.modify(f as any, kept);
    }, { title });
    await browser.waitUntil(async () => {
      const present = await browser.executeObsidian(({ app }, t) => {
        const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
        return tp.getTasks().some((x: any) => x.description.includes(t));
      }, title);
      return !present;
    }, { timeout: 15000, interval: 500, timeoutMsg: 'task still in cache after delete' });
    await syncNow();

    await browser.waitUntil(async () => !(await calendarText(calendarName)).includes(title),
      { timeout: 15000, interval: 500, timeoutMsg: 'delete not propagated to server' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:wdio -- --spec test/wdio/specs/completionAndDelete.e2e.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suite together**

Run: `npm run test:wdio`
Expected: all five specs (bootstrap + four scenarios) PASS in one Obsidian session.

- [ ] **Step 4: Commit**

```bash
git add test/wdio/specs/completionAndDelete.e2e.ts
git commit -m "test(wdio): completion + delete smoke test (#50)"
```

---

### Task 7: CI workflow

**Files:**
- Create: `.github/workflows/wdio.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/wdio.yml`:
```yaml
name: wdio smoke

on:
  push:
    branches: [master]
  pull_request:

jobs:
  wdio:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Start Radicale
        run: docker compose up -d radicale
      - name: Wait for Radicale
        run: node scripts/ensure-servers.mjs --only radicale
      - name: Cache Obsidian binaries
        uses: actions/cache@v4
        with:
          path: ~/.cache/obsidian-launcher
          key: obsidian-launcher-${{ runner.os }}
      - name: Run wdio smoke suite
        uses: coactions/setup-xvfb@v1
        with:
          run: npm run test:wdio:ci
```
NOTE: confirm the obsidian-launcher cache path against `obsidian-launcher` docs; adjust the `path:` if it differs. The Jest workflow is a separate file and is not modified — the two jobs run independently.

- [ ] **Step 2: Commit and push to verify CI**

```bash
git add .github/workflows/wdio.yml
git commit -m "ci(wdio): smoke suite job with Xvfb + Radicale (#50)"
git push
```
Expected: the new `wdio smoke` job runs and goes green; the existing Jest job is unaffected and still green.

---

### Task 8: Wire-up docs + close the loop on #50

**Files:**
- Modify: `README.md` (or `AGENTS.md`/`CLAUDE.md` testing section — match where existing test docs live)

- [ ] **Step 1: Document the suite**

Add a short "wdio smoke tests" subsection to the existing testing docs: what it covers (the four happy paths), how to run (`npm run test:wdio`), prerequisites (Docker for Radicale, first run downloads Obsidian), and the explicit non-goal that edge cases stay in Jest.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: document wdio smoke suite (#50)"
```

- [ ] **Step 3: Update issue #50**

Post a comment on #50 summarizing the delivered wdio-only happy-path layer and the decision to keep edge-case coverage in Jest (jest-environment-obsidian deferred). Reference the design doc `docs/superpowers/specs/2026-05-17-wdio-obsidian-smoke-tests-design.md`.

---

## Verification

- `npm run test:wdio` locally: Radicale starts, plugin builds+copies, Obsidian launches once, all five specs pass.
- `npm test` (Jest): unchanged, still green, coverage gates untouched.
- CI: the `wdio smoke` job is green and independent from the Jest job.
- Manual sanity (one-time): confirm `test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json` matches the current `CalDAVSettings` shape in `src/types.ts`; if `CalDAVSettings` changes later, this fixture must be updated (call this out in the docs from Task 8).

## Notes on flakiness (apply throughout)

- Always `waitForTaskInCache` before `syncNow` for Obsidian-originated changes — obsidian-tasks' cache updates asynchronously on metadata events.
- Prefer `browser.waitUntil` on the observable end state over fixed pauses for assertions; the fixed pause in `syncNow` only covers the fire-and-forget command dispatch.
- One Obsidian instance, `maxInstances: 1`, isolated Radicale calendar per test — no shared mutable state between specs.
