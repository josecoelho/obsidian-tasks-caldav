import { VTODOMapper, ObsidianTask, CalendarObject } from './vtodoMapper';

describe('VTODOMapper', () => {
  let mapper: VTODOMapper;

  beforeEach(() => {
    mapper = new VTODOMapper();
  });

  describe('taskToVTODO', () => {
    it('should convert basic task to VTODO format', () => {
      const task: ObsidianTask = {
        description: 'Test task',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid-123');

      expect(vtodo).toContain('BEGIN:VCALENDAR');
      expect(vtodo).toContain('BEGIN:VTODO');
      expect(vtodo).toContain('UID:test-uid-123');
      expect(vtodo).toContain('SUMMARY:Test task');
      expect(vtodo).toContain('STATUS:NEEDS-ACTION');
      expect(vtodo).toContain('PRIORITY:0');
      expect(vtodo).toContain('END:VTODO');
      expect(vtodo).toContain('END:VCALENDAR');
    });

    it('should include due date when present', () => {
      const task: ObsidianTask = {
        description: 'Task with due date',
        status: 'TODO',
        dueDate: '2025-01-15',
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('DUE;VALUE=DATE:20250115');
    });

    it('should include start date from scheduledDate', () => {
      const task: ObsidianTask = {
        description: 'Task with scheduled date',
        status: 'TODO',
        dueDate: null,
        scheduledDate: '2025-01-10',
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('DTSTART;VALUE=DATE:20250110');
    });

    it('should map all status values correctly', () => {
      const statuses = [
        { obsidian: 'TODO', vtodo: 'NEEDS-ACTION' },
        { obsidian: 'IN_PROGRESS', vtodo: 'IN-PROCESS' },
        { obsidian: 'DONE', vtodo: 'COMPLETED' },
        { obsidian: 'CANCELLED', vtodo: 'CANCELLED' }
      ];

      statuses.forEach(({ obsidian, vtodo }) => {
        const task: ObsidianTask = {
          description: 'Task',
          status: obsidian,
          dueDate: null,
          scheduledDate: null,
          startDate: null,
          completedDate: null,
          priority: 'none',
          recurrenceRule: '',
          tags: []
        };

        const result = mapper.taskToVTODO(task, 'test-uid');
        expect(result).toContain(`STATUS:${vtodo}`);
      });
    });

    it('should map all priority values correctly', () => {
      const priorities = [
        { obsidian: 'highest', vtodo: 1 },
        { obsidian: 'high', vtodo: 3 },
        { obsidian: 'medium', vtodo: 5 },
        { obsidian: 'low', vtodo: 7 },
        { obsidian: 'lowest', vtodo: 9 },
        { obsidian: 'none', vtodo: 0 }
      ];

      priorities.forEach(({ obsidian, vtodo }) => {
        const task: ObsidianTask = {
          description: 'Task',
          status: 'TODO',
          dueDate: null,
          scheduledDate: null,
          startDate: null,
          completedDate: null,
          priority: obsidian,
          recurrenceRule: '',
          tags: []
        };

        const result = mapper.taskToVTODO(task, 'test-uid');
        expect(result).toContain(`PRIORITY:${vtodo}`);
      });
    });

    it('should include completed date and percent for completed tasks', () => {
      const task: ObsidianTask = {
        description: 'Completed task',
        status: 'DONE',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: '2025-01-05T10:30:00Z',
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('COMPLETED:20250105T103000Z');
      expect(vtodo).toContain('PERCENT-COMPLETE:100');
    });

    it('should include tags as categories', () => {
      const task: ObsidianTask = {
        description: 'Task with tags',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: ['work', 'urgent', 'project-a']
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('CATEGORIES:work,urgent,project-a');
    });

    it('should escape special characters in summary', () => {
      const task: ObsidianTask = {
        description: 'Task with; comma, backslash\\ and newline\n',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('SUMMARY:Task with\\; comma\\, backslash\\\\ and newline\\n');
    });

    it('should include recurrence rule when present', () => {
      const task: ObsidianTask = {
        description: 'Recurring task',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: 'FREQ=DAILY;COUNT=10',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      expect(vtodo).toContain('RRULE:FREQ=DAILY;COUNT=10');
    });
  });

  describe('vtodoToTask', () => {
    it('should convert basic VTODO to task', () => {
      const vtodoData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VTODO
UID:test-uid-123
DTSTAMP:20250105T120000Z
SUMMARY:Test task
STATUS:NEEDS-ACTION
PRIORITY:0
END:VTODO
END:VCALENDAR`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.description).toBe('Test task');
      expect(task.status).toBe('TODO');
      expect(task.priority).toBe('none');
      expect(task.dueDate).toBeNull();
      expect(task.completedDate).toBeNull();
    });

    it('should parse due date', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
DUE;VALUE=DATE:20250115
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.dueDate).toBe('2025-01-15');
    });

    it('should parse start date', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
DTSTART;VALUE=DATE:20250110
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.scheduledDate).toBe('2025-01-10');
    });

    it('should map all VTODO statuses correctly', () => {
      const statuses = [
        { vtodo: 'NEEDS-ACTION', obsidian: 'TODO' },
        { vtodo: 'IN-PROCESS', obsidian: 'IN_PROGRESS' },
        { vtodo: 'COMPLETED', obsidian: 'DONE' },
        { vtodo: 'CANCELLED', obsidian: 'CANCELLED' }
      ];

      statuses.forEach(({ vtodo: vtodoStatus, obsidian }) => {
        const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
STATUS:${vtodoStatus}
END:VTODO`;

        const vtodo: CalendarObject = {
          data: vtodoData,
          etag: 'test-etag',
          url: 'http://example.com/test.ics'
        };

        const task = mapper.vtodoToTask(vtodo);
        expect(task.status).toBe(obsidian);
      });
    });

    it('should map all VTODO priorities correctly', () => {
      const priorities = [
        { vtodo: '0', obsidian: 'none' },
        { vtodo: '1', obsidian: 'highest' },
        { vtodo: '3', obsidian: 'high' },
        { vtodo: '5', obsidian: 'medium' },
        { vtodo: '7', obsidian: 'low' },
        { vtodo: '9', obsidian: 'lowest' }
      ];

      priorities.forEach(({ vtodo: vtodoPriority, obsidian }) => {
        const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
PRIORITY:${vtodoPriority}
STATUS:NEEDS-ACTION
END:VTODO`;

        const vtodo: CalendarObject = {
          data: vtodoData,
          etag: 'test-etag',
          url: 'http://example.com/test.ics'
        };

        const task = mapper.vtodoToTask(vtodo);
        expect(task.priority).toBe(obsidian);
      });
    });

    it('should parse completed date', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
STATUS:COMPLETED
COMPLETED:20250105T103000Z
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.completedDate).toBe('2025-01-05T10:30:00Z');
    });

    it('should parse categories as tags', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
CATEGORIES:work,urgent,project-a
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.tags).toEqual(['work', 'urgent', 'project-a']);
    });

    it('should parse recurrence rule', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
RRULE:FREQ=DAILY;COUNT=10
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.recurrenceRule).toBe('FREQ=DAILY;COUNT=10');
    });

    it('should use default title when SUMMARY missing', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      expect(task.description).toBe('Untitled Task');
    });
  });

  describe('extractUID', () => {
    it('should extract UID from VTODO data', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid-12345
SUMMARY:Task
END:VTODO`;

      const uid = mapper.extractUID(vtodoData);

      expect(uid).toBe('test-uid-12345');
    });

    it('should return empty string when UID not found', () => {
      const vtodoData = `BEGIN:VTODO
SUMMARY:Task
END:VTODO`;

      const uid = mapper.extractUID(vtodoData);

      expect(uid).toBe('');
    });

    it('should handle UID with special characters', () => {
      const vtodoData = `BEGIN:VTODO
UID:test-uid-2025@example.com
SUMMARY:Task
END:VTODO`;

      const uid = mapper.extractUID(vtodoData);

      expect(uid).toBe('test-uid-2025@example.com');
    });
  });
});
