import { CalDAVClientDirect } from './calDAVClientDirect';
import { CalDAVSettings } from '../types';

const mockSettings: CalDAVSettings = {
    serverUrl: 'https://caldav.example.com',
    username: 'testuser',
    password: 'testpass',
    calendarName: 'Tasks',
    syncTag: 'sync',
    syncInterval: 5,
    newTasksDestination: 'Inbox.md',
    newTasksSection: '',
    requireManualConflictResolution: false,
    autoResolveObsidianWins: true,
    syncCompletedTasks: false,
    deleteBehavior: 'ask'
};

describe('CalDAVClientDirect', () => {
    let client: CalDAVClientDirect;

    beforeEach(() => {
        client = new CalDAVClientDirect(mockSettings);
        jest.clearAllMocks();
    });

    describe('Construction and initialization', () => {
        it('should construct with correct auth header', () => {
            expect(client).toBeDefined();
            // Auth header should be properly encoded
            const authHeader = (client as any).authHeader;
            expect(authHeader).toContain('Basic ');

            // Verify base64 encoding of username:password
            const decoded = atob(authHeader.replace('Basic ', ''));
            expect(decoded).toBe('testuser:testpass');
        });

        it('should store calendar settings', () => {
            const settings = (client as any).settings;
            expect(settings.serverUrl).toBe('https://caldav.example.com');
            expect(settings.username).toBe('testuser');
            expect(settings.calendarName).toBe('Tasks');
        });

        it('should initialize with null calendar URL', () => {
            const calendarUrl = (client as any).calendarUrl;
            expect(calendarUrl).toBeNull();
        });

        it('should have VTODOMapper instance', () => {
            const mapper = (client as any).mapper;
            expect(mapper).toBeDefined();
            expect(mapper.taskToVTODO).toBeDefined();
            expect(mapper.vtodoToTask).toBeDefined();
        });

        it('should report not connected initially', () => {
            expect(client.isConnected()).toBe(false);
        });
    });

    describe('parseCalendarsFromXML', () => {
        it('should parse calendars from multistatus response', () => {
            const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/calendars/user/calendar1/</d:href>
        <d:propstat>
            <d:prop>
                <d:displayname><![CDATA[Reminders]]></d:displayname>
                <d:resourcetype>
                    <d:collection/>
                    <c:calendar/>
                </d:resourcetype>
                <c:supported-calendar-component-set>
                    <c:comp name="VTODO"/>
                </c:supported-calendar-component-set>
            </d:prop>
        </d:propstat>
    </d:response>
    <d:response>
        <d:href>/calendars/user/calendar2/</d:href>
        <d:propstat>
            <d:prop>
                <d:displayname>Events</d:displayname>
                <d:resourcetype>
                    <d:collection/>
                    <c:calendar/>
                </d:resourcetype>
                <c:supported-calendar-component-set>
                    <c:comp name="VEVENT"/>
                </c:supported-calendar-component-set>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');

            expect(calendars).toHaveLength(2);
            expect(calendars[0].displayName).toBe('Reminders');
            expect(calendars[0].supportsVTODO).toBe(true);
            expect(calendars[0].url).toBe('https://caldav.example.com/calendars/user/calendar1/');
            expect(calendars[1].displayName).toBe('Events');
            expect(calendars[1].supportsVTODO).toBe(false);
            expect(calendars[1].url).toBe('https://caldav.example.com/calendars/user/calendar2/');
        });

        it('should skip non-calendar resources', () => {
            const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:">
    <d:response>
        <d:href>/principals/user/testuser/</d:href>
        <d:propstat>
            <d:prop>
                <d:resourcetype>
                    <d:collection/>
                    <d:principal/>
                </d:resourcetype>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');
            expect(calendars).toHaveLength(0);
        });
    });

    describe('parseVTODOsFromXML', () => {
        it('should extract VTODOs from calendar-query response', () => {
            const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/calendars/user/tasks/todo1.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"etag-123"</d:getetag>
                <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:todo-1
SUMMARY:Test task
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://caldav.example.com');

            expect(vtodos).toHaveLength(1);
            expect(vtodos[0].url).toBe('https://caldav.example.com/calendars/user/tasks/todo1.ics');
            expect(vtodos[0].data).toContain('UID:todo-1');
            expect(vtodos[0].etag).toBe('etag-123');
        });

        it('should handle multiple VTODOs in response', () => {
            const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/calendars/user/tasks/todo1.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"etag-1"</d:getetag>
                <c:calendar-data>BEGIN:VTODO
UID:todo-1
END:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
    <d:response>
        <d:href>/calendars/user/tasks/todo2.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"etag-2"</d:getetag>
                <c:calendar-data>BEGIN:VTODO
UID:todo-2
END:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://caldav.example.com');

            expect(vtodos).toHaveLength(2);
            expect(vtodos[0].data).toContain('UID:todo-1');
            expect(vtodos[0].etag).toBe('etag-1');
            expect(vtodos[1].data).toContain('UID:todo-2');
            expect(vtodos[1].etag).toBe('etag-2');
        });
    });

    describe('VTODOMapper integration', () => {
        it('should have access to mapper methods', () => {
            const mapper = client.getMapper();

            expect(mapper).toBeDefined();
            expect(typeof mapper.taskToVTODO).toBe('function');
            expect(typeof mapper.vtodoToTask).toBe('function');
            expect(typeof mapper.extractUID).toBe('function');
        });
    });

    describe('Connection state', () => {
        it('should report not connected when calendarUrl is null', () => {
            expect(client.isConnected()).toBe(false);
        });

        it('should report connected after setting calendarUrl', () => {
            (client as any).calendarUrl = 'https://caldav.example.com/calendars/test/';
            expect(client.isConnected()).toBe(true);
        });
    });

    describe('Error handling expectations', () => {
        it('should throw when fetchVTODOs called without connection', async () => {
            await expect(client.fetchVTODOs()).rejects.toThrow('Not connected to CalDAV server');
        });

        it('should throw when createVTODO called without connection', async () => {
            await expect(client.createVTODO('VTODO data', 'uid-123')).rejects.toThrow('Not connected to CalDAV server');
        });
    });
});
