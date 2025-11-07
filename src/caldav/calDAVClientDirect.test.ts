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

    describe('Authentication', () => {
        it('should encode credentials correctly for Basic Auth', () => {
            const authHeader = (client as any).authHeader;
            const decoded = atob(authHeader.replace('Basic ', ''));
            expect(decoded).toBe('testuser:testpass');
        });
    });

    describe('Connection state', () => {
        it('should report not connected initially', () => {
            expect(client.isConnected()).toBe(false);
        });

        it('should report connected after calendar URL is set', () => {
            (client as any).calendarUrl = 'https://caldav.example.com/calendars/test/';
            expect(client.isConnected()).toBe(true);
        });

        it('should throw when fetching VTODOs without connection', async () => {
            await expect(client.fetchVTODOs()).rejects.toThrow('Not connected to CalDAV server');
        });

        it('should throw when creating VTODO without connection', async () => {
            await expect(client.createVTODO('VTODO data', 'uid-123')).rejects.toThrow('Not connected to CalDAV server');
        });
    });

    describe('parseCalendarsFromXML - pure function XML parsing', () => {
        it('should extract calendar metadata and convert relative URLs to absolute', () => {
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
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');

            expect(calendars).toHaveLength(1);
            expect(calendars[0]).toEqual({
                displayName: 'Reminders',
                supportsVTODO: true,
                url: 'https://caldav.example.com/calendars/user/calendar1/'
            });
        });

        it('should correctly identify calendars that do not support VTODOs', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/calendars/events/</d:href>
        <d:propstat>
            <d:prop>
                <d:displayname>Events</d:displayname>
                <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
                <c:supported-calendar-component-set>
                    <c:comp name="VEVENT"/>
                </c:supported-calendar-component-set>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');

            expect(calendars[0].supportsVTODO).toBe(false);
        });

        it('should filter out non-calendar resources', () => {
            const response = `<d:multistatus xmlns:d="DAV:">
    <d:response>
        <d:href>/principals/user/testuser/</d:href>
        <d:propstat>
            <d:prop>
                <d:resourcetype><d:collection/><d:principal/></d:resourcetype>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');
            expect(calendars).toHaveLength(0);
        });

        it('should handle CDATA in displayname', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/cal/</d:href>
        <d:propstat>
            <d:prop>
                <d:displayname><![CDATA[Tasks & Events]]></d:displayname>
                <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
                <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');
            expect(calendars[0].displayName).toBe('Tasks & Events');
        });

        it('should use URL as fallback when displayname is missing', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>https://caldav.example.com/unnamed-calendar/</d:href>
        <d:propstat>
            <d:prop>
                <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
                <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const calendars = CalDAVClientDirect.parseCalendarsFromXML(response, 'https://caldav.example.com');
            expect(calendars[0].displayName).toBe('https://caldav.example.com/unnamed-calendar/');
        });
    });

    describe('parseVTODOsFromXML - pure function VTODO extraction', () => {
        it('should extract VTODO data with etag and convert relative URLs', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
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
            expect(vtodos[0]).toEqual({
                url: 'https://caldav.example.com/calendars/user/tasks/todo1.ics',
                data: expect.stringContaining('UID:todo-1'),
                etag: 'etag-123'
            });
        });

        it('should strip quotes from etag values', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/task.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"quoted-etag"</d:getetag>
                <c:calendar-data>BEGIN:VTODO\nUID:1\nEND:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://caldav.example.com');
            expect(vtodos[0].etag).toBe('quoted-etag');
        });

        it('should handle missing etag gracefully', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/task.ics</d:href>
        <d:propstat>
            <d:prop>
                <c:calendar-data>BEGIN:VTODO\nUID:1\nEND:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://caldav.example.com');
            expect(vtodos[0].etag).toBeUndefined();
        });

        it('should parse multiple VTODOs from single response', () => {
            const response = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:href>/todo1.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"etag-1"</d:getetag>
                <c:calendar-data>BEGIN:VTODO\nUID:todo-1\nEND:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
    <d:response>
        <d:href>/todo2.ics</d:href>
        <d:propstat>
            <d:prop>
                <d:getetag>"etag-2"</d:getetag>
                <c:calendar-data>BEGIN:VTODO\nUID:todo-2\nEND:VTODO</c:calendar-data>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://caldav.example.com');

            expect(vtodos).toHaveLength(2);
            expect(vtodos[0].data).toContain('todo-1');
            expect(vtodos[1].data).toContain('todo-2');
        });
    });
});
