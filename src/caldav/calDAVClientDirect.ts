import { CalDAVSettings } from '../types';
import { VTODOMapper, CalendarObject } from './vtodoMapper';
import { HttpClient, ObsidianHttpClient } from './httpClient';
import { PROPFIND_PRINCIPAL, PROPFIND_CALENDAR_HOME, PROPFIND_CALENDARS, REPORT_VTODOS } from './templates';

/**
 * Direct CalDAV client implementation.
 * Uses an HttpClient abstraction so the transport layer can be swapped
 * (ObsidianHttpClient in production, FetchHttpClient in E2E tests).
 */
export class CalDAVClientDirect {
  private settings: CalDAVSettings;
  private mapper: VTODOMapper;
  private calendarUrl: string | null = null;
  private authHeader: string;
  private httpClient: HttpClient;

  constructor(settings: CalDAVSettings, httpClient?: HttpClient) {
    this.settings = settings;
    this.mapper = new VTODOMapper();
    this.httpClient = httpClient ?? new ObsidianHttpClient();

    // Create Basic Auth header
    const credentials = `${settings.username}:${settings.password}`;
    this.authHeader = 'Basic ' + btoa(credentials);
  }

  /**
   * Connect to CalDAV server and find the calendar
   */
  async connect(): Promise<void> {
    try {
      // Step 1: Discover calendar home URL
      const homeUrl = await this.discoverCalendarHome();

      // Step 2: Find calendars
      const calendars = await this.findCalendars(homeUrl);

      // Step 3: Find our specific calendar
      const calendar = calendars.find(c => c.displayName === this.settings.calendarName);
      if (!calendar) {
        throw new Error(`Calendar '${this.settings.calendarName}' not found. Available: ${calendars.map(c => c.displayName).join(', ')}`);
      }

      this.calendarUrl = calendar.url;

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

    try {
      const wellKnownResponse = await this.httpClient.request({
        url: wellKnownUrl,
        method: 'PROPFIND',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '0'
        },
        body: PROPFIND_PRINCIPAL,
        throw: false
      });

      // If well-known works, discover from there
      if (wellKnownResponse.status === 207) {
        return await this.discoverFromPrincipal(wellKnownResponse.text, wellKnownUrl);
      }
    } catch {
      // Well-known not supported, fall back to direct PROPFIND
    }

    // Fall back to direct PROPFIND on server URL
    const response = await this.httpClient.request({
      url: this.settings.serverUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: PROPFIND_PRINCIPAL,
      throw: false
    });

    if (response.status !== 207) {
      throw new Error(`PROPFIND failed: ${response.status} ${response.text.substring(0, 500)}`);
    }

    return await this.discoverFromPrincipal(response.text, this.settings.serverUrl);
  }

  /**
   * Discover calendar home from principal URL
   */
  private async discoverFromPrincipal(propfindResponse: string, contextUrl: string): Promise<string> {
    // Extract current-user-principal (handle any namespace prefix or none)
    const principalMatch = propfindResponse.match(/<(?:\w+:)?current-user-principal>\s*<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
    if (!principalMatch) {
      throw new Error('Could not find current-user-principal in response');
    }

    let principalUrl = principalMatch[1];

    // Make absolute URL if relative
    if (!principalUrl.startsWith('http')) {
      const baseUrl = new URL(contextUrl);
      principalUrl = `${baseUrl.protocol}//${baseUrl.host}${principalUrl}`;
    }

    // Now get calendar-home-set from principal
    const calendarHomeResponse = await this.httpClient.request({
      url: principalUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0'
      },
      body: PROPFIND_CALENDAR_HOME,
      throw: false
    });

    if (calendarHomeResponse.status !== 207) {
      throw new Error(`Failed to get calendar-home-set: ${calendarHomeResponse.status}`);
    }

    // Extract calendar-home-set (handle any namespace prefix or none)
    const homeMatch = calendarHomeResponse.text.match(/<(?:\w+:)?calendar-home-set>\s*<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
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
    const responseRegex = /<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g;
    let match;

    while ((match = responseRegex.exec(xmlText)) !== null) {
      const responseBlock = match[1];

      // Check if it's a calendar (has calendar resourcetype, any namespace prefix)
      if (!/< ?\w*:?calendar[\s/>]/i.test(responseBlock)) {
        continue;
      }

      // Extract href (any namespace prefix or none)
      const hrefMatch = responseBlock.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
      if (!hrefMatch) continue;

      let url = hrefMatch[1];

      // Make absolute URL if relative
      if (!url.startsWith('http')) {
        const baseUrl = new URL(baseServerUrl);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      }

      // Extract display name (handle CDATA, any namespace prefix)
      const nameMatch = responseBlock.match(/<(?:\w+:)?displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/(?:\w+:)?displayname>/);
      const displayName = nameMatch ? nameMatch[1].trim() : url;

      // Check if calendar supports VTODO (any namespace prefix, case-insensitive)
      const supportsVTODO = /< ?\w*:?comp name="VTODO"/i.test(responseBlock);

      calendars.push({ url, displayName, supportsVTODO });
    }

    return calendars;
  }

  /**
   * Find all calendars in the calendar home
   */
  private async findCalendars(homeUrl: string): Promise<Array<{ url: string; displayName: string; supportsVTODO: boolean }>> {
    const response = await this.httpClient.request({
      url: homeUrl,
      method: 'PROPFIND',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: PROPFIND_CALENDARS,
      throw: false
    });

    if (response.status !== 207) {
      throw new Error(`PROPFIND calendars failed: ${response.status}`);
    }

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
    const responseRegex = /<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g;
    let match;

    while ((match = responseRegex.exec(xmlText)) !== null) {
      const responseBlock = match[1];

      // Extract href (any namespace prefix or none)
      const hrefMatch = responseBlock.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
      if (!hrefMatch) continue;

      let url = hrefMatch[1];
      if (!url.startsWith('http')) {
        const baseUrl = new URL(baseServerUrl);
        url = `${baseUrl.protocol}//${baseUrl.host}${url}`;
      }

      // Extract etag (any namespace prefix or none)
      const etagMatch = responseBlock.match(/<(?:\w+:)?getetag>([^<]+)<\/(?:\w+:)?getetag>/);
      const etag = etagMatch ? etagMatch[1].replace(/"/g, '') : undefined;

      // Extract calendar data (VTODO) — handle optional CDATA wrapping, any namespace prefix
      const dataMatch = responseBlock.match(/<(?:\w+:)?calendar-data>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:\w+:)?calendar-data>/);
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
    const response = await this.httpClient.request({
      url: this.calendarUrl,
      method: 'REPORT',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1'
      },
      body: REPORT_VTODOS,
      throw: false
    });

    if (response.status !== 207) {
      throw new Error(`REPORT VTODOs failed: ${response.status}`);
    }

    return CalDAVClientDirect.parseVTODOsFromXML(response.text, this.settings.serverUrl);
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

    const response = await this.httpClient.request({
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

    const response = await this.httpClient.request({
      url: vtodo.url,
      method: 'PUT',
      headers,
      body: newData,
      throw: false
    });

    if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
      throw new Error(`Update VTODO failed: ${response.status}`);
    }

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

    const response = await this.httpClient.request({
      url: vtodo.url,
      method: 'DELETE',
      headers,
      throw: false
    });

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Delete VTODO failed: ${response.status}`);
    }

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
