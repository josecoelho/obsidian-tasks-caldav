import { requestUrl } from 'obsidian';
import { CalDAVSettings } from '../types';
import { VTODOMapper, CalendarObject } from './vtodoMapper';

/**
 * Direct CalDAV client implementation using Obsidian's requestUrl
 * Bypasses CORS issues by not using fetch()
 */
export class CalDAVClientDirect {
  private settings: CalDAVSettings;
  private mapper: VTODOMapper;
  private calendarUrl: string | null = null;
  private authHeader: string;

  constructor(settings: CalDAVSettings) {
    this.settings = settings;
    this.mapper = new VTODOMapper();

    // Create Basic Auth header
    const credentials = `${settings.username}:${settings.password}`;
    this.authHeader = 'Basic ' + btoa(credentials);
  }

  /**
   * Connect to CalDAV server and find the calendar
   */
  async connect(): Promise<void> {
    console.log('[CalDAV] Connecting to server:', this.settings.serverUrl);

    try {
      // Step 1: Discover calendar home URL
      const homeUrl = await this.discoverCalendarHome();
      console.log('[CalDAV] Calendar home:', homeUrl);

      // Step 2: Find calendars
      const calendars = await this.findCalendars(homeUrl);
      console.log('[CalDAV] Found calendars:', calendars);

      // Step 3: Find our specific calendar
      const calendar = calendars.find(c => c.displayName === this.settings.calendarName);
      if (!calendar) {
        throw new Error(`Calendar '${this.settings.calendarName}' not found. Available: ${calendars.map(c => c.displayName).join(', ')}`);
      }

      this.calendarUrl = calendar.url;
      console.log('[CalDAV] Using calendar:', this.calendarUrl);

    } catch (error) {
      console.error('[CalDAV] Connection failed:', error);
      throw error;
    }
  }

  /**
   * Discover the calendar home URL using well-known or PROPFIND
   */
  private async discoverCalendarHome(): Promise<string> {
    // Try well-known CalDAV endpoint first (RFC 6764)
    const baseUrl = new URL(this.settings.serverUrl);
    const wellKnownUrl = `${baseUrl.protocol}//${baseUrl.host}/.well-known/caldav`;

    console.log('[CalDAV] Trying well-known URL:', wellKnownUrl);

    try {
      const wellKnownResponse = await requestUrl({
        url: wellKnownUrl,
        method: 'PROPFIND',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0'
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`,
        throw: false
      });

      console.log('[CalDAV] Well-known response status:', wellKnownResponse.status);

      // If well-known works, discover from there
      if (wellKnownResponse.status === 207) {
        return await this.discoverFromPrincipal(wellKnownResponse.text, wellKnownUrl);
      }
    } catch (error) {
      console.log('[CalDAV] Well-known failed, trying direct:', error);
    }

    // Fall back to direct PROPFIND on server URL
    const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

    const response = await requestUrl({
      url: this.settings.serverUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: propfindBody,
      throw: false
    });

    console.log('[CalDAV] PROPFIND response status:', response.status);

    if (response.status !== 207) {
      throw new Error(`PROPFIND failed: ${response.status} ${response.text.substring(0, 500)}`);
    }

    return await this.discoverFromPrincipal(response.text, this.settings.serverUrl);
  }

  /**
   * Discover calendar home from principal URL
   */
  private async discoverFromPrincipal(propfindResponse: string, contextUrl: string): Promise<string> {
    // Extract current-user-principal
    const principalMatch = propfindResponse.match(/<d:current-user-principal>\s*<d:href>([^<]+)<\/d:href>/);
    if (!principalMatch) {
      throw new Error('Could not find current-user-principal in response');
    }

    let principalUrl = principalMatch[1];

    // Make absolute URL if relative
    if (!principalUrl.startsWith('http')) {
      const baseUrl = new URL(contextUrl);
      principalUrl = `${baseUrl.protocol}//${baseUrl.host}${principalUrl}`;
    }

    console.log('[CalDAV] Principal URL:', principalUrl);

    // Now get calendar-home-set from principal
    const calendarHomeResponse = await requestUrl({
      url: principalUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`,
      throw: false
    });

    if (calendarHomeResponse.status !== 207) {
      throw new Error(`Failed to get calendar-home-set: ${calendarHomeResponse.status}`);
    }

    // Extract calendar-home-set
    const homeMatch = calendarHomeResponse.text.match(/<c:calendar-home-set>\s*<d:href>([^<]+)<\/d:href>/);
    if (!homeMatch) {
      throw new Error('Could not find calendar-home-set in principal response');
    }

    let homeUrl = homeMatch[1];

    // Make absolute URL if relative
    if (!homeUrl.startsWith('http')) {
      const baseUrl = new URL(principalUrl);
      homeUrl = `${baseUrl.protocol}//${baseUrl.host}${homeUrl}`;
    }

    return homeUrl;
  }

  /**
   * Parse calendars from PROPFIND XML response (static for testing)
   */
  static parseCalendarsFromXML(xmlText: string, baseServerUrl: string): Array<{ url: string; displayName: string; supportsVTODO: boolean }> {
    const calendars: Array<{ url: string; displayName: string; supportsVTODO: boolean }> = [];
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xmlText)) !== null) {
      const responseBlock = match[1];

      // Check if it's a calendar (has calendar resourcetype)
      if (!responseBlock.includes('<c:calendar')) {
        continue;
      }

      // Extract href
      const hrefMatch = responseBlock.match(/<d:href>([^<]+)<\/d:href>/);
      if (!hrefMatch) continue;

      let url = hrefMatch[1];

      // Make absolute URL if relative
      if (!url.startsWith('http')) {
        const baseUrl = new URL(baseServerUrl);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      }

      // Extract display name (handle CDATA)
      const nameMatch = responseBlock.match(/<d:displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/d:displayname>/);
      const displayName = nameMatch ? nameMatch[1].trim() : url;

      // Check if calendar supports VTODO
      const supportsVTODO = responseBlock.includes('<c:comp name="VTODO"') ||
                           responseBlock.includes('<C:comp name="VTODO"');

      calendars.push({ url, displayName, supportsVTODO });
    }

    return calendars;
  }

  /**
   * Find all calendars in the calendar home
   */
  private async findCalendars(homeUrl: string): Promise<Array<{ url: string; displayName: string; supportsVTODO: boolean }>> {
    const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

    const response = await requestUrl({
      url: homeUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: propfindBody,
      throw: false
    });

    if (response.status !== 207) {
      throw new Error(`PROPFIND calendars failed: ${response.status}`);
    }

    console.log('[CalDAV] Calendars PROPFIND response:', response.text.substring(0, 1000));

    return CalDAVClientDirect.parseCalendarsFromXML(response.text, this.settings.serverUrl);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.calendarUrl !== null;
  }

  /**
   * Parse VTODOs from calendar-query XML response (static for testing)
   */
  static parseVTODOsFromXML(xmlText: string, baseServerUrl: string): CalendarObject[] {
    const vtodos: CalendarObject[] = [];
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;

    while ((match = responseRegex.exec(xmlText)) !== null) {
      const responseBlock = match[1];

      // Extract href
      const hrefMatch = responseBlock.match(/<d:href>([^<]+)<\/d:href>/);
      if (!hrefMatch) continue;

      let url = hrefMatch[1];
      if (!url.startsWith('http')) {
        const baseUrl = new URL(baseServerUrl);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      }

      // Extract etag
      const etagMatch = responseBlock.match(/<d:getetag>([^<]+)<\/d:getetag>/);
      const etag = etagMatch ? etagMatch[1].replace(/"/g, '') : undefined;

      // Extract calendar data (VTODO)
      const dataMatch = responseBlock.match(/<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/);
      if (!dataMatch) continue;

      const data = dataMatch[1].trim();

      vtodos.push({ data, url, etag });
    }

    return vtodos;
  }

  /**
   * Fetch all VTODOs from the calendar
   */
  async fetchVTODOs(): Promise<CalendarObject[]> {
    if (!this.calendarUrl) {
      throw new Error('Not connected to CalDAV server');
    }

    // REPORT query to get all VTODOs
    const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const response = await requestUrl({
      url: this.calendarUrl,
      method: 'REPORT',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: reportBody,
      throw: false
    });

    if (response.status !== 207) {
      throw new Error(`REPORT VTODOs failed: ${response.status}`);
    }

    console.log('[CalDAV] REPORT response length:', response.text.length);

    const vtodos = CalDAVClientDirect.parseVTODOsFromXML(response.text, this.settings.serverUrl);
    console.log('[CalDAV] Fetched', vtodos.length, 'VTODOs');
    return vtodos;
  }

  /**
   * Fetch VTODO by UID
   */
  async fetchVTODOByUID(uid: string): Promise<{ data: string; url: string; etag?: string } | null> {
    const vtodos = await this.fetchVTODOs();
    return vtodos.find(vtodo => this.mapper.extractUID(vtodo.data) === uid) || null;
  }

  /**
   * Create a new VTODO
   */
  async createVTODO(vtodoData: string, uid: string): Promise<void> {
    if (!this.calendarUrl) {
      throw new Error('Not connected to CalDAV server');
    }

    const filename = `${uid}.ics`;
    const url = `${this.calendarUrl}/${filename}`;

    const response = await requestUrl({
      url,
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*' // Only create if doesn't exist
      },
      body: vtodoData,
      throw: false
    });

    if (response.status !== 201 && response.status !== 204) {
      throw new Error(`Create VTODO failed: ${response.status} ${response.text}`);
    }

    console.log('[CalDAV] Created VTODO:', uid);
  }

  /**
   * Update an existing VTODO
   */
  async updateVTODO(vtodo: { data: string; url: string; etag?: string }, newData: string): Promise<void> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Content-Type': 'text/calendar; charset=utf-8'
    };

    // Use etag for optimistic concurrency if available
    if (vtodo.etag) {
      headers['If-Match'] = `"${vtodo.etag}"`;
    }

    const response = await requestUrl({
      url: vtodo.url,
      method: 'PUT',
      headers,
      body: newData,
      throw: false
    });

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Update VTODO failed: ${response.status}`);
    }

    console.log('[CalDAV] Updated VTODO:', vtodo.url);
  }

  /**
   * Delete a VTODO
   */
  async deleteVTODO(vtodo: { data: string; url: string; etag?: string }): Promise<void> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader
    };

    if (vtodo.etag) {
      headers['If-Match'] = `"${vtodo.etag}"`;
    }

    const response = await requestUrl({
      url: vtodo.url,
      method: 'DELETE',
      headers,
      throw: false
    });

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Delete VTODO failed: ${response.status}`);
    }

    console.log('[CalDAV] Deleted VTODO:', vtodo.url);
  }

  /**
   * Delete VTODO by UID
   */
  async deleteVTODOByUID(uid: string): Promise<void> {
    const vtodo = await this.fetchVTODOByUID(uid);
    if (vtodo) {
      await this.deleteVTODO(vtodo);
    }
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.connect();
      return {
        success: true,
        message: `Successfully connected to calendar '${this.settings.calendarName}'`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the mapper instance
   */
  getMapper(): VTODOMapper {
    return this.mapper;
  }
}
