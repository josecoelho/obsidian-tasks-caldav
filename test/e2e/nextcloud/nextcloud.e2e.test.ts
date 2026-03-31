/**
 * Nextcloud CalDAV E2E tests.
 *
 * All Nextcloud tests live in a single file because Nextcloud + SQLite
 * can't handle concurrent writes from parallel test files ("database is locked").
 *
 * Tests are kept minimal — one CRUD round-trip, ETag verification (issue #64),
 * and a sync adapter cycle. Duplication scenarios are covered by Vikunja E2E.
 */
import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../../src/sync/caldavAdapter';
import { diff } from '../../../src/sync/diff';
import { VTODOMapper } from '../../../src/caldav/vtodoMapper';
import { CommonTask } from '../../../src/sync/types';
import { IdMapping } from '../../../src/types';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { NEXTCLOUD, createIsolatedCalendar } from '../../helpers/nextcloudSetup';

jest.setTimeout(60000);

const emptyIdMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
const httpClient = new FetchHttpClient();
const mapper = new VTODOMapper();

let calendarName: string;
let clean: () => Promise<void>;
let cleanup: () => Promise<void>;

function makeClient(): CalDAVClientDirect {
  return new CalDAVClientDirect(
    {
      serverUrl: NEXTCLOUD.baseUrl,
      username: NEXTCLOUD.username,
      password: NEXTCLOUD.password,
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
}, 60000);

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await cleanup();
});

describe('Nextcloud: VTODO round-trip', () => {
  it('should discover calendar, create/fetch/update/delete a VTODO', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const uid = `nc-crud-${Date.now()}`;

    // Create
    await client.createVTODO(buildVTODO(uid, 'Buy groceries'), uid);
    let todos = await client.fetchVTODOs();
    expect(todos).toHaveLength(1);
    expect(mapper.vtodoToTask(todos[0]).title).toBe('Buy groceries');

    // Update — mark completed
    await client.updateVTODO(
      todos[0],
      buildVTODO(uid, 'Buy groceries', ['STATUS:COMPLETED', 'PERCENT-COMPLETE:100']),
    );
    todos = await client.fetchVTODOs();
    expect(mapper.vtodoToTask(todos[0]).status).toBe('DONE');

    // Delete
    await client.deleteVTODO(todos[0]);
    todos = await client.fetchVTODOs();
    expect(todos).toHaveLength(0);
  });
});

describe('Nextcloud: ETag handling (issue #64)', () => {
  it('should handle sequential fetch-update cycles without 412', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `nc-etag-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'v1'), uid);

    // First fetch-update
    const v1 = await client.fetchVTODOByUID(uid);
    expect(v1).not.toBeNull();
    expect(v1!.etag).toBeDefined();
    await client.updateVTODO(v1!, buildVTODO(uid, 'v2'));

    // Second fetch-update (must re-fetch for new ETag)
    const v2 = await client.fetchVTODOByUID(uid);
    expect(v2).not.toBeNull();
    await client.updateVTODO(v2!, buildVTODO(uid, 'v3'));

    // Verify final state
    const v3 = await client.fetchVTODOByUID(uid);
    expect(mapper.vtodoToTask(v3!).title).toBe('v3');
  });
});

describe('Nextcloud sync: full adapter cycle (issue #64)', () => {
  it('should complete a fetch-diff-apply cycle without 412', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `nc-sync-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original title'), uid);

    // First sync — discover the task
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    expect(caldavTasks1).toHaveLength(1);

    // Establish post-sync state
    const obsTaskId = `obs-sync-${Date.now()}`;
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { [obsTaskId]: uid },
      caldavUidToTaskId: { [uid]: obsTaskId },
    };
    const baseline: CommonTask[] = caldavTasks1.map(t => ({
      ...t,
      uid: idMapping.caldavUidToTaskId[t.uid] ?? t.uid,
    }));

    // Simulate Obsidian modified the task
    const obsidianTasks: CommonTask[] = baseline.map(t => ({
      ...t,
      title: 'Updated from Obsidian',
    }));

    // Second sync — diff produces update to CalDAV
    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping);
    const changeset = diff(obsidianTasks, caldavTasks2, baseline, 'caldav-wins');
    expect(changeset.toCalDAV).toHaveLength(1);
    expect(changeset.toCalDAV[0].type).toBe('update');

    // Apply — this is where 412 would occur with bad ETags
    await caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);

    // Verify
    const vtodos3 = await client.fetchVTODOs();
    expect(vtodos3).toHaveLength(1);
    expect(mapper.vtodoToTask(vtodos3[0]).title).toBe('Updated from Obsidian');
  });
});
