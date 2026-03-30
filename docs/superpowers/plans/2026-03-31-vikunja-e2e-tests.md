# Vikunja E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vikunja as a second E2E CalDAV server to reproduce the task duplication bug from issue #60.

**Architecture:** Add a Vikunja Docker service alongside Radicale, with a parallel test helper for bootstrapping users/projects via Vikunja's REST API, and E2E tests that exercise CalDAV operations and reproduce the sync duplication scenario.

**Tech Stack:** Docker, Vikunja (SQLite), TypeScript, Jest, CalDAV

---

### Task 1: Add Vikunja Docker service

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add vikunja service to docker-compose.yml**

```yaml
  vikunja:
    image: vikunja/vikunja
    ports:
      - "3457:3456"
    environment:
      VIKUNJA_SERVICE_PUBLICURL: http://localhost:3457
      VIKUNJA_SERVICE_ENABLEREGISTRATION: "true"
      VIKUNJA_SERVICE_TESTINGTOKEN: ""
      VIKUNJA_DATABASE_TYPE: sqlite
      VIKUNJA_DATABASE_PATH: /db/vikunja.db
    tmpfs:
      - /db
      - /app/vikunja/files
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3456/api/v1/info"]
      interval: 2s
      timeout: 5s
      retries: 15
```

Append this after the existing `radicale` service in `docker-compose.yml`.

- [ ] **Step 2: Verify Vikunja starts**

Run: `docker compose up -d --wait`
Expected: Both `radicale` and `vikunja` containers start and pass healthchecks.

- [ ] **Step 3: Verify Vikunja is reachable**

Run: `curl -s http://localhost:3457/api/v1/info | head -c 200`
Expected: JSON response with Vikunja version info.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add Vikunja Docker service for E2E tests"
```

---

### Task 2: Update ensure script for both servers

**Files:**
- Modify: `scripts/ensure-radicale.mjs` → rename to `scripts/ensure-servers.mjs`
- Modify: `package.json`

- [ ] **Step 1: Rename and update the ensure script**

Rename `scripts/ensure-radicale.mjs` to `scripts/ensure-servers.mjs`. Update it to check both servers:

```javascript
/**
 * Ensure Radicale and Vikunja are reachable. If not, start them via docker compose.
 * Exits cleanly if all servers are already running (from any worktree).
 */

const SERVERS = [
  { name: 'radicale', url: 'http://localhost:5232/.web/' },
  { name: 'vikunja', url: 'http://localhost:3457/api/v1/info' },
];
const TIMEOUT_MS = 2000;

async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const results = await Promise.all(
    SERVERS.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
  );

  const allUp = results.every((r) => r.up);
  if (allUp) {
    console.log('[servers] All servers already running');
    return;
  }

  for (const r of results) {
    console.log(`[servers] ${r.name}: ${r.up ? 'running' : 'not reachable'}`);
  }

  console.log('[servers] Starting via docker compose...');
  const { execSync } = await import('child_process');
  try {
    execSync('docker compose up -d --wait', { stdio: 'inherit' });
  } catch {
    // If docker compose fails, check if they came up anyway
    const recheck = await Promise.all(
      SERVERS.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
    );
    if (recheck.every((r) => r.up)) {
      console.log('[servers] All servers running (started by another project)');
      return;
    }
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Update package.json test script**

Change the test script from:
```json
"test": "node scripts/ensure-radicale.mjs && jest --coverage"
```
to:
```json
"test": "node scripts/ensure-servers.mjs && jest --coverage"
```

- [ ] **Step 3: Delete the old script**

```bash
git rm scripts/ensure-radicale.mjs
```

- [ ] **Step 4: Verify tests still run**

Run: `npm test`
Expected: All existing tests pass. Both servers are started/detected.

- [ ] **Step 5: Commit**

```bash
git add scripts/ensure-servers.mjs package.json
git commit -m "infra: rename ensure-radicale to ensure-servers, add Vikunja check"
```

---

### Task 3: Create Vikunja test helper

**Files:**
- Create: `test/helpers/vikunjaSetup.ts`

This helper bootstraps a Vikunja user and creates isolated calendars (projects) via Vikunja's REST API. CalDAV access uses Basic Auth at `/dav/`.

- [ ] **Step 1: Create vikunjaSetup.ts**

```typescript
import { FetchHttpClient } from './fetchHttpClient';
import * as crypto from 'crypto';

export const VIKUNJA = {
  baseUrl: 'http://localhost:3457',
  davUrl: 'http://localhost:3457/dav',
  username: 'testuser',
  email: 'testuser@test.local',
  password: 'TestPass123!',
} as const;

const http = new FetchHttpClient();

let bootstrapped = false;

/**
 * Register a test user and ensure they exist.
 * Idempotent — skips if already bootstrapped this process.
 */
export async function bootstrapVikunjaUser(): Promise<void> {
  if (bootstrapped) return;

  // Try to register — 200 means created, 400 may mean already exists
  const registerResp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/register`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: VIKUNJA.username,
      email: VIKUNJA.email,
      password: VIKUNJA.password,
    }),
  });

  if (registerResp.status !== 200 && registerResp.status !== 201) {
    // User may already exist — verify by logging in
    const loginResp = await http.request({
      url: `${VIKUNJA.baseUrl}/api/v1/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: VIKUNJA.username,
        password: VIKUNJA.password,
      }),
    });
    if (loginResp.status !== 200) {
      throw new Error(
        `Vikunja bootstrap failed: register=${registerResp.status} login=${loginResp.status} ${loginResp.text}`,
      );
    }
  }

  bootstrapped = true;
}

/**
 * Get a JWT token for API calls.
 */
async function getToken(): Promise<string> {
  const resp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/login`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: VIKUNJA.username,
      password: VIKUNJA.password,
    }),
  });
  if (resp.status !== 200) {
    throw new Error(`Vikunja login failed: ${resp.status} ${resp.text}`);
  }
  const data = JSON.parse(resp.text);
  return data.token as string;
}

/**
 * Create an isolated Vikunja project (= CalDAV calendar) with a random name.
 * Returns the project title (used as calendarName for CalDAV discovery)
 * and cleanup functions.
 */
export async function createIsolatedCalendar(): Promise<{
  calendarName: string;
  projectId: number;
  clean: () => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  await bootstrapVikunjaUser();
  const token = await getToken();

  const calendarName = `e2e-${crypto.randomBytes(6).toString('hex')}`;

  const createResp = await http.request({
    url: `${VIKUNJA.baseUrl}/api/v1/projects`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: calendarName }),
  });

  if (createResp.status !== 200 && createResp.status !== 201) {
    throw new Error(`Vikunja create project failed: ${createResp.status} ${createResp.text}`);
  }

  const project = JSON.parse(createResp.text);
  const projectId = project.id as number;

  return {
    calendarName,
    projectId,
    /** Delete all tasks in the project (use in beforeEach). */
    clean: async () => {
      const freshToken = await getToken();
      // Fetch all tasks in the project
      const tasksResp = await http.request({
        url: `${VIKUNJA.baseUrl}/api/v1/projects/${projectId}/tasks`,
        method: 'GET',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      if (tasksResp.status === 200) {
        const tasks = JSON.parse(tasksResp.text) as Array<{ id: number }>;
        for (const task of tasks) {
          await http.request({
            url: `${VIKUNJA.baseUrl}/api/v1/tasks/${task.id}`,
            method: 'DELETE',
            headers: { Authorization: `Bearer ${freshToken}` },
          });
        }
      }
    },
    /** Delete the project permanently (use in afterAll). */
    cleanup: async () => {
      const freshToken = await getToken();
      await http.request({
        url: `${VIKUNJA.baseUrl}/api/v1/projects/${projectId}`,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
    },
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors related to `vikunjaSetup.ts`.

- [ ] **Step 3: Commit**

```bash
git add test/helpers/vikunjaSetup.ts
git commit -m "test: add Vikunja E2E test helper with user/project bootstrap"
```

---

### Task 4: Basic Vikunja CalDAV client E2E test

**Files:**
- Create: `test/e2e/vikunja/vikunjaClient.e2e.test.ts`

This test validates that `CalDAVClientDirect` works with Vikunja's CalDAV implementation — connect, create, fetch, update, delete.

- [ ] **Step 1: Create the test file**

```typescript
import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { VTODOMapper } from '../../../src/caldav/vtodoMapper';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { VIKUNJA, createIsolatedCalendar } from '../../helpers/vikunjaSetup';

const httpClient = new FetchHttpClient();
const mapper = new VTODOMapper();

let calendarName: string;
let clean: () => Promise<void>;
let cleanup: () => Promise<void>;

function makeClient(): CalDAVClientDirect {
  return new CalDAVClientDirect(
    {
      serverUrl: VIKUNJA.baseUrl,
      username: VIKUNJA.username,
      password: VIKUNJA.password,
      calendarName,
    },
    httpClient,
  );
}

function buildVTODO(uid: string, summary: string, extra: string[] = []): string {
  const hasStatus = extra.some(l => l.startsWith('STATUS:'));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//E2E Test//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20250101T000000Z',
    `SUMMARY:${summary}`,
    ...(hasStatus ? [] : ['STATUS:NEEDS-ACTION']),
    ...extra,
    'END:VTODO',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

beforeAll(async () => {
  const cal = await createIsolatedCalendar();
  calendarName = cal.calendarName;
  clean = cal.clean;
  cleanup = cal.cleanup;
}, 30000);

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await cleanup();
});

describe('Vikunja: Calendar discovery', () => {
  it('should connect and find the test calendar', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });
});

describe('Vikunja: VTODO CRUD round-trip', () => {
  it('should create, fetch, update, and delete a VTODO', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `vik-crud-${Date.now()}`;
    const vtodo = buildVTODO(uid, 'Buy groceries');

    // Create
    await client.createVTODO(vtodo, uid);

    // Fetch — should find exactly one
    let todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);

    const fetched = todos[0];
    const task = mapper.vtodoToTask(fetched);
    expect(task.title).toBe('Buy groceries');
    expect(task.status).toBe('TODO');

    // Update — mark completed
    const updated = buildVTODO(uid, 'Buy groceries', [
      'STATUS:COMPLETED',
      'COMPLETED:20250601T120000Z',
      'PERCENT-COMPLETE:100',
    ]);
    await client.updateVTODO(fetched, updated);

    // Fetch again — verify update
    todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);
    const updatedTask = mapper.vtodoToTask(todos[0]);
    expect(updatedTask.status).toBe('DONE');

    // Delete
    await client.deleteVTODO(todos[0]);

    // Fetch again — should be empty
    todos = await client.fetchVTODOs();
    expect(todos.length).toBe(0);
  });
});

describe('Vikunja: Multiple VTODOs', () => {
  it('should handle multiple VTODOs in the same calendar', async () => {
    const client = makeClient();
    await client.connect();

    const uids = [
      `vik-multi-1-${Date.now()}`,
      `vik-multi-2-${Date.now()}`,
      `vik-multi-3-${Date.now()}`,
    ];

    for (const uid of uids) {
      await client.createVTODO(buildVTODO(uid, `Task ${uid}`), uid);
    }

    const todos = await client.fetchVTODOs();
    expect(todos.length).toBe(3);

    // Delete one
    await client.deleteVTODO(todos[0]);
    const remaining = await client.fetchVTODOs();
    expect(remaining.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest --selectProjects e2e --testPathPattern vikunjaClient --verbose`
Expected: All 3 tests pass (connect, CRUD, multiple VTODOs). If they fail, debug Vikunja CalDAV quirks before proceeding.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/vikunja/vikunjaClient.e2e.test.ts
git commit -m "test: add basic Vikunja CalDAV client E2E tests"
```

---

### Task 5: Vikunja sync duplication reproduction test (issue #60)

**Files:**
- Create: `test/e2e/vikunja/vikunjaSync.e2e.test.ts`

This is the core reproduction test. It simulates the exact scenario from issue #60: a task created on the CalDAV server gets duplicated on every sync.

The test uses the same layers the real SyncEngine uses (`CalDAVAdapter.normalize()`, `diff()`, `CalDAVAdapter.applyChanges()`) but without the Obsidian side (which we simulate with arrays). This mirrors the pattern in `syncRoundTrip.e2e.test.ts`.

- [ ] **Step 1: Create the reproduction test file**

```typescript
import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../../src/sync/caldavAdapter';
import { diff } from '../../../src/sync/diff';
import { CommonTask, SyncChange } from '../../../src/sync/types';
import { IdMapping } from '../../../src/types';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { VIKUNJA, createIsolatedCalendar } from '../../helpers/vikunjaSetup';

const emptyIdMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

const httpClient = new FetchHttpClient();

let calendarName: string;
let clean: () => Promise<void>;
let cleanup: () => Promise<void>;

function makeClient(): CalDAVClientDirect {
  return new CalDAVClientDirect(
    {
      serverUrl: VIKUNJA.baseUrl,
      username: VIKUNJA.username,
      password: VIKUNJA.password,
      calendarName,
    },
    httpClient,
  );
}

function buildVTODO(uid: string, summary: string, extra: string[] = []): string {
  const hasStatus = extra.some(l => l.startsWith('STATUS:'));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//E2E Test//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20250101T000000Z',
    `SUMMARY:${summary}`,
    ...(hasStatus ? [] : ['STATUS:NEEDS-ACTION']),
    ...extra,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
}

beforeAll(async () => {
  const cal = await createIsolatedCalendar();
  calendarName = cal.calendarName;
  clean = cal.clean;
  cleanup = cal.cleanup;
}, 30000);

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await cleanup();
});

describe('Vikunja sync: issue #60 — server-created task duplication', () => {
  it('should not duplicate a server-created task on second sync', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // --- Simulate: task created directly on Vikunja (server-side) ---
    const serverUid = `vik-server-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(serverUid, 'Task created on server', ['DUE;VALUE=DATE:20250801']),
      serverUid,
    );

    // --- SYNC 1: First sync discovers the server-created task ---
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    const obsidianTasks1: CommonTask[] = []; // Obsidian is empty
    const baseline1: CommonTask[] = []; // No baseline yet

    const changeset1 = diff(obsidianTasks1, caldavTasks1, baseline1, 'caldav-wins');

    // Should create the task in Obsidian
    expect(changeset1.toObsidian).toHaveLength(1);
    expect(changeset1.toObsidian[0].type).toBe('create');
    expect(changeset1.toObsidian[0].task.title).toBe('Task created on server');

    // Simulate: Obsidian applied the create, now has the task.
    // Build updated ID mapping (server UID → obsidian task ID).
    const obsidianTaskId = `obs-${Date.now()}`;
    const idMapping1: IdMapping = {
      taskIdToCaldavUid: { [obsidianTaskId]: serverUid },
      caldavUidToTaskId: { [serverUid]: obsidianTaskId },
    };

    // Build new baseline (what both sides agree on after sync 1)
    const baselineAfterSync1: CommonTask[] = caldavTasks1.map(t => ({
      ...t,
      uid: idMapping1.caldavUidToTaskId[t.uid] ?? t.uid,
    }));

    // Simulate: Obsidian now has the task with obsidianTaskId
    const obsidianTasks2: CommonTask[] = baselineAfterSync1.map(t => ({ ...t }));

    // --- SYNC 2: Second sync — nothing changed, should produce no changes ---
    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping1);

    const changeset2 = diff(obsidianTasks2, caldavTasks2, baselineAfterSync1, 'caldav-wins');

    // THIS IS THE BUG: if duplication occurs, toObsidian will have creates
    expect(changeset2.toObsidian).toHaveLength(0);
    expect(changeset2.toCalDAV).toHaveLength(0);
    expect(changeset2.conflicts).toHaveLength(0);
  });

  it('should not duplicate when server creates a task while obsidian has existing tasks', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // --- Setup: An existing synced task ---
    const existingUid = `vik-existing-${Date.now()}`;
    await client.createVTODO(buildVTODO(existingUid, 'Pre-existing task'), existingUid);

    const vtodos0 = await client.fetchVTODOs();
    const caldavTasks0 = caldavAdapter.normalize(vtodos0, emptyIdMapping);

    // Simulate established sync state
    const obsExistingId = `obs-existing-${Date.now()}`;
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { [obsExistingId]: existingUid },
      caldavUidToTaskId: { [existingUid]: obsExistingId },
    };
    const baseline: CommonTask[] = caldavTasks0.map(t => ({
      ...t,
      uid: idMapping.caldavUidToTaskId[t.uid] ?? t.uid,
    }));
    const obsidianTasks: CommonTask[] = baseline.map(t => ({ ...t }));

    // --- Now a NEW task is created directly on the server ---
    const newServerUid = `vik-new-server-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(newServerUid, 'Newly created on server'),
      newServerUid,
    );

    // --- SYNC: Should detect the new task, not duplicate the existing one ---
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, idMapping);

    const changeset = diff(obsidianTasks, caldavTasks1, baseline, 'caldav-wins');

    // Only the new task should appear as a create
    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('create');
    expect(changeset.toObsidian[0].task.title).toBe('Newly created on server');

    // No changes going back to CalDAV
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('should handle server-created task updated after initial sync', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // Create task on server
    const serverUid = `vik-upd-${Date.now()}`;
    await client.createVTODO(buildVTODO(serverUid, 'Server task'), serverUid);

    // SYNC 1
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    const changeset1 = diff([], caldavTasks1, [], 'caldav-wins');
    expect(changeset1.toObsidian).toHaveLength(1);

    // Establish post-sync state
    const obsId = `obs-upd-${Date.now()}`;
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { [obsId]: serverUid },
      caldavUidToTaskId: { [serverUid]: obsId },
    };
    const baseline: CommonTask[] = caldavTasks1.map(t => ({
      ...t,
      uid: idMapping.caldavUidToTaskId[t.uid] ?? t.uid,
    }));
    const obsidianTasks: CommonTask[] = baseline.map(t => ({ ...t }));

    // Update the task on server
    const updatedVTODO = buildVTODO(serverUid, 'Server task UPDATED', [
      'DUE;VALUE=DATE:20250901',
    ]);
    const existing = await client.fetchVTODOByUID(serverUid);
    if (!existing) throw new Error('VTODO not found');
    await client.updateVTODO(existing, updatedVTODO);

    // SYNC 2
    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping);

    const changeset2 = diff(obsidianTasks, caldavTasks2, baseline, 'caldav-wins');

    // Should be an update, not a create (no duplication)
    expect(changeset2.toObsidian).toHaveLength(1);
    expect(changeset2.toObsidian[0].type).toBe('update');
    expect(changeset2.toObsidian[0].task.title).toBe('Server task UPDATED');
    expect(changeset2.toCalDAV).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the reproduction tests**

Run: `npx jest --selectProjects e2e --testPathPattern vikunjaSync --verbose`

Expected: Tests either all pass (sync logic is correct for Vikunja) or some fail (reproducing the bug). Document which tests fail and how.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/vikunja/vikunjaSync.e2e.test.ts
git commit -m "test: add Vikunja sync duplication reproduction tests for issue #60"
```

---

### Task 6: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All existing Radicale tests still pass. Vikunja tests show whether the bug reproduces. Coverage thresholds met.

- [ ] **Step 2: Document results**

If Vikunja tests expose a bug, note the exact failure (which UID matching breaks, what diff produces). This informs the fix in a follow-up PR.

If tests pass, the sync logic handles Vikunja correctly at this level and the bug may be in a layer not covered here (e.g., ObsidianAdapter ID writeback, or Vikunja returning different UIDs than what was PUT).

- [ ] **Step 3: Commit any adjustments**

If any test needed tweaks for Vikunja CalDAV quirks (different status codes, different XML responses, etc.), commit those fixes.
