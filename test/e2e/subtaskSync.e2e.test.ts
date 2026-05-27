import { CalDAVClientDirect } from '../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../src/sync/caldavAdapter';
import { CommonTask } from '../../src/sync/types';
import { IdMapping } from '../../src/types';
import { FetchHttpClient } from '../helpers/fetchHttpClient';
import { RADICALE, createIsolatedCalendar } from '../helpers/radicaleSetup';

const httpClient = new FetchHttpClient();

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
    },
    httpClient,
  );
}

function makeCommonTask(overrides: Partial<CommonTask> & { uid: string; title: string }): CommonTask {
  return {
    status: 'TODO',
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: ['sync'],
    recurrenceRule: '',
    body: '',
    parentUid: null,
    ...overrides,
  };
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

describe('subtask sync (Radicale)', () => {
  it('round-trips RELATED-TO;RELTYPE=PARENT', async () => {
    const client = makeClient();
    const adapter = new CalDAVAdapter(client, 'sync');
    await client.connect();

    const idMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

    const parent = makeCommonTask({ uid: 'p1', title: 'Parent task' });
    const child = makeCommonTask({ uid: 'c1', title: 'Child task', parentUid: 'p1' });

    await adapter.applyChanges(
      [
        { type: 'create', task: parent },
        { type: 'create', task: child },
      ],
      idMapping,
    );

    // Verify raw VTODO contains RELATED-TO;RELTYPE=PARENT:p1
    const vtodos = await client.fetchVTODOs();
    const childVtodo = vtodos.find(v => v.data.includes('UID:c1'));
    expect(childVtodo).toBeDefined();
    expect(childVtodo!.data).toContain('RELATED-TO;RELTYPE=PARENT:p1');

    // Verify round-trip via fetchTasks
    const tasks = await adapter.fetchTasks(idMapping);
    const fetchedChild = tasks.find(t => t.title === 'Child task');
    expect(fetchedChild).toBeDefined();
    expect(fetchedChild!.parentUid).toBe('p1');
  });

  it('re-parent (un-parent) propagates via update', async () => {
    const client = makeClient();
    const adapter = new CalDAVAdapter(client, 'sync');
    await client.connect();

    const idMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

    const parent = makeCommonTask({ uid: 'p1', title: 'Parent task' });
    const child = makeCommonTask({ uid: 'c1', title: 'Child task', parentUid: 'p1' });

    await adapter.applyChanges(
      [
        { type: 'create', task: parent },
        { type: 'create', task: child },
      ],
      idMapping,
    );

    // Remove parent link
    const updatedChild = makeCommonTask({ uid: 'c1', title: 'Child task', parentUid: null });
    await adapter.applyChanges(
      [{ type: 'update', task: updatedChild, previousVersion: child }],
      idMapping,
    );

    // Verify raw VTODO no longer contains RELATED-TO
    const vtodos = await client.fetchVTODOs();
    const childVtodo = vtodos.find(v => v.data.includes('UID:c1'));
    expect(childVtodo).toBeDefined();
    expect(childVtodo!.data).not.toContain('RELATED-TO');

    // Verify fetchTasks returns null parentUid for child
    const tasks = await adapter.fetchTasks(idMapping);
    const fetchedChild = tasks.find(t => t.title === 'Child task');
    expect(fetchedChild).toBeDefined();
    expect(fetchedChild!.parentUid ?? null).toBeNull();
  });

  it('child VTODO with RELATED-TO PARENT round-trips from CalDAV→Obsidian', async () => {
    const client = makeClient();
    const adapter = new CalDAVAdapter(client, 'sync');
    await client.connect();

    const idMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

    // Build raw iCal strings directly with RELATED-TO
    const parentVtodo = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E Test//EN',
      'BEGIN:VTODO',
      'UID:p1',
      'DTSTAMP:20250101T000000Z',
      'SUMMARY:Parent task',
      'STATUS:NEEDS-ACTION',
      'CATEGORIES:sync',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');

    const childVtodo = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E Test//EN',
      'BEGIN:VTODO',
      'UID:c1',
      'DTSTAMP:20250101T000000Z',
      'SUMMARY:Child task',
      'STATUS:NEEDS-ACTION',
      'CATEGORIES:sync',
      'RELATED-TO;RELTYPE=PARENT:p1',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');

    await client.createVTODO(parentVtodo, 'p1');
    await client.createVTODO(childVtodo, 'c1');

    // Fetch and assert parentUid resolved (raw fallback since idMapping is empty)
    const tasks = await adapter.fetchTasks(idMapping);
    const fetchedChild = tasks.find(t => t.title === 'Child task');
    expect(fetchedChild).toBeDefined();
    expect(fetchedChild!.parentUid).toBe('p1');
  });
});
