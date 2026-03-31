import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../../src/sync/caldavAdapter';
import { diff } from '../../../src/sync/diff';
import { CommonTask } from '../../../src/sync/types';
import { IdMapping } from '../../../src/types';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { NEXTCLOUD, createIsolatedCalendar } from '../../helpers/nextcloudSetup';

jest.setTimeout(60000);

const emptyIdMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

const httpClient = new FetchHttpClient();

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

describe('Nextcloud sync: server-created task duplication', () => {
  it('should not duplicate a server-created task on second sync', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // Task created directly on Nextcloud
    const serverUid = `nc-server-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(serverUid, 'Task created on server', ['DUE;VALUE=DATE:20250801']),
      serverUid,
    );

    // SYNC 1: First sync discovers the server-created task
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    const obsidianTasks1: CommonTask[] = [];
    const baseline1: CommonTask[] = [];

    const changeset1 = diff(obsidianTasks1, caldavTasks1, baseline1, 'caldav-wins');

    expect(changeset1.toObsidian).toHaveLength(1);
    expect(changeset1.toObsidian[0].type).toBe('create');
    expect(changeset1.toObsidian[0].task.title).toBe('Task created on server');

    // Establish post-sync state
    const obsidianTaskId = `obs-${Date.now()}`;
    const idMapping1: IdMapping = {
      taskIdToCaldavUid: { [obsidianTaskId]: serverUid },
      caldavUidToTaskId: { [serverUid]: obsidianTaskId },
    };

    const baselineAfterSync1: CommonTask[] = caldavTasks1.map(t => ({
      ...t,
      uid: idMapping1.caldavUidToTaskId[t.uid] ?? t.uid,
    }));

    const obsidianTasks2: CommonTask[] = baselineAfterSync1.map(t => ({ ...t }));

    // SYNC 2: Nothing changed — should produce no changes
    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping1);

    const changeset2 = diff(obsidianTasks2, caldavTasks2, baselineAfterSync1, 'caldav-wins');

    expect(changeset2.toObsidian).toHaveLength(0);
    expect(changeset2.toCalDAV).toHaveLength(0);
    expect(changeset2.conflicts).toHaveLength(0);
  });
});

describe('Nextcloud sync: ETag regression (issue #64)', () => {
  it('should complete a full fetch-update sync cycle without 412', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // Create a task
    const uid = `nc-etag-sync-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original title'), uid);

    // Fetch current state (simulating first sync)
    const vtodos1 = await client.fetchVTODOs();
    const caldavTasks1 = caldavAdapter.normalize(vtodos1, emptyIdMapping);
    expect(caldavTasks1).toHaveLength(1);

    // Simulate Obsidian modified the task
    const obsTaskId = `obs-etag-${Date.now()}`;
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

    // Second fetch + diff should produce an update to CalDAV
    const vtodos2 = await client.fetchVTODOs();
    const caldavTasks2 = caldavAdapter.normalize(vtodos2, idMapping);

    const changeset = diff(obsidianTasks, caldavTasks2, baseline, 'caldav-wins');
    expect(changeset.toCalDAV).toHaveLength(1);
    expect(changeset.toCalDAV[0].type).toBe('update');

    // Apply the update — this is where 412 would occur with bad ETags
    await caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);

    // Verify the update succeeded
    const vtodos3 = await client.fetchVTODOs();
    expect(vtodos3).toHaveLength(1);
    const finalTask = new (await import('../../../src/caldav/vtodoMapper')).VTODOMapper().vtodoToTask(vtodos3[0]);
    expect(finalTask.title).toBe('Updated from Obsidian');
  });
});
