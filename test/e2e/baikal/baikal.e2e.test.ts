/**
 * Baïkal (SabreDAV) CalDAV E2E tests.
 *
 * Guards issue #71: principal / calendar-home-set discovery against a
 * SabreDAV-based server, plus a full sync adapter cycle. Duplication and
 * ETag edge cases are covered by the Nextcloud/Vikunja suites.
 */
import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../../src/sync/caldavAdapter';
import { diff } from '../../../src/sync/diff';
import { VTODOMapper } from '../../../src/caldav/vtodoMapper';
import { CommonTask } from '../../../src/sync/types';
import { IdMapping } from '../../../src/types';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { BAIKAL, createIsolatedCalendar } from '../../helpers/baikalSetup';

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
      serverUrl: BAIKAL.davUrl,
      username: BAIKAL.username,
      password: BAIKAL.password,
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

describe('Baïkal: principal discovery (issue #71)', () => {
  it('should discover calendar-home-set and connect against SabreDAV', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });
});

describe('Baïkal: VTODO round-trip', () => {
  it('should create/fetch/update/delete a VTODO', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `bk-crud-${Date.now()}`;

    await client.createVTODO(buildVTODO(uid, 'Buy groceries'), uid);
    let todos = await client.fetchVTODOs();
    expect(todos).toHaveLength(1);
    expect(mapper.vtodoToTask(todos[0]).title).toBe('Buy groceries');

    await client.updateVTODO(
      todos[0],
      buildVTODO(uid, 'Buy groceries', ['STATUS:COMPLETED', 'PERCENT-COMPLETE:100']),
    );
    todos = await client.fetchVTODOs();
    expect(mapper.vtodoToTask(todos[0]).status).toBe('DONE');

    await client.deleteVTODO(todos[0]);
    todos = await client.fetchVTODOs();
    expect(todos).toHaveLength(0);
  });
});

describe('Baïkal sync: full adapter cycle', () => {
  it('should complete a fetch-diff-apply cycle', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `bk-sync-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original title'), uid);

    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    expect(caldavTasks1).toHaveLength(1);

    const obsTaskId = `obs-sync-${Date.now()}`;
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { [obsTaskId]: uid },
      caldavUidToTaskId: { [uid]: obsTaskId },
    };
    const baseline: CommonTask[] = caldavTasks1.map(t => ({
      ...t,
      uid: idMapping.caldavUidToTaskId[t.uid] ?? t.uid,
    }));

    const obsidianTasks: CommonTask[] = baseline.map(t => ({
      ...t,
      title: 'Updated from Obsidian',
    }));

    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping);
    const changeset = diff(obsidianTasks, caldavTasks2, baseline, 'caldav-wins');
    expect(changeset.toCalDAV).toHaveLength(1);
    expect(changeset.toCalDAV[0].type).toBe('update');

    await caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);

    const vtodos3 = await client.fetchVTODOs();
    expect(vtodos3).toHaveLength(1);
    expect(mapper.vtodoToTask(vtodos3[0]).title).toBe('Updated from Obsidian');
  });
});
