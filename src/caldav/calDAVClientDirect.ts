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
   * Parse VTODOs from a WebDAV multistatus (calendar-query) XML response.
   *
   * Uses the platform `DOMParser` (native in Electron; shimmed in Node tests),
   * so namespaces, CDATA, and XML entities are decoded by the parser itself
   * rather than by hand-rolled regex. Element lookup is namespace-prefix-agnostic
   * (`d:`/`D:`/`c:`/`C:`/none) via `getElementsByTagNameNS('*', …)`. A response
   * missing an `href` or `calendar-data` is skipped, and malformed XML yields an
   * empty result instead of throwing. Static for testing.
   */
  static parseVTODOsFromXML(xmlText: string, contextUrl: string): CalendarObject[] {
    const doc = parseXmlDocument(xmlText);
    if (!doc) return [];

    const vtodos: CalendarObject[] = [];
    const responses = doc.getElementsByTagNameNS('*', 'response');

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];

      const href = firstChildText(response, 'href');
      // Skip tombstone/error responses that carry an empty or self-closing
      // <calendar-data/> (e.g. Vikunja's post-delete multistatus). Their
      // textContent is '' — present but not a VTODO — so a bare presence check
      // would emit a phantom object.
      const calendarData = firstChildText(response, 'calendar-data')?.trim();
      if (!href || !calendarData) continue;

      vtodos.push({
        url: resolveUrl(href, contextUrl),
        data: calendarData,
        etag: stripQuotes(firstChildText(response, 'getetag')),
      });
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
      throw new Error(`Create VTODO failed: ${response.status} for ${uid} at ${url} ${response.text}`);
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
 * Parse a WebDAV XML payload into a document, returning null on any failure.
 * `DOMParser` implementations diverge on malformed input: Electron's native
 * parser returns a document containing a `<parsererror>` element, while
 * `@xmldom/xmldom` (used in tests) throws. Handle both so a bad response never
 * propagates an exception — matching the previous regex parser's resilience.
 */
function parseXmlDocument(xmlText: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Text content of the first descendant element with the given local name,
 * across any namespace prefix. Returns undefined when absent.
 */
function firstChildText(element: Element, localName: string): string | undefined {
  const match = element.getElementsByTagNameNS('*', localName)[0];
  return match ? match.textContent ?? undefined : undefined;
}

/**
 * Strip surrounding quotes from an etag value. Nextcloud XML-encodes them as
 * `&quot;` (decoded to `"` by the parser); other servers use literal quotes.
 */
function stripQuotes(value: string | undefined): string | undefined {
  return value?.replace(/"/g, '');
}
