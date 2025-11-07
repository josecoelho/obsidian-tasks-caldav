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

    describe('Calendar discovery - XML parsing', () => {
        describe('Principal extraction', () => {
            it('should extract current-user-principal from PROPFIND response', () => {
                const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:">
    <d:response>
        <d:propstat>
            <d:prop>
                <d:current-user-principal>
                    <d:href>/principals/user/testuser/</d:href>
                </d:current-user-principal>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

                const principalMatch = response.match(/<d:current-user-principal>\s*<d:href>([^<]+)<\/d:href>/);
                expect(principalMatch).toBeTruthy();
                expect(principalMatch![1]).toBe('/principals/user/testuser/');
            });

            it('should handle principal with whitespace', () => {
                const response = `<d:current-user-principal>
    <d:href>  /principals/user/testuser/  </d:href>
</d:current-user-principal>`;

                const principalMatch = response.match(/<d:current-user-principal>\s*<d:href>([^<]+)<\/d:href>/);
                expect(principalMatch).toBeTruthy();
                expect(principalMatch![1].trim()).toBe('/principals/user/testuser/');
            });
        });

        describe('Calendar-home-set extraction', () => {
            it('should extract calendar-home-set from response', () => {
                const response = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response>
        <d:propstat>
            <d:prop>
                <c:calendar-home-set>
                    <d:href>/calendars/user/testuser/</d:href>
                </c:calendar-home-set>
            </d:prop>
        </d:propstat>
    </d:response>
</d:multistatus>`;

                const homeMatch = response.match(/<c:calendar-home-set>\s*<d:href>([^<]+)<\/d:href>/);
                expect(homeMatch).toBeTruthy();
                expect(homeMatch![1]).toBe('/calendars/user/testuser/');
            });

            it('should handle absolute URLs in calendar-home-set', () => {
                const response = `<c:calendar-home-set>
    <d:href>https://caldav.example.com/calendars/user/testuser/</d:href>
</c:calendar-home-set>`;

                const homeMatch = response.match(/<c:calendar-home-set>\s*<d:href>([^<]+)<\/d:href>/);
                expect(homeMatch).toBeTruthy();
                expect(homeMatch![1]).toBe('https://caldav.example.com/calendars/user/testuser/');
            });
        });

        describe('Calendar list parsing', () => {
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

                // Simulate the parsing logic
                const calendars: Array<{ url: string; displayName: string; supportsVTODO: boolean }> = [];
                const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
                let match;

                while ((match = responseRegex.exec(response)) !== null) {
                    const responseBlock = match[1];

                    if (!responseBlock.includes('<c:calendar')) continue;

                    const hrefMatch = responseBlock.match(/<d:href>([^<]+)<\/d:href>/);
                    if (!hrefMatch) continue;

                    const url = hrefMatch[1];
                    const nameMatch = responseBlock.match(/<d:displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/d:displayname>/);
                    const displayName = nameMatch ? nameMatch[1].trim() : url;
                    const supportsVTODO = responseBlock.includes('<c:comp name="VTODO"');

                    calendars.push({ url, displayName, supportsVTODO });
                }

                expect(calendars).toHaveLength(2);
                expect(calendars[0].displayName).toBe('Reminders');
                expect(calendars[0].supportsVTODO).toBe(true);
                expect(calendars[1].displayName).toBe('Events');
                expect(calendars[1].supportsVTODO).toBe(false);
            });

            it('should handle displayname with CDATA tags', () => {
                const responseBlock = `<d:displayname><![CDATA[My Tasks & Events]]></d:displayname>`;
                const nameMatch = responseBlock.match(/<d:displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/d:displayname>/);

                expect(nameMatch).toBeTruthy();
                expect(nameMatch![1]).toBe('My Tasks & Events');
            });

            it('should handle displayname without CDATA', () => {
                const responseBlock = `<d:displayname>Simple Calendar</d:displayname>`;
                const nameMatch = responseBlock.match(/<d:displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/d:displayname>/);

                expect(nameMatch).toBeTruthy();
                expect(nameMatch![1]).toBe('Simple Calendar');
            });

            it('should detect VTODO support with lowercase comp', () => {
                const responseBlock = `<c:supported-calendar-component-set>
    <c:comp name="VEVENT"/>
    <c:comp name="VTODO"/>
</c:supported-calendar-component-set>`;

                const supportsVTODO = responseBlock.includes('<c:comp name="VTODO"');
                expect(supportsVTODO).toBe(true);
            });

            it('should detect VTODO support with uppercase comp', () => {
                const responseBlock = `<C:supported-calendar-component-set>
    <C:comp name="VEVENT"/>
    <C:comp name="VTODO"/>
</C:supported-calendar-component-set>`;

                const supportsVTODO = responseBlock.includes('<c:comp name="VTODO"') ||
                                     responseBlock.includes('<C:comp name="VTODO"');
                expect(supportsVTODO).toBe(true);
            });

            it('should not detect VTODO support when only VEVENT', () => {
                const responseBlock = `<c:supported-calendar-component-set>
    <c:comp name="VEVENT"/>
</c:supported-calendar-component-set>`;

                const supportsVTODO = responseBlock.includes('<c:comp name="VTODO"');
                expect(supportsVTODO).toBe(false);
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

                const calendars: Array<{ url: string; displayName: string; supportsVTODO: boolean }> = [];
                const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
                let match;

                while ((match = responseRegex.exec(response)) !== null) {
                    const responseBlock = match[1];
                    if (!responseBlock.includes('<c:calendar')) continue;
                    calendars.push({ url: '', displayName: '', supportsVTODO: false });
                }

                expect(calendars).toHaveLength(0);
            });
        });

        describe('VTODO data extraction', () => {
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

                const vtodos: Array<{ data: string; url: string; etag?: string }> = [];
                const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
                let match;

                while ((match = responseRegex.exec(response)) !== null) {
                    const responseBlock = match[1];

                    const hrefMatch = responseBlock.match(/<d:href>([^<]+)<\/d:href>/);
                    const dataMatch = responseBlock.match(/<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/);
                    const etagMatch = responseBlock.match(/<d:getetag>"?([^<"]+)"?<\/d:getetag>/);

                    if (hrefMatch && dataMatch) {
                        vtodos.push({
                            url: hrefMatch[1],
                            data: dataMatch[1].trim(),
                            etag: etagMatch ? etagMatch[1] : undefined
                        });
                    }
                }

                expect(vtodos).toHaveLength(1);
                expect(vtodos[0].url).toBe('/calendars/user/tasks/todo1.ics');
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

                const vtodos: Array<{ data: string; url: string; etag?: string }> = [];
                const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
                let match;

                while ((match = responseRegex.exec(response)) !== null) {
                    const responseBlock = match[1];

                    const hrefMatch = responseBlock.match(/<d:href>([^<]+)<\/d:href>/);
                    const dataMatch = responseBlock.match(/<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/);
                    const etagMatch = responseBlock.match(/<d:getetag>"?([^<"]+)"?<\/d:getetag>/);

                    if (hrefMatch && dataMatch) {
                        vtodos.push({
                            url: hrefMatch[1],
                            data: dataMatch[1].trim(),
                            etag: etagMatch ? etagMatch[1] : undefined
                        });
                    }
                }

                expect(vtodos).toHaveLength(2);
                expect(vtodos[0].data).toContain('UID:todo-1');
                expect(vtodos[1].data).toContain('UID:todo-2');
            });

            it('should handle missing etag', () => {
                const response = `<d:response>
    <d:href>/calendars/user/tasks/todo1.ics</d:href>
    <d:propstat>
        <d:prop>
            <c:calendar-data>BEGIN:VTODO
UID:todo-1
END:VTODO</c:calendar-data>
        </d:prop>
    </d:propstat>
</d:response>`;

                const etagMatch = response.match(/<d:getetag>"?([^<"]+)"?<\/d:getetag>/);
                expect(etagMatch).toBeNull();
            });

            it('should handle etag with and without quotes', () => {
                const responseWithQuotes = `<d:getetag>"etag-123"</d:getetag>`;
                const responseWithoutQuotes = `<d:getetag>etag-456</d:getetag>`;

                const match1 = responseWithQuotes.match(/<d:getetag>"?([^<"]+)"?<\/d:getetag>/);
                const match2 = responseWithoutQuotes.match(/<d:getetag>"?([^<"]+)"?<\/d:getetag>/);

                expect(match1![1]).toBe('etag-123');
                expect(match2![1]).toBe('etag-456');
            });
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
