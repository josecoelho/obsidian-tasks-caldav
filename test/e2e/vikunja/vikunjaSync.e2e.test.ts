import { CalDAVClientDirect } from '../../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../../src/sync/caldavAdapter';
import { diff } from '../../../src/sync/diff';
import { CommonTask } from '../../../src/sync/types';
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
