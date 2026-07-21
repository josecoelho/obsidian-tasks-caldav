import { CalDAVClientDirect, CalDAVConnectionConfig } from './calDAVClientDirect';

const mockConfig: CalDAVConnectionConfig = {
    serverUrl: 'https://caldav.example.com',
    username: 'testuser',
    password: 'testpass',
    calendarName: 'Tasks',
};

// Discovery fixtures — the legacy name-match path in connect() runs discovery
// (delegated to CalDAVDiscoverer); the discoverer is unit-tested in its own file.
const PRINCIPAL_XML = `<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/.well-known/caldav</d:href>
    <d:propstat><d:prop>
      <d:current-user-principal><d:href>/principals/user/</d:href></d:current-user-principal>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const HOME_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/principals/user/</d:href>
    <d:propstat><d:prop>
      <c:calendar-home-set><d:href>/calendars/user/</d:href></c:calendar-home-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const CALENDARS_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/personal-todos/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/personal-events/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

function mockDiscovery(request: jest.Mock): void {
  request
    .mockResolvedValueOnce({ status: 207, text: PRINCIPAL_XML, headers: {} })
    .mockResolvedValueOnce({ status: 207, text: HOME_XML, headers: {} })
    .mockResolvedValueOnce({ status: 207, text: CALENDARS_XML, headers: {} });
}

describe('CalDAVClientDirect', () => {
    let client: CalDAVClientDirect;

    beforeEach(() => {
        client = new CalDAVClientDirect(mockConfig);
        jest.clearAllMocks();
    });

    describe('Authentication', () => {
        it('should encode credentials correctly for Basic Auth', () => {
            const authHeader = (client as unknown as {authHeader: string}).authHeader;
            const decoded = atob(authHeader.replace('Basic ', ''));
            expect(decoded).toBe('testuser:testpass');
        });
    });

    describe('Connection state', () => {
        it('should report not connected initially', () => {
            expect(client.isConnected()).toBe(false);
        });

        it('should report connected after calendar URL is set', () => {
            (client as unknown as {calendarUrl: string}).calendarUrl = 'https://caldav.example.com/calendars/test/';
            expect(client.isConnected()).toBe(true);
        });

        it('should throw when fetching VTODOs without connection', async () => {
            await expect(client.fetchVTODOs()).rejects.toThrow('Not connected to calendar server');
        });

        it('should throw when creating VTODO without connection', async () => {
            await expect(client.createVTODO('VTODO data', 'uid-123')).rejects.toThrow('Not connected to calendar server');
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
                data: expect.stringContaining('UID:todo-1') as string,
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

        it('should decode XML entities in calendar-data (Vikunja format)', () => {
            const response = `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response>
        <D:href>/dav/projects/3/task1.ics</D:href>
        <D:propstat>
            <D:prop>
                <D:getetag>"5-123456"</D:getetag>
                <C:calendar-data>BEGIN:VCALENDAR&#xA;VERSION:2.0&#xA;PRODID:-//Vikunja//EN&#xA;BEGIN:VTODO&#xA;UID:vikunja-task-1&#xA;SUMMARY:Buy groceries&#xA;STATUS:NEEDS-ACTION&#xA;END:VTODO&#xA;END:VCALENDAR</C:calendar-data>
            </D:prop>
        </D:propstat>
    </D:response>
</D:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'http://localhost:3457');

            expect(vtodos).toHaveLength(1);
            expect(vtodos[0].data).toContain('UID:vikunja-task-1');
            expect(vtodos[0].data).toContain('SUMMARY:Buy groceries');
            // Verify newlines are actual newlines, not &#xA;
            expect(vtodos[0].data).not.toContain('&#xA;');
            expect(vtodos[0].data.split('\n').length).toBeGreaterThan(1);
        });

        it('should decode mixed XML entities in calendar-data', () => {
            const response = `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
    <D:response>
        <D:href>/task.ics</D:href>
        <D:propstat>
            <D:prop>
                <C:calendar-data>BEGIN:VTODO&#xA;UID:1&#xA;SUMMARY:Fix &lt;html&gt; &amp; stuff&#xA;END:VTODO</C:calendar-data>
            </D:prop>
        </D:propstat>
    </D:response>
</D:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://example.com');

            expect(vtodos).toHaveLength(1);
            expect(vtodos[0].data).toContain('SUMMARY:Fix <html> & stuff');
            expect(vtodos[0].data).not.toContain('&lt;');
            expect(vtodos[0].data).not.toContain('&amp;');
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

        it('should parse calendar-data with inline xmlns attribute (Open-Xchange format)', () => {
            const response = `<?xml version="1.0" encoding="UTF-8"?>\r\n<D:multistatus xmlns:D="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav">\r\n  <D:response>\r\n    <D:href>/caldav/user123/todo-ox-1.ics</D:href>\r\n    <D:propstat>\r\n      <D:prop>\r\n        <D:getetag>etag-ox-1</D:getetag>\r\n        <calendar-data xmlns="urn:ietf:params:xml:ns:caldav"><![CDATA[BEGIN:VCALENDAR\nPRODID:Open-Xchange\nBEGIN:VTODO\nUID:todo-ox-1\nSUMMARY:Test task\nSTATUS:IN-PROCESS\nEND:VTODO\nEND:VCALENDAR]]></calendar-data>\r\n      </D:prop>\r\n      <D:status>HTTP/1.1 200 OK</D:status>\r\n    </D:propstat>\r\n  </D:response>\r\n</D:multistatus>`;

            const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response, 'https://dav.mailbox.org');

            expect(vtodos).toHaveLength(1);
            expect(vtodos[0].url).toBe('https://dav.mailbox.org/caldav/user123/todo-ox-1.ics');
            expect(vtodos[0].data).toContain('UID:todo-ox-1');
            expect(vtodos[0].data).toContain('STATUS:IN-PROCESS');
            expect(vtodos[0].etag).toBe('etag-ox-1');
        });
    });

    describe('connect() and pinned fetch', () => {
        it('uses calendarUrl directly and makes no discovery requests when pinned', async () => {
            const request = jest.fn();
            const pinned = new CalDAVClientDirect(
                { ...mockConfig, calendarUrl: 'https://caldav.example.com/calendars/user/personal-todos/' },
                { request },
            );

            await pinned.connect();

            expect(request).not.toHaveBeenCalled();
            expect(pinned.isConnected()).toBe(true);
            expect((pinned as unknown as { calendarUrl: string }).calendarUrl)
                .toBe('https://caldav.example.com/calendars/user/personal-todos/');
        });

        it('connect() without calendarUrl discovers and matches the calendar by name', async () => {
            const request = jest.fn();
            mockDiscovery(request);
            const c = new CalDAVClientDirect({ ...mockConfig, calendarName: 'Personal' }, { request });

            await c.connect();

            expect((c as unknown as { calendarUrl: string }).calendarUrl)
                .toBe('https://caldav.example.com/calendars/user/personal-todos/');
        });

        it('fetchVTODOs resolves relative hrefs against the pinned URL (empty serverUrl)', async () => {
            const REPORT_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/personal-todos/t1.ics</d:href>
    <d:propstat><d:prop>
      <c:calendar-data>BEGIN:VTODO\nUID:1\nEND:VTODO</c:calendar-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
            const request = jest.fn().mockResolvedValueOnce({ status: 207, text: REPORT_XML, headers: {} });
            const c = new CalDAVClientDirect(
                { ...mockConfig, serverUrl: '', calendarUrl: 'https://caldav.example.com/calendars/user/personal-todos/' },
                { request },
            );

            await c.connect();
            const vtodos = await c.fetchVTODOs();

            expect(vtodos).toHaveLength(1);
            expect(vtodos[0].url).toBe('https://caldav.example.com/calendars/user/personal-todos/t1.ics');
        });
    });
});
