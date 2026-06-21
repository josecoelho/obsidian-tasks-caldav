import { VTODOMapper, CalendarObject } from './vtodoMapper';
import { HttpClient, ObsidianHttpClient } from './httpClient';
import { REPORT_VTODOS } from './templates';
import { resolveUrl } from './resolveUrl';
import { CalDAVDiscoverer } from './calDAVDiscoverer';

/**
 * How the client reaches a calendar. Two modes:
 *  - Pinned (primary): `calendarUrl` is set — talk to that collection directly.
 *  - Legacy discovery: `calendarUrl` is absent — discover calendars under
 *    `serverUrl` and match `calendarName` by display name.
 *
 * `serverUrl` / `calendarName` are used ONLY in the legacy discovery mode; they
 * are no longer settings fields and persist only for calendars configured before
 * URL pinning existed. (The "Browse calendars" UI does its own discovery via
 * {@link CalDAVDiscoverer} and does not go through this client.)
 */
export interface CalDAVConnectionConfig {
  username: string;
  password: string;
  /** Pinned mode: the exact calendar collection URL. Preferred. */
  calendarUrl?: string;
  /** Legacy discovery mode (used only when `calendarUrl` is absent). */
  serverUrl: string;
  calendarName: string;
}

/**
 * Interface for CalDAV client operations used by adapters.
 */
export interface CalDAVClient {
  connect(): Promise<void>;
  fetchVTODOs(): Promise<CalendarObject[]>;
  createVTODO(vtodoData: string, uid: string): Promise<void>;
  updateVTODO(vtodo: { data: string; url: string; etag?: string }, newData: string): Promise<void>;
  deleteVTODOByUID(uid: string): Promise<void>;
  fetchVTODOByUID(uid: string): Promise<{ data: string; url: string; etag?: string } | null>;
}

/**
 * Direct CalDAV client for a single calendar. After {@link connect} resolves the
 * calendar URL, it reads and writes VTODOs against that one collection.
 * Discovering which calendars exist on a server is a separate concern — see
 * {@link CalDAVDiscoverer}.
 *
 * Uses an HttpClient abstraction so the transport layer can be swapped
 * (ObsidianHttpClient in production, FetchHttpClient in E2E tests).
 */
export class CalDAVClientDirect implements CalDAVClient {
  private config: CalDAVConnectionConfig;
  private mapper: VTODOMapper;
  private calendarUrl: string | null = null;
  private authHeader: string;
  private httpClient: HttpClient;

  constructor(config: CalDAVConnectionConfig, httpClient?: HttpClient) {
    this.config = config;
    this.mapper = new VTODOMapper();
    this.httpClient = httpClient ?? new ObsidianHttpClient();

    const credentials = `${config.username}:${config.password}`;
    this.authHeader = 'Basic ' + btoa(credentials);
  }

  /**
   * Resolve the calendar URL this client will read from and write to. A pinned
   * `calendarUrl` is used as-is (no discovery); otherwise we fall back to legacy
   * discovery, matching the calendar by display name under the server URL.
   */
  async connect(): Promise<void> {
    try {
      this.calendarUrl = this.config.calendarUrl ?? await this.resolveCalendarByName();
    } catch (error) {
      console.error('[CalDAV] Connection failed:', error);
      throw error;
    }
  }

  /**
   * Legacy discovery: discover the calendars under `serverUrl` and return the
   * URL of the one whose display name matches `calendarName`. Only reached when
   * no `calendarUrl` is pinned.
   */
  private async resolveCalendarByName(): Promise<string> {
    const discoverer = new CalDAVDiscoverer(
      this.config.serverUrl,
      this.config.username,
      this.config.password,
      this.httpClient,
    );
    const calendars = await discoverer.listCalendars();
    const calendar = calendars.find(c => c.displayName === this.config.calendarName);
    if (!calendar) {
      throw new Error(`Calendar '${this.config.calendarName}' not found. Available: ${calendars.map(c => c.displayName).join(', ')}`);
    }
    return calendar.url;
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
  static parseVTODOsFromXML(xmlText: string, contextUrl: string): CalendarObject[] {
    const vtodos: CalendarObject[] = [];
    const responseRegex = /<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g;
    let match;

    while ((match = responseRegex.exec(xmlText)) !== null) {
      const responseBlock = match[1];

      // Extract href (any namespace prefix or none)
      const hrefMatch = responseBlock.match(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/);
      if (!hrefMatch) continue;

      const url = resolveUrl(hrefMatch[1], contextUrl);

      // Extract etag (any namespace prefix or none)
      // Nextcloud returns ETags with XML-encoded quotes: &quot;abc123&quot;
      const etagMatch = responseBlock.match(/<(?:\w+:)?getetag>([^<]+)<\/(?:\w+:)?getetag>/);
      const etag = etagMatch
        ? etagMatch[1].replace(/&quot;/g, '').replace(/"/g, '')
        : undefined;

      // Extract calendar data (VTODO) — handle optional CDATA wrapping, any namespace prefix
      const dataMatch = responseBlock.match(/<(?:\w+:)?calendar-data>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:\w+:)?calendar-data>/);
      if (!dataMatch) continue;

      const data = decodeXMLEntities(dataMatch[1].trim());

      vtodos.push({ data, url, etag });
    }

    return vtodos;
  }

  /**
   * Fetch all VTODOs from the calendar
   */
  async fetchVTODOs(): Promise<CalendarObject[]> {
    if (!this.calendarUrl) {
      throw new Error('Not connected to calendar server');
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

    return CalDAVClientDirect.parseVTODOsFromXML(response.text, this.calendarUrl);
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
      throw new Error('Not connected to calendar server');
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
        message: `Successfully connected to calendar '${this.config.calendarName || this.config.calendarUrl || 'server'}'`
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

/**
 * Decode XML character entities in calendar-data.
 * Some servers (e.g. Vikunja) return iCal data with XML-escaped newlines
 * (&#xA;) instead of actual newlines or CDATA wrapping.
 */
function decodeXMLEntities(text: string): string {
  return text
    .replace(/&#xA;/g, '\n')
    .replace(/&#xD;/g, '\r')
    .replace(/&#x9;/g, '\t')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
