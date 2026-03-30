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
