import { CalDAVClientDirect } from '../../src/caldav/calDAVClientDirect';
import { CalDAVAdapter } from '../../src/sync/caldavAdapter';
import { CommonTask } from '../../src/sync/types';
import { FetchHttpClient } from '../helpers/fetchHttpClient';
import { RADICALE, ensureCalendarExists, cleanCalendar } from '../helpers/radicaleSetup';

const httpClient = new FetchHttpClient();

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

describe('CalDAVAdapter E2E', () => {
  const adapter = new CalDAVAdapter();

  describe('normalize round-trip', () => {
    it('should normalize VTODOs from a real server into CommonTasks', async () => {
      const client = makeClient();
      await client.connect();

      const uid = `e2e-adapt-${Date.now()}`;
      const vtodo = buildVTODO(uid, 'Buy milk', [
        'DUE;VALUE=DATE:20250615',
        'PRIORITY:3',
        'CATEGORIES:sync,groceries',
      ]);

      await client.createVTODO(vtodo, uid);

      const vtodos = await client.fetchVTODOs();
      const tasks = adapter.normalize(vtodos, new Map());

      expect(tasks).toHaveLength(1);
      expect(tasks[0].uid).toBe(uid);
      expect(tasks[0].description).toBe('Buy milk');
      expect(tasks[0].status).toBe('TODO');
      expect(tasks[0].dueDate).toBe('2025-06-15');
      expect(tasks[0].priority).toBe('high');
      expect(tasks[0].tags).toEqual(['sync', 'groceries']);
    });

    it('should use mapped obsidian ID when available', async () => {
      const client = makeClient();
      await client.connect();

      const uid = `e2e-mapped-${Date.now()}`;
      await client.createVTODO(buildVTODO(uid, 'Mapped task'), uid);

      const vtodos = await client.fetchVTODOs();
      const mapping = new Map([[uid, 'obsidian-task-id-123']]);
      const tasks = adapter.normalize(vtodos, mapping);

      expect(tasks[0].uid).toBe('obsidian-task-id-123');
    });
  });

  describe('fromCommonTask round-trip', () => {
    it('should create a VTODO from CommonTask and read it back', async () => {
      const client = makeClient();
      await client.connect();

      const task: CommonTask = {
        uid: 'round-trip-id',
        description: 'Round trip test',
        status: 'TODO',
        dueDate: '2025-07-01',
        startDate: null,
        scheduledDate: '2025-06-28',
        completedDate: null,
        priority: 'high',
        tags: ['sync', 'test'],
        recurrenceRule: '',
      };

      const caldavUID = `e2e-roundtrip-${Date.now()}`;
      const vtodoData = adapter.fromCommonTask(task, caldavUID);
      await client.createVTODO(vtodoData, caldavUID);

      // Fetch back and normalize
      const vtodos = await client.fetchVTODOs();
      const tasks = adapter.normalize(vtodos, new Map());

      expect(tasks).toHaveLength(1);
      expect(tasks[0].description).toBe('Round trip test');
      expect(tasks[0].status).toBe('TODO');
      expect(tasks[0].dueDate).toBe('2025-07-01');
      expect(tasks[0].scheduledDate).toBe('2025-06-28');
      expect(tasks[0].priority).toBe('high');
      expect(tasks[0].tags).toEqual(['sync', 'test']);
    });

    it('should round-trip a completed task', async () => {
      const client = makeClient();
      await client.connect();

      const task: CommonTask = {
        uid: 'done-id',
        description: 'Completed task',
        status: 'DONE',
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: '2025-06-10',
        priority: 'none',
        tags: [],
        recurrenceRule: '',
      };

      const caldavUID = `e2e-done-${Date.now()}`;
      const vtodoData = adapter.fromCommonTask(task, caldavUID);
      await client.createVTODO(vtodoData, caldavUID);

      const vtodos = await client.fetchVTODOs();
      const tasks = adapter.normalize(vtodos, new Map());

      expect(tasks[0].status).toBe('DONE');
      expect(tasks[0].completedDate).toBe('2025-06-10');
    });
  });

  describe('applyChanges', () => {
    it('should create, update, and delete VTODOs', async () => {
      const client = makeClient();
      await client.connect();

      // Create a task to later update and delete
      const existingUID = `e2e-existing-${Date.now()}`;
      await client.createVTODO(buildVTODO(existingUID, 'Existing task'), existingUID);

      const toDeleteUID = `e2e-delete-${Date.now()}`;
      await client.createVTODO(buildVTODO(toDeleteUID, 'To delete'), toDeleteUID);

      let vtodos = await client.fetchVTODOs();
      expect(vtodos.length).toBe(2);

      const uidMapping = new Map([
        [existingUID, 'obs-existing'],
        [toDeleteUID, 'obs-delete'],
      ]);

      // Apply: create new + update existing + delete one
      const newTask: CommonTask = {
        uid: 'obs-new',
        description: 'Brand new task',
        status: 'TODO',
        dueDate: '2025-08-01',
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'medium',
        tags: ['sync'],
        recurrenceRule: '',
      };

      const updatedTask: CommonTask = {
        uid: 'obs-existing',
        description: 'Updated existing task',
        status: 'DONE',
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: '2025-07-15',
        priority: 'none',
        tags: [],
        recurrenceRule: '',
      };

      const deletedTask: CommonTask = {
        uid: 'obs-delete',
        description: 'To delete',
        status: 'TODO',
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none',
        tags: [],
        recurrenceRule: '',
      };

      await adapter.applyChanges(
        [
          { type: 'create', task: newTask },
          { type: 'update', task: updatedTask },
          { type: 'delete', task: deletedTask },
        ],
        client,
        uidMapping,
      );

      // Verify final state
      vtodos = await client.fetchVTODOs();
      expect(vtodos.length).toBe(2); // 2 original - 1 deleted + 1 created = 2

      const tasks = adapter.normalize(vtodos, new Map());
      const descriptions = tasks.map(t => t.description).sort();
      expect(descriptions).toEqual(['Brand new task', 'Updated existing task']);

      const updated = tasks.find(t => t.description === 'Updated existing task');
      expect(updated?.status).toBe('DONE');
    });
  });
});
