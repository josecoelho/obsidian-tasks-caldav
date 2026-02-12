import { VTODOMapper, ObsidianTask, CalendarObject } from './vtodoMapper';

describe('VTODOMapper - pure functions for VTODO<->Task conversion', () => {
  let mapper: VTODOMapper;

  beforeEach(() => {
    mapper = new VTODOMapper();
  });

  describe('taskToVTODO', () => {
    it('should generate valid iCalendar VTODO with required fields', () => {
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

      expect(vtodo).toMatch(/^BEGIN:VCALENDAR\r?\n/);
      expect(vtodo).toMatch(/\r?\nEND:VCALENDAR$/);
      expect(vtodo).toContain('UID:test-uid-123');
      expect(vtodo).toContain('SUMMARY:Test task');
      expect(vtodo).toContain('STATUS:NEEDS-ACTION');
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

  describe('Special character escaping/unescaping', () => {
    it('should escape and unescape commas in task description', () => {
      const task: ObsidianTask = {
        description: 'Buy bread, milk, eggs',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      // Escape: task to VTODO
      const vtodo = mapper.taskToVTODO(task, 'test-uid');
      expect(vtodo).toContain('SUMMARY:Buy bread\\, milk\\, eggs');

      // Unescape: VTODO back to task
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Buy bread\\, milk\\, eggs
STATUS:NEEDS-ACTION
END:VTODO`;

      const calendarObject: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const parsedTask = mapper.vtodoToTask(calendarObject);
      expect(parsedTask.description).toBe('Buy bread, milk, eggs');
    });

    it('should handle multiple special characters', () => {
      const task: ObsidianTask = {
        description: 'Task with; comma, and\\ backslash',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      // Round-trip: task → VTODO → task
      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      const calendarObject: CalendarObject = {
        data: vtodo,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const parsedTask = mapper.vtodoToTask(calendarObject);
      expect(parsedTask.description).toBe('Task with; comma, and\\ backslash');
    });

    it('should prevent double-escaping on multiple syncs', () => {
      const originalDescription = 'Buy bread, milk, eggs';

      const task: ObsidianTask = {
        description: originalDescription,
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      // First sync: task → VTODO → task
      const vtodo1 = mapper.taskToVTODO(task, 'test-uid');
      const calObject1: CalendarObject = { data: vtodo1, etag: 'e1', url: 'http://test' };
      const task1 = mapper.vtodoToTask(calObject1);

      // Second sync: should produce same result
      const vtodo2 = mapper.taskToVTODO(task1, 'test-uid');
      const calObject2: CalendarObject = { data: vtodo2, etag: 'e2', url: 'http://test' };
      const task2 = mapper.vtodoToTask(calObject2);

      // Third sync: should still be the same
      const vtodo3 = mapper.taskToVTODO(task2, 'test-uid');
      const calObject3: CalendarObject = { data: vtodo3, etag: 'e3', url: 'http://test' };
      const task3 = mapper.vtodoToTask(calObject3);

      expect(task1.description).toBe(originalDescription);
      expect(task2.description).toBe(originalDescription);
      expect(task3.description).toBe(originalDescription);
    });

    it('should escape and unescape tags with commas', () => {
      const task: ObsidianTask = {
        description: 'Task',
        status: 'TODO',
        dueDate: null,
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: ['home,work', 'urgent']
      };

      // Escape: task to VTODO
      const vtodo = mapper.taskToVTODO(task, 'test-uid');
      expect(vtodo).toContain('CATEGORIES:home\\,work,urgent');

      // Unescape: VTODO back to task
      const vtodoData = `BEGIN:VTODO
UID:test-uid
SUMMARY:Task
STATUS:NEEDS-ACTION
CATEGORIES:home\\,work,urgent
END:VTODO`;

      const calendarObject: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const parsedTask = mapper.vtodoToTask(calendarObject);
      expect(parsedTask.tags).toEqual(['home,work', 'urgent']);
    });
  });

  describe('Date timezone handling', () => {
    it('should preserve date-only strings without timezone conversion', () => {
      // When we have a date string like "2026-02-11", it should remain "2026-02-11"
      // regardless of the local timezone
      const task: ObsidianTask = {
        description: 'Task with date',
        status: 'TODO',
        dueDate: '2026-02-11',
        scheduledDate: '2026-02-10',
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      const vtodo = mapper.taskToVTODO(task, 'test-uid');

      // Should format as YYYYMMDD without timezone shifting
      expect(vtodo).toContain('DUE;VALUE=DATE:20260211');
      expect(vtodo).toContain('DTSTART;VALUE=DATE:20260210');
    });

    it('should round-trip dates without changing them', () => {
      // Create a task with a specific date
      const originalTask: ObsidianTask = {
        description: 'Round-trip test',
        status: 'TODO',
        dueDate: '2026-02-11',
        scheduledDate: '2026-02-10',
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      // Convert to VTODO and back
      const vtodoData = mapper.taskToVTODO(originalTask, 'test-uid');
      const calendarObject: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };
      const roundTrippedTask = mapper.vtodoToTask(calendarObject);

      // Dates should be identical after round-trip
      expect(roundTrippedTask.dueDate).toBe('2026-02-11');
      expect(roundTrippedTask.scheduledDate).toBe('2026-02-10');
    });

    it('should handle dates consistently across multiple syncs', () => {
      // Simulate 3 sync cycles
      let task: ObsidianTask = {
        description: 'Multi-sync test',
        status: 'TODO',
        dueDate: '2026-02-11',
        scheduledDate: null,
        startDate: null,
        completedDate: null,
        priority: 'none',
        recurrenceRule: '',
        tags: []
      };

      // Sync 1: task → VTODO → task
      let vtodo1 = mapper.taskToVTODO(task, 'test-uid');
      let task1 = mapper.vtodoToTask({ data: vtodo1, etag: 'e1', url: 'http://example.com/1.ics' });

      // Sync 2: task → VTODO → task
      let vtodo2 = mapper.taskToVTODO(task1, 'test-uid');
      let task2 = mapper.vtodoToTask({ data: vtodo2, etag: 'e2', url: 'http://example.com/2.ics' });

      // Sync 3: task → VTODO → task
      let vtodo3 = mapper.taskToVTODO(task2, 'test-uid');
      let task3 = mapper.vtodoToTask({ data: vtodo3, etag: 'e3', url: 'http://example.com/3.ics' });

      // Date should be stable across all syncs
      expect(task1.dueDate).toBe('2026-02-11');
      expect(task2.dueDate).toBe('2026-02-11');
      expect(task3.dueDate).toBe('2026-02-11');
    });
  });

  describe('RFC 5545 line folding', () => {
    it('should unfold SUMMARY split across lines', () => {
      const vtodoData = `BEGIN:VTODO\r\nUID:fold-test\r\nSUMMARY:Test task created by CalDAV request dumper for fixture \r\n generation.\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.description).toBe('Test task created by CalDAV request dumper for fixture generation.');
    });

    it('should unfold with LF-only line endings', () => {
      const vtodoData = `BEGIN:VTODO\nUID:fold-lf\nSUMMARY:A very long task description that has been\n  folded by the server\nSTATUS:NEEDS-ACTION\nEND:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.description).toBe('A very long task description that has been folded by the server');
    });

    it('should unfold with tab continuation', () => {
      const vtodoData = `BEGIN:VTODO\r\nUID:fold-tab\r\nSUMMARY:Task with tab\r\n\tcontinuation\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.description).toBe('Task with tabcontinuation');
    });

    it('should unfold UID when extracting directly', () => {
      const data = `BEGIN:VTODO\r\nUID:very-long-uid-that-was-\r\n folded-by-server\r\nSUMMARY:Task\r\nEND:VTODO`;

      const uid = mapper.extractUID(data);
      expect(uid).toBe('very-long-uid-that-was-folded-by-server');
    });
  });

  describe('VTIMEZONE / TZID date handling', () => {
    it('should parse DUE with TZID parameter', () => {
      const vtodoData = `BEGIN:VTODO
UID:tzid-test
SUMMARY:Task with TZID date
DUE;TZID=Pacific/Auckland:20260214T060001
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.dueDate).toBe('2026-02-14');
    });

    it('should parse DTSTART with TZID parameter', () => {
      const vtodoData = `BEGIN:VTODO
UID:tzid-start-test
SUMMARY:Task with TZID start date
DTSTART;TZID=Pacific/Auckland:20260214T000000
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.scheduledDate).toBe('2026-02-14');
    });

    it('should still parse VALUE=DATE format', () => {
      const vtodoData = `BEGIN:VTODO
UID:value-date-test
SUMMARY:Task
DUE;VALUE=DATE:20260214
STATUS:NEEDS-ACTION
END:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test-etag',
        url: 'http://example.com/test.ics'
      };

      const task = mapper.vtodoToTask(vtodo);
      expect(task.dueDate).toBe('2026-02-14');
    });
  });

  describe('Integration: realistic server VTODO with folding and TZID', () => {
    it('should parse a full DAVx5/Tasks.org VTODO with VTIMEZONE block', () => {
      // Simulates a real VTODO from DAVx5 with:
      // - VTIMEZONE block
      // - TZID-parameterized dates
      // - Folded DESCRIPTION
      // - CATEGORIES, PRIORITY, RRULE
      const vtodoData = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//DAVx5//Tasks.org//EN',
        'BEGIN:VTIMEZONE',
        'TZID:Pacific/Auckland',
        'BEGIN:STANDARD',
        'DTSTART:19700405T030000',
        'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4',
        'TZOFFSETFROM:+1300',
        'TZOFFSETTO:+1200',
        'END:STANDARD',
        'BEGIN:DAYLIGHT',
        'DTSTART:19700927T020000',
        'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=9',
        'TZOFFSETFROM:+1200',
        'TZOFFSETTO:+1300',
        'END:DAYLIGHT',
        'END:VTIMEZONE',
        'BEGIN:VTODO',
        'UID:3507578162627955783@tasks.org',
        'DTSTAMP:20260210T120000Z',
        'LAST-MODIFIED:20260210T120000Z',
        'SUMMARY:Weekly grocery shopping with a very long description',
        ' that continues on the next line and needs to be',
        ' unfolded properly',
        'DESCRIPTION:Buy the following items from the store: bread\\,',
        ' milk\\, eggs\\, cheese\\, and other essentials for',
        ' the week ahead.',
        'DUE;TZID=Pacific/Auckland:20260214T060001',
        'DTSTART;TZID=Pacific/Auckland:20260214T000000',
        'STATUS:NEEDS-ACTION',
        'PRIORITY:3',
        'CATEGORIES:groceries,weekly',
        'RRULE:FREQ=WEEKLY;BYDAY=SA',
        'END:VTODO',
        'END:VCALENDAR'
      ].join('\r\n');

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: '"abc123"',
        url: 'http://dav.example.com/calendars/tasks/3507578162627955783.ics'
      };

      const task = mapper.vtodoToTask(vtodo);

      // Folded SUMMARY should be unfolded
      expect(task.description).toBe(
        'Weekly grocery shopping with a very long description' +
        'that continues on the next line and needs to be' +
        'unfolded properly'
      );

      // TZID dates should extract date portion
      expect(task.dueDate).toBe('2026-02-14');
      expect(task.scheduledDate).toBe('2026-02-14');

      // Other properties should parse normally
      expect(task.status).toBe('TODO');
      expect(task.priority).toBe('high');
      expect(task.tags).toEqual(['groceries', 'weekly']);
      expect(task.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=SA');

      // UID extraction should also handle unfolding
      const uid = mapper.extractUID(vtodoData);
      expect(uid).toBe('3507578162627955783@tasks.org');

      // LAST-MODIFIED should parse
      const lastModified = mapper.extractLastModified(vtodoData);
      expect(lastModified).toBe('2026-02-10T12:00:00Z');
    });

    it('should round-trip a task with TZID dates correctly', () => {
      // Parse a VTODO with TZID dates
      const vtodoData = `BEGIN:VTODO\r\nUID:round-trip-tzid\r\nSUMMARY:Round trip test\r\nDUE;TZID=Europe/London:20260315T090000\r\nDTSTART;TZID=Europe/London:20260310T080000\r\nSTATUS:NEEDS-ACTION\r\nPRIORITY:5\r\nEND:VTODO`;

      const vtodo: CalendarObject = {
        data: vtodoData,
        etag: 'test',
        url: 'http://example.com/test.ics'
      };

      // Parse TZID dates
      const task = mapper.vtodoToTask(vtodo);
      expect(task.dueDate).toBe('2026-03-15');
      expect(task.scheduledDate).toBe('2026-03-10');

      // Round-trip: convert back to VTODO (will use VALUE=DATE format)
      const vtodoOut = mapper.taskToVTODO(task, 'round-trip-tzid');
      expect(vtodoOut).toContain('DUE;VALUE=DATE:20260315');
      expect(vtodoOut).toContain('DTSTART;VALUE=DATE:20260310');

      // Parse again — dates should be stable
      const task2 = mapper.vtodoToTask({ data: vtodoOut, etag: 'e2', url: 'http://test' });
      expect(task2.dueDate).toBe('2026-03-15');
      expect(task2.scheduledDate).toBe('2026-03-10');
    });
  });
});
