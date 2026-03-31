import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { VTODOMapper } from '../../../src/caldav/vtodoMapper';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { NEXTCLOUD, createIsolatedCalendar } from '../../helpers/nextcloudSetup';

jest.setTimeout(60000);

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

describe('Nextcloud: Calendar discovery', () => {
  it('should connect and find the test calendar', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });
});

describe('Nextcloud: VTODO CRUD round-trip', () => {
  it('should create, fetch, update, and delete a VTODO', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `nc-crud-${Date.now()}`;
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

describe('Nextcloud: Multiple VTODOs', () => {
  it('should handle multiple VTODOs in the same calendar', async () => {
    const client = makeClient();
    await client.connect();

    const uids = [
      `nc-multi-1-${Date.now()}`,
      `nc-multi-2-${Date.now()}`,
      `nc-multi-3-${Date.now()}`,
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

describe('Nextcloud: ETag handling (issue #64)', () => {
  it('should update a VTODO without 412 Precondition Failed', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `nc-etag-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'ETag test task'), uid);

    // Fetch to get the etag
    const fetched = await client.fetchVTODOByUID(uid);
    expect(fetched).not.toBeNull();
    expect(fetched!.etag).toBeDefined();

    // Update using the fetched etag — should not get 412
    const updated = buildVTODO(uid, 'ETag test task updated', [
      'DUE;VALUE=DATE:20250901',
    ]);
    await client.updateVTODO(fetched!, updated);

    // Verify the update succeeded
    const refetched = await client.fetchVTODOByUID(uid);
    expect(refetched).not.toBeNull();
    const task = mapper.vtodoToTask(refetched!);
    expect(task.title).toBe('ETag test task updated');
  });

  it('should handle sequential fetch-update cycles without 412', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `nc-etag-seq-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Sequential update v1'), uid);

    // First fetch-update cycle
    const v1 = await client.fetchVTODOByUID(uid);
    expect(v1).not.toBeNull();
    await client.updateVTODO(v1!, buildVTODO(uid, 'Sequential update v2'));

    // Second fetch-update cycle (must re-fetch to get new etag)
    const v2 = await client.fetchVTODOByUID(uid);
    expect(v2).not.toBeNull();
    await client.updateVTODO(v2!, buildVTODO(uid, 'Sequential update v3'));

    // Verify final state
    const v3 = await client.fetchVTODOByUID(uid);
    expect(v3).not.toBeNull();
    const task = mapper.vtodoToTask(v3!);
    expect(task.title).toBe('Sequential update v3');
  });
});
