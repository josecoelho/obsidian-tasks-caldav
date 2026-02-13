import { CalDAVClientDirect } from '../../src/caldav/calDAVClientDirect';
import { VTODOMapper } from '../../src/caldav/vtodoMapper';
import { FetchHttpClient } from '../helpers/fetchHttpClient';
import { RADICALE, createIsolatedCalendar } from '../helpers/radicaleSetup';

const httpClient = new FetchHttpClient();
const mapper = new VTODOMapper();

let calendarName: string;
let clean: () => Promise<void>;
let cleanup: () => Promise<void>;

function makeClient(): CalDAVClientDirect {
  return new CalDAVClientDirect(
    {
      serverUrl: RADICALE.baseUrl,
      username: RADICALE.username,
      password: RADICALE.password,
      calendarName,
      syncTag: '',
      syncInterval: 5,
      newTasksDestination: 'Inbox.md',
      requireManualConflictResolution: false,
      autoResolveObsidianWins: false,
      syncCompletedTasks: false,
      deleteBehavior: 'ask',
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
    `DTSTAMP:20250101T000000Z`,
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
});

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await cleanup();
});

describe('Calendar discovery', () => {
  it('should connect and find the test calendar', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  it('should fail when calendar name does not exist', async () => {
    const client = new CalDAVClientDirect(
      {
        serverUrl: RADICALE.baseUrl,
        username: RADICALE.username,
        password: RADICALE.password,
        calendarName: 'nonexistent-calendar',
        syncTag: '',
        syncInterval: 5,
        newTasksDestination: 'Inbox.md',
        requireManualConflictResolution: false,
        autoResolveObsidianWins: false,
        syncCompletedTasks: false,
        deleteBehavior: 'ask',
      },
      httpClient,
    );
    await expect(client.connect()).rejects.toThrow(/not found/i);
  });
});

describe('VTODO CRUD round-trip', () => {
  it('should create, fetch, update, and delete a VTODO', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-crud-${Date.now()}`;
    const vtodo = buildVTODO(uid, 'Buy groceries');

    // Create
    await client.createVTODO(vtodo, uid);

    // Fetch — should find exactly one
    let todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);

    const fetched = todos[0];
    const task = mapper.vtodoToTask(fetched);
    expect(task.description).toBe('Buy groceries');
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

describe('VTODO with folded lines', () => {
  it('should handle a long summary that the server may fold', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-fold-${Date.now()}`;
    const longSummary =
      'This is a very long task description that exceeds seventy-five octets and should be folded by the server according to RFC 5545 line folding rules';

    const vtodo = buildVTODO(uid, longSummary);
    await client.createVTODO(vtodo, uid);

    const todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);
    const task = mapper.vtodoToTask(todos[0]);
    expect(task.description).toBe(longSummary);
  });
});

describe('VTODO with VTIMEZONE and TZID dates', () => {
  it('should round-trip a VTODO that uses TZID parameters', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-tz-${Date.now()}`;
    const vtodoData = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E Test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'TZNAME:EDT',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VTODO',
      `UID:${uid}`,
      'DTSTAMP:20250601T100000Z',
      'SUMMARY:Meeting prep',
      'STATUS:NEEDS-ACTION',
      'DTSTART;TZID=America/New_York:20250615T090000',
      'DUE;TZID=America/New_York:20250615T170000',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');

    await client.createVTODO(vtodoData, uid);

    const todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);

    const task = mapper.vtodoToTask(todos[0]);
    expect(task.description).toBe('Meeting prep');
    expect(task.dueDate).toBe('2025-06-15');
    expect(task.startDate).toBe('2025-06-15');
  });
});

describe('VTODO with recurrence', () => {
  it('should preserve RRULE through a round-trip', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-rrule-${Date.now()}`;
    const vtodo = buildVTODO(uid, 'Daily standup', [
      'RRULE:FREQ=DAILY;COUNT=30',
      'DUE;VALUE=DATE:20250701',
    ]);

    await client.createVTODO(vtodo, uid);

    const todos = await client.fetchVTODOs();
    expect(todos.length).toBe(1);

    const task = mapper.vtodoToTask(todos[0]);
    expect(task.description).toBe('Daily standup');
    expect(task.recurrenceRule).toBe('FREQ=DAILY;COUNT=30');
    expect(task.dueDate).toBe('2025-07-01');
  });
});

describe('Multiple VTODOs', () => {
  it('should handle multiple VTODOs in the same calendar', async () => {
    const client = makeClient();
    await client.connect();

    const uids = [
      `e2e-multi-1-${Date.now()}`,
      `e2e-multi-2-${Date.now()}`,
      `e2e-multi-3-${Date.now()}`,
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
