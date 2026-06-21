import { CalDAVDiscoverer } from './calDAVDiscoverer';

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

describe('CalDAVDiscoverer', () => {
  describe('listCalendars()', () => {
    it('discovers and returns every calendar with VTODO support flags', async () => {
      const request = jest.fn();
      mockDiscovery(request);
      const discoverer = new CalDAVDiscoverer('https://caldav.example.com', 'testuser', 'testpass', { request });

      const calendars = await discoverer.listCalendars();

      expect(calendars).toEqual([
        { url: 'https://caldav.example.com/calendars/user/personal-todos/', displayName: 'Personal', supportsVTODO: true },
        { url: 'https://caldav.example.com/calendars/user/personal-events/', displayName: 'Personal', supportsVTODO: false },
      ]);
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

      const calendars = CalDAVDiscoverer.parseCalendarsFromXML(response, 'https://caldav.example.com');

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

      const calendars = CalDAVDiscoverer.parseCalendarsFromXML(response, 'https://caldav.example.com');

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

      const calendars = CalDAVDiscoverer.parseCalendarsFromXML(response, 'https://caldav.example.com');
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

      const calendars = CalDAVDiscoverer.parseCalendarsFromXML(response, 'https://caldav.example.com');
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

      const calendars = CalDAVDiscoverer.parseCalendarsFromXML(response, 'https://caldav.example.com');
      expect(calendars[0].displayName).toBe('https://caldav.example.com/unnamed-calendar/');
    });
  });

  describe('parseHrefForProperty - pure function principal/home discovery', () => {
    it('should extract href when the property element has predeclared namespace', () => {
      const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/principals/user/</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-home-set><d:href>/calendars/user/</d:href></c:calendar-home-set>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      expect(CalDAVDiscoverer.parseHrefForProperty(xml, 'calendar-home-set'))
        .toBe('/calendars/user/');
    });

    it('should extract href when SabreDAV/Baïkal declares xmlns inline on the element (issue #71)', () => {
      const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav.php/principals/user/</d:href>
    <d:propstat>
      <d:prop>
        <cal:calendar-home-set xmlns:cal="urn:ietf:params:xml:ns:caldav">
          <d:href>/dav.php/calendars/user/</d:href>
        </cal:calendar-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      expect(CalDAVDiscoverer.parseHrefForProperty(xml, 'calendar-home-set'))
        .toBe('/dav.php/calendars/user/');
    });

    it('should extract current-user-principal href with inline xmlns', () => {
      const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav.php/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal xmlns:d="DAV:">
          <d:href>/dav.php/principals/user/</d:href>
        </d:current-user-principal>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      expect(CalDAVDiscoverer.parseHrefForProperty(xml, 'current-user-principal'))
        .toBe('/dav.php/principals/user/');
    });

    it('should return null when the property is absent', () => {
      const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/x/</d:href></d:response></d:multistatus>`;
      expect(CalDAVDiscoverer.parseHrefForProperty(xml, 'calendar-home-set')).toBeNull();
    });
  });
});
