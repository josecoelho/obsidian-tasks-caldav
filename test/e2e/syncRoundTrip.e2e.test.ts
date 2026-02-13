import { CalDAVClientDirect } from '../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../src/sync/caldavAdapter';
import { ObsidianAdapter } from '../../src/sync/obsidianAdapter';
import { diff } from '../../src/sync/diff';
import { CommonTask } from '../../src/sync/types';
import { FetchHttpClient } from '../helpers/fetchHttpClient';
import { RADICALE, ensureCalendarExists, cleanCalendar } from '../helpers/radicaleSetup';

const httpClient = new FetchHttpClient();
const caldavAdapter = new CalDAVAdapter();
const obsidianAdapter = new ObsidianAdapter();

function makeClient(): CalDAVClientDirect {
  return new CalDAVClientDirect(
    {
      serverUrl: RADICALE.baseUrl,
      username: RADICALE.username,
      password: RADICALE.password,
      calendarName: RADICALE.calendarName,
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
  await ensureCalendarExists();
});

beforeEach(async () => {
  await cleanCalendar();
});

describe('Sync round-trip E2E', () => {
  it('should detect new CalDAV tasks and produce create changes for Obsidian', async () => {
    const client = makeClient();
    await client.connect();

    // Create tasks on CalDAV
    const uid1 = `e2e-sync-1-${Date.now()}`;
    const uid2 = `e2e-sync-2-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid1, 'Task from CalDAV 1', ['PRIORITY:5']), uid1);
    await client.createVTODO(buildVTODO(uid2, 'Task from CalDAV 2', ['DUE;VALUE=DATE:20250715']), uid2);

    // Fetch and normalize CalDAV side
    const vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, new Map());

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
    await caldavAdapter.applyChanges(changeset.toCalDAV, client, new Map());

    // Verify it was created on the server
    const vtodos = await client.fetchVTODOs();
    expect(vtodos.length).toBe(1);

    const tasks = caldavAdapter.normalize(vtodos, new Map());
    expect(tasks[0].title).toBe('Task from Obsidian');
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].dueDate).toBe('2025-08-01');
  });

  it('should detect updates on CalDAV and propagate to Obsidian', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-upd-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original task'), uid);

    // Establish baseline (previous sync)
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, new Map());

    // Simulate CalDAV update (mark completed)
    const updatedVTODO = buildVTODO(uid, 'Original task', [
      'STATUS:COMPLETED',
      'COMPLETED:20250701T120000Z',
      'PERCENT-COMPLETE:100',
    ]);
    await client.updateVTODO(vtodos[0], updatedVTODO);

    // Re-fetch CalDAV
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, new Map());

    // Obsidian still has baseline version
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('update');
    expect(changeset.toObsidian[0].task.status).toBe('DONE');
    expect(changeset.toCalDAV).toHaveLength(0);
  });

  it('should detect deletes on CalDAV and propagate to Obsidian', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-del-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Task to delete'), uid);

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, new Map());

    // Delete on CalDAV
    await client.deleteVTODO(vtodos[0]);

    // Re-fetch: empty
    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, new Map());

    // Obsidian still has the task
    const obsidianTasks = [...baseline];

    const changeset = diff(obsidianTasks, caldavTasks, baseline, 'caldav-wins');

    expect(changeset.toObsidian).toHaveLength(1);
    expect(changeset.toObsidian[0].type).toBe('delete');
    expect(changeset.toObsidian[0].task.uid).toBe(uid);
  });

  it('should handle conflict resolution with caldav-wins', async () => {
    const client = makeClient();
    await client.connect();

    const uid = `e2e-conflict-${Date.now()}`;
    await client.createVTODO(buildVTODO(uid, 'Original task'), uid);

    // Establish baseline
    let vtodos = await client.fetchVTODOs();
    const baseline = caldavAdapter.normalize(vtodos, new Map());

    // CalDAV side: updated description
    const updatedVTODO = buildVTODO(uid, 'CalDAV version');
    await client.updateVTODO(vtodos[0], updatedVTODO);

    vtodos = await client.fetchVTODOs();
    const caldavTasks = caldavAdapter.normalize(vtodos, new Map());

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

  it('should handle markdown generation from CalDAV round-trip', async () => {
    const client = makeClient();
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
    const tasks = caldavAdapter.normalize(vtodos, new Map());
    const task = tasks[0];

    // Generate Obsidian markdown
    const markdown = obsidianAdapter.toMarkdown(task, 'test-id-123', 'sync');

    expect(markdown).toContain('- [ ] Test markdown gen');
    expect(markdown).toContain('🆔 test-id-123');
    expect(markdown).toContain('📅 2025-08-01');
    expect(markdown).toContain('#sync');
  });
});
