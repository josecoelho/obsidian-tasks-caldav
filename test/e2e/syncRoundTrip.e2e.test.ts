import { CalDAVClientDirect } from '../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../src/sync/caldavAdapter';
import { ObsidianMapper } from '../../src/tasks/obsidianMapper';
import { diff } from '../../src/sync/diff';
import { applicableChanges } from '../../src/sync/applicableChanges';
import { CommonTask, SyncChange } from '../../src/sync/types';
import { IdMapping } from '../../src/types';
import { FetchHttpClient } from '../helpers/fetchHttpClient';
import { RADICALE, createIsolatedCalendar } from '../helpers/radicaleSetup';

const emptyIdMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

const httpClient = new FetchHttpClient();
const obsidianMapper = new ObsidianMapper();

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
});

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await cleanup();
});

describe('Sync round-trip E2E', () => {
  it('should detect new CalDAV tasks and produce create changes for Obsidian', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // Create tasks on CalDAV
    const uid1 = `e2e-sync-1-${Date.now()}`;
    const uid2 = `e2e-sync-2-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid1, 'Task from CalDAV 1', ['PRIORITY:5']), uid1);
    await client.createVTODO(buildVTODO(uid2, 'Task from CalDAV 2', ['DUE;VALUE=DATE:20250715']), uid2);

    // Fetch and normalize CalDAV side
    const vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Obsidian side: empty (simulating first sync)
    const obsidianTasks: CommonTask[] = [];
    const baseline: CommonTask[] = [];

    // Diff
    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    // Both CalDAV tasks should be created in Obsidian
    expect(changeset.toObsidian).toHaveLength(2);
    expect(changeset.toObsidian.every(c => c.type === 'create')).toBe(true);
    expect(changeset.toCalDAV).toHaveLength(0);
    expect(changeset.conflicts).toHaveLength(0);

    // Verify task details survived the round-trip
    const t1 = changeset.toObsidian.find(c => c.task.title === 'Task from CalDAV 1');
    const t2 = changeset.toObsidian.find(c => c.task.title === 'Task from CalDAV 2');
    expect(t1?.task.priority).toBe('medium');
    expect(t2?.task.dueDate).toBe('2025-07-15');
  });

  it('should detect new Obsidian tasks and push them to CalDAV', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    // Obsidian tasks (simulated)
    const obsidianTasks: CommonTask[] = [
      {
        uid: 'obs-new-1',
        title: 'Task from Obsidian',
        status: 'TODO',
        dueDate: '2025-08-01',
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'high',
        tags: ['sync'],
        recurrenceRule: '',
        body: '',
      },
    ];

    // CalDAV side: empty
    const caldavTasks: CommonTask[] = [];
    const baseline: CommonTask[] = [];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toCalDAV).toHaveLength(1);
    expect(changeset.toCalDAV[0].type).toBe('create');
    expect(changeset.toObsidian).toHaveLength(0);

    // Apply the changes to CalDAV
    await caldavAdapter.applyChanges(changeset.toCalDAV, emptyIdMapping);

    // Verify it was created on the server
    const vtodos = await client.fetchVTODOs();
    expect(vtodos.length).toBe(1);

    const tasks = caldavAdapter.normalize(vtodos, emptyIdMapping);
    expect(tasks[0].title).toBe('Task from Obsidian');
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].dueDate).toBe('2025-08-01');
  });

  it('should detect updates on CalDAV and propagate to Obsidian', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-upd-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original task'), uid);

    // Establish baseline (previous sync)
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Simulate CalDAV update (mark completed)
    const updatedVTODO = buildVTODO(uid, 'Original task', [
      'STATUS:COMPLETED',
      'COMPLETED:20250701T120000Z',
      'PERCENT-COMPLETE:100',
    ]);
    await client.updateVTODO(vtodos[0], updatedVTODO);

    // Re-fetch CalDAV
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Obsidian still has baseline version
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('complete');
    expect(changeset.toObsidian[0].task.status).toBe('DONE');
    expect(changeset.toObsidian[0].task.completedDate).toBe('2025-07-01');
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('should detect deletes on CalDAV and propagate to Obsidian', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-del-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Task to delete'), uid);

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Delete on CalDAV
    await client.deleteVTODO(vtodos[0]);

    // Re-fetch: empty
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Obsidian still has the task
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('delete');
    expect(changeset.toObsidian[0].task.uid).toBe(uid);
  });

  it('should handle conflict resolution with caldav-wins', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-conflict-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original task'), uid);

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // CalDAV side: updated description
    const updatedVTODO = buildVTODO(uid, 'CalDAV version');
    await client.updateVTODO(vtodos[0], updatedVTODO);

    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);

    // Obsidian side: different update
    const obsidianTasks: CommonTask[] = [{
      ...baseline[0],
      title: 'Obsidian version',
    }];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.conflicts).toHaveLength(1);
    // CalDAV wins: update should go to Obsidian
    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].task.title).toBe('CalDAV version');
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('should detect completion of recurring VTODO and emit complete change', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-recur-complete-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(uid, 'Weekly recurring task', [
        'RRULE:FREQ=WEEKLY',
        'DUE;VALUE=DATE:20260217',
      ]),
      uid,
    );

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, emptyIdMapping);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].recurrenceRule).toBe('FREQ=WEEKLY');

    // Mark as completed on CalDAV
    const completedVTODO = buildVTODO(uid, 'Weekly recurring task', [
      'RRULE:FREQ=WEEKLY',
      'DUE;VALUE=DATE:20260217',
      'STATUS:COMPLETED',
      'COMPLETED:20260217T120000Z',
      'PERCENT-COMPLETE:100',
    ]);
    await client.updateVTODO(vtodos[0], completedVTODO);

    // Re-fetch and diff
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('complete');
    expect(changeset.toObsidian[0].task.status).toBe('DONE');
    expect(changeset.toObsidian[0].task.recurrenceRule).toBe('FREQ=WEEKLY');
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('should strip RRULE when applying complete change via CalDAVAdapter', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-recur-strip-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(uid, 'Daily recurring task', [
        'RRULE:FREQ=DAILY',
        'DUE;VALUE=DATE:20260301',
      ]),
      uid,
    );

    // Fetch and normalize
    const vtodos = await client.fetchVTODOs();
    const tasks = caldavAdapter.normalize(vtodos, emptyIdMapping);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrenceRule).toBe('FREQ=DAILY');

    // Apply a 'complete' change via the adapter
    const completeChange: SyncChange = {
      type: 'complete',
      task: {
        ...tasks[0],
        status: 'DONE',
        completedDate: '2026-03-01',
        recurrenceRule: 'FREQ=DAILY',
      },
    };
    const idMapping: IdMapping = {
      taskIdToCaldavUid: { [uid]: uid },
      caldavUidToTaskId: { [uid]: uid },
    };
    await caldavAdapter.applyChanges([completeChange], idMapping);

    // Re-fetch and verify RRULE is stripped, STATUS is COMPLETED
    const updated = await client.fetchVTODOs();
    expect(updated).toHaveLength(1);
    const updatedTasks = caldavAdapter.normalize(updated, emptyIdMapping);
    expect(updatedTasks[0].status).toBe('DONE');
    expect(updatedTasks[0].recurrenceRule).toBe('');
  });

  it('should detect date-bump on recurring VTODO as completion', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-recur-bump-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(uid, 'Weekly bumped task', [
        'RRULE:FREQ=WEEKLY',
        'DUE;VALUE=DATE:20260217',
      ]),
      uid,
    );

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, emptyIdMapping);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].dueDate).toBe('2026-02-17');

    // Bump the due date to next week, keep STATUS:NEEDS-ACTION
    const bumpedVTODO = buildVTODO(uid, 'Weekly bumped task', [
      'RRULE:FREQ=WEEKLY',
      'DUE;VALUE=DATE:20260224',
    ]);
    await client.updateVTODO(vtodos[0], bumpedVTODO);

    // Re-fetch and diff
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, emptyIdMapping);
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('complete');
    expect(changeset.toObsidian[0].task.status).toBe('TODO');
    expect(changeset.toObsidian[0].task.dueDate).toBe('2026-02-24');
    expect(changeset.toObsidian[0].task.recurrenceRule).toBe('FREQ=WEEKLY');
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('pull-only: a divergent Obsidian state never mutates the server', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const keepUid = `e2e-pull-keep-${Date.now()}`;
    const delUid = `e2e-pull-del-${Date.now()}`;
    await client.createVTODO(buildVTODO(keepUid, 'Server task to edit'), keepUid);
    await client.createVTODO(buildVTODO(delUid, 'Server task to delete locally'), delUid);

    // Baseline = what we last pulled.
    const baseline = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);

    // Obsidian diverges: edit one task, delete the other — locally only.
    const obsidianTasks: CommonTask[] = baseline
      .filter(t => t.uid !== delUid)
      .map(t => (t.uid === keepUid ? { ...t, title: 'Locally edited' } : t));

    const caldavTasks = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    // Sanity: bidirectional would push an update and a delete to the server.
    expect(changeset.toCalDAV.some(c => c.type === 'update')).toBe(true);
    expect(changeset.toCalDAV.some(c => c.type === 'delete')).toBe(true);

    // Pull-only strips them, so applying touches nothing on the server.
    const applied = applicableChanges(changeset, 'pull');
    await caldavAdapter.applyChanges(applied.toCalDAV, emptyIdMapping);

    const after = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    expect(after).toHaveLength(2);
    expect(after.find(t => t.uid === keepUid)?.title).toBe('Server task to edit'); // not 'Locally edited'
    expect(after.find(t => t.uid === delUid)).toBeDefined();                       // not deleted
  });

  it('push-only: local changes reach the server; a server-only task is not pulled', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const serverOnlyUid = `e2e-push-srvonly-${Date.now()}`;
    await client.createVTODO(buildVTODO(serverOnlyUid, 'Server-only task'), serverOnlyUid);

    const caldavTasks = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    const baseline: CommonTask[] = [];

    const localUid = `obs-push-${Date.now()}`;
    const obsidianTasks: CommonTask[] = [{
      uid: localUid,
      title: 'Local task to push',
      status: 'TODO',
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none',
      tags: [],
      recurrenceRule: '',
      body: '',
    }];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'obsidian-wins');
    // Sanity: bidirectional would create the server-only task in Obsidian.
    expect(changeset.toObsidian.some(c => c.type === 'create')).toBe(true);

    const applied = applicableChanges(changeset, 'push');
    expect(applied.toObsidian.some(c => c.type === 'create')).toBe(false); // the server-only create is suppressed

    await caldavAdapter.applyChanges(applied.toCalDAV, emptyIdMapping);

    const after = caldavAdapter.normalize(await client.fetchVTODOs(), emptyIdMapping);
    expect(after).toHaveLength(2);                                                 // pushed task + untouched server task, nothing extra
    expect(after.find(t => t.title === 'Local task to push')).toBeDefined();      // push happened
    expect(after.find(t => t.uid === serverOnlyUid)).toBeDefined();               // untouched
  });

  it('should handle markdown generation from CalDAV round-trip', async () => {
    const client = makeClient();
    const caldavAdapter = new CalDAVAdapter(client);
    await client.connect();

    const uid = `e2e-md-${Date.now()}`;
    await client.createVTODO(
      buildVTODO(uid, 'Test markdown gen', [
        'DUE;VALUE=DATE:20250801',
        'PRIORITY:3',
        'CATEGORIES:sync,work',
      ]),
      uid,
    );

    const vtodos = await client.fetchVTODOs();
    const tasks = caldavAdapter.normalize(vtodos, emptyIdMapping);
    const task = tasks[0];

    // Generate Obsidian markdown (mapper uses task.uid for 🆔)
    const taskWithId = { ...task, uid: 'test-id-123' };
    const markdown = obsidianMapper.toMarkdown(taskWithId, 'sync');

    expect(markdown).toContain('- [ ] Test markdown gen');
    expect(markdown).toContain('🆔 test-id-123');
    expect(markdown).toContain('📅 2025-08-01');
    expect(markdown).toContain('#sync');
  });
});
