import { CalDAVAdapter } from './caldavAdapter';
import { CalendarObject } from '../caldav/vtodoMapper';
import { CalDAVClient } from '../caldav/calDAVClientDirect';
import { IdMapping } from '../types';

const emptyIdMapping: IdMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };

function buildVTODO(uid: string, summary: string, extra: string[] = []): string {
  const hasStatus = extra.some(l => l.startsWith('STATUS:'));
  const hasPriority = extra.some(l => l.startsWith('PRIORITY:'));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20250101T000000Z',
    `SUMMARY:${summary}`,
    ...(hasStatus ? [] : ['STATUS:NEEDS-ACTION']),
    ...(hasPriority ? [] : ['PRIORITY:0']),
    ...extra,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
}

function makeCalObj(uid: string, summary: string, extra: string[] = []): CalendarObject {
  return {
    data: buildVTODO(uid, summary, extra),
    url: `http://example.com/${uid}.ics`,
    etag: `etag-${uid}`,
  };
}

const dummyClient: CalDAVClient = {
  connect: jest.fn(),
  fetchVTODOs: jest.fn(),
  createVTODO: jest.fn(),
  updateVTODO: jest.fn(),
  deleteVTODOByUID: jest.fn(),
  fetchVTODOByUID: jest.fn(),
};

describe('CalDAVAdapter', () => {
  const adapter = new CalDAVAdapter(dummyClient);

  describe('toCommonTask', () => {
    it('should convert a basic VTODO to CommonTask', () => {
      const vtodo = makeCalObj('caldav-001', 'Buy groceries');
      const task = adapter.toCommonTask(vtodo, 'my-task-id');

      expect(task.uid).toBe('my-task-id');
      expect(task.title).toBe('Buy groceries');
      expect(task.status).toBe('TODO');
      expect(task.priority).toBe('none');
      expect(task.dueDate).toBeNull();
      expect(task.startDate).toBeNull();
      expect(task.scheduledDate).toBeNull();
      expect(task.completedDate).toBeNull();
      expect(task.tags).toEqual([]);
      expect(task.recurrenceRule).toBe('');
      expect(task.body).toBe('');
    });

    it('should extract notes from DESCRIPTION', () => {
      const vtodo = makeCalObj('caldav-notes', 'Task with notes', ['DESCRIPTION:Remember to check']);
      const task = adapter.toCommonTask(vtodo, 'my-id');
      expect(task.body).toBe('Remember to check');
    });

    it('should map VTODO status correctly', () => {
      const done = makeCalObj('c-done', 'Done task', ['STATUS:COMPLETED']);
      expect(adapter.toCommonTask(done, 'id').status).toBe('DONE');

      const inProgress = makeCalObj('c-ip', 'In progress', ['STATUS:IN-PROCESS']);
      expect(adapter.toCommonTask(inProgress, 'id').status).toBe('IN_PROGRESS');

      const cancelled = makeCalObj('c-can', 'Cancelled', ['STATUS:CANCELLED']);
      expect(adapter.toCommonTask(cancelled, 'id').status).toBe('CANCELLED');
    });

    it('should extract dates', () => {
      const vtodo = makeCalObj('c-dates', 'Task with dates', [
        'DUE;VALUE=DATE:20250115',
        'DTSTART;VALUE=DATE:20250110',
        'COMPLETED:20250112T140000Z',
      ]);

      const task = adapter.toCommonTask(vtodo, 'id');
      expect(task.dueDate).toBe('2025-01-15');
      expect(task.startDate).toBe('2025-01-10');
      expect(task.completedDate).toBe('2025-01-12');
    });

    it('should extract tags from CATEGORIES', () => {
      const vtodo = makeCalObj('c-tags', 'Tagged task', ['CATEGORIES:sync,work,urgent']);
      const task = adapter.toCommonTask(vtodo, 'id');
      expect(task.tags).toEqual(['sync', 'work', 'urgent']);
    });

    it('should extract priority', () => {
      const high = makeCalObj('c-hi', 'High', ['PRIORITY:1']);
      expect(adapter.toCommonTask(high, 'id').priority).toBe('highest');

      const med = makeCalObj('c-med', 'Med', ['PRIORITY:5']);
      expect(adapter.toCommonTask(med, 'id').priority).toBe('medium');

      const low = makeCalObj('c-lo', 'Low', ['PRIORITY:9']);
      expect(adapter.toCommonTask(low, 'id').priority).toBe('lowest');
    });

    it('should extract recurrence rule', () => {
      const vtodo = makeCalObj('c-rrule', 'Recurring', ['RRULE:FREQ=DAILY;COUNT=30']);
      const task = adapter.toCommonTask(vtodo, 'id');
      expect(task.recurrenceRule).toBe('FREQ=DAILY;COUNT=30');
    });
  });

  describe('normalize', () => {
    it('should use obsidian task ID from IdMapping when available', () => {
      const vtodos = [
        makeCalObj('caldav-aaa', 'Mapped task'),
        makeCalObj('caldav-bbb', 'Unmapped task'),
      ];

      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'obsidian-id-123': 'caldav-aaa' },
        caldavUidToTaskId: { 'caldav-aaa': 'obsidian-id-123' },
      };
      const tasks = adapter.normalize(vtodos, idMapping);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].uid).toBe('obsidian-id-123');
      expect(tasks[0].title).toBe('Mapped task');
      expect(tasks[1].uid).toBe('caldav-bbb');
      expect(tasks[1].title).toBe('Unmapped task');
    });

    it('should skip VTODOs without UIDs', () => {
      const vtodos: CalendarObject[] = [{
        data: 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nSUMMARY:No UID\r\nEND:VTODO\r\nEND:VCALENDAR',
        url: 'http://example.com/bad.ics',
      }];

      const tasks = adapter.normalize(vtodos, emptyIdMapping);
      expect(tasks).toHaveLength(0);
    });

    it('should handle empty list', () => {
      const tasks = adapter.normalize([], emptyIdMapping);
      expect(tasks).toEqual([]);
    });
  });

  describe('fromCommonTask', () => {
    it('should convert CommonTask to VTODO string', () => {
      const task = {
        uid: 'my-id',
        title: 'Test task',
        status: 'TODO' as const,
        dueDate: '2025-01-15',
        startDate: null,
        scheduledDate: '2025-01-10',
        completedDate: null,
        priority: 'high' as const,
        tags: ['sync', 'work'],
        recurrenceRule: '',
        body: '',
      };

      const vtodo = adapter.fromCommonTask(task, 'caldav-uid-001');

      expect(vtodo).toContain('UID:caldav-uid-001');
      expect(vtodo).toContain('SUMMARY:Test task');
      expect(vtodo).toContain('STATUS:NEEDS-ACTION');
      expect(vtodo).toContain('DUE;VALUE=DATE:20250115');
      expect(vtodo).toContain('DTSTART;VALUE=DATE:20250110');
      expect(vtodo).toContain('PRIORITY:3');
      expect(vtodo).toContain('CATEGORIES:sync,work');
    });

    it('should include DESCRIPTION when notes is non-empty', () => {
      const task = {
        uid: 'notes-id',
        title: 'Task with notes',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: 'Remember to bring supplies',
      };

      const vtodo = adapter.fromCommonTask(task, 'caldav-notes');
      expect(vtodo).toContain('DESCRIPTION:Remember to bring supplies');
    });

    it('should omit DESCRIPTION when notes is empty', () => {
      const task = {
        uid: 'no-notes',
        title: 'Task without notes',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const vtodo = adapter.fromCommonTask(task, 'caldav-no-notes');
      expect(vtodo).not.toContain('DESCRIPTION');
    });

    it('should handle completed tasks', () => {
      const task = {
        uid: 'done-id',
        title: 'Done task',
        status: 'DONE' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: '2025-01-12',
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const vtodo = adapter.fromCommonTask(task, 'caldav-done');

      expect(vtodo).toContain('STATUS:COMPLETED');
      expect(vtodo).toContain('COMPLETED:');
      expect(vtodo).toContain('PERCENT-COMPLETE:100');
    });
  });

  describe('applyChanges', () => {
    it('should call create for create changes', async () => {
      const mockCreateVTODO = jest.fn();
      const mockClient: CalDAVClient = {
        connect: jest.fn(),
        fetchVTODOs: jest.fn(),
        createVTODO: mockCreateVTODO,
        updateVTODO: jest.fn(),
        deleteVTODOByUID: jest.fn(),
        fetchVTODOByUID: jest.fn(),
      };
      const testAdapter = new CalDAVAdapter(mockClient);

      const task = {
        uid: 'new-task',
        title: 'New task',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      await testAdapter.applyChanges(
        [{ type: 'create', task }],
        emptyIdMapping,
      );

      expect(mockCreateVTODO).toHaveBeenCalledTimes(1);
      expect((mockCreateVTODO.mock.calls[0] as [string, string])[1]).toBe('obsidian-new-task');
    });

    it('should call delete for delete changes', async () => {
      const mockDeleteVTODOByUID = jest.fn();
      const mockClient: CalDAVClient = {
        connect: jest.fn(),
        fetchVTODOs: jest.fn(),
        createVTODO: jest.fn(),
        updateVTODO: jest.fn(),
        deleteVTODOByUID: mockDeleteVTODOByUID,
        fetchVTODOByUID: jest.fn(),
      };
      const testAdapter = new CalDAVAdapter(mockClient);

      const task = {
        uid: 'del-task',
        title: 'To delete',
        status: 'TODO' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: null,
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'del-task': 'caldav-del' },
        caldavUidToTaskId: { 'caldav-del': 'del-task' },
      };
      await testAdapter.applyChanges(
        [{ type: 'delete', task }],
        idMapping,
      );

      expect(mockDeleteVTODOByUID).toHaveBeenCalledWith('caldav-del');
    });

    it('should call update for update changes', async () => {
      const mockFetchVTODOByUID = jest.fn().mockResolvedValue({
        data: 'old vtodo data',
        url: 'http://example.com/task.ics',
        etag: 'old-etag',
      });
      const mockUpdateVTODO = jest.fn();
      const mockClient: CalDAVClient = {
        connect: jest.fn(),
        fetchVTODOs: jest.fn(),
        createVTODO: jest.fn(),
        updateVTODO: mockUpdateVTODO,
        deleteVTODOByUID: jest.fn(),
        fetchVTODOByUID: mockFetchVTODOByUID,
      };
      const testAdapter = new CalDAVAdapter(mockClient);

      const task = {
        uid: 'upd-task',
        title: 'Updated task',
        status: 'DONE' as const,
        dueDate: null,
        startDate: null,
        scheduledDate: null,
        completedDate: '2025-01-12',
        priority: 'none' as const,
        tags: [],
        recurrenceRule: '',
        body: '',
      };

      const idMapping: IdMapping = {
        taskIdToCaldavUid: { 'upd-task': 'caldav-upd' },
        caldavUidToTaskId: { 'caldav-upd': 'upd-task' },
      };
      await testAdapter.applyChanges(
        [{ type: 'update', task }],
        idMapping,
      );

      expect(mockFetchVTODOByUID).toHaveBeenCalledWith('caldav-upd');
      expect(mockUpdateVTODO).toHaveBeenCalledTimes(1);
    });
  });
});
