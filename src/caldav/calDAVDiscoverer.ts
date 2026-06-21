import { HttpClient, ObsidianHttpClient } from './httpClient';
import { PROPFIND_PRINCIPAL, PROPFIND_CALENDAR_HOME, PROPFIND_CALENDARS } from './templates';
import { resolveUrl } from './resolveUrl';

/** A calendar collection discovered on the server. */
export interface CalendarInfo {
  url: string;
  displayName: string;
  supportsVTODO: boolean;
}

/**
 * Server-scoped CalDAV discovery: given a server base URL + credentials, find
 * the calendars in the user's calendar home (well-known → principal →
 * calendar-home-set → list). Used by the "Browse calendars" UI and by the
 * client's legacy name-match resolution.
 *
 * This is separate from {@link CalDAVClientDirect}, which talks to a single
 * already-known calendar URL.
 */
export class CalDAVDiscoverer {
  private serverUrl: string;
  private authHeader: string;
  private httpClient: HttpClient;

  constructor(serverUrl: string, username: string, password: string, httpClient?: HttpClient) {
    this.serverUrl = serverUrl;
    this.authHeader = 'Basic ' + btoa(`${username}:${password}`);
    this.httpClient = httpClient ?? new ObsidianHttpClient();
  }

  /** Discover and return every calendar in the user's calendar home. */
  async listCalendars(): Promise<CalendarInfo[]> {
    const homeUrl = await this.discoverCalendarHome();
    return this.findCalendars(homeUrl);
  }

  /**
   * Discover the calendar home URL using well-known or PROPFIND.
   */
  private async discoverCalendarHome(): Promise<string> {
    // Try well-known CalDAV endpoint first (RFC 6764)
    const wellKnownUrl = resolveUrl('/.well-known/caldav', this.serverUrl);

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
      url: this.serverUrl,
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

    return await this.discoverFromPrincipal(response.text, this.serverUrl);
  }

  /**
   * Discover calendar home from principal URL.
   */
  private async discoverFromPrincipal(propfindResponse: string, contextUrl: string): Promise<string> {
    const principalHref = CalDAVDiscoverer.parseHrefForProperty(propfindResponse, 'current-user-principal');
    if (!principalHref) {
      throw new Error('Could not find current-user-principal in response');
    }

    const principalUrl = resolveUrl(principalHref, contextUrl);

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

    const homeHref = CalDAVDiscoverer.parseHrefForProperty(calendarHomeResponse.text, 'calendar-home-set');
    if (!homeHref) {
      throw new Error('Could not find calendar-home-set in principal response');
    }

    return resolveUrl(homeHref, principalUrl);
  }

  /**
   * Find all calendars in the calendar home.
   */
  private async findCalendars(homeUrl: string): Promise<CalendarInfo[]> {
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

    return CalDAVDiscoverer.parseCalendarsFromXML(response.text, homeUrl);
  }

  /**
   * Extract the href of a DAV/CalDAV property from a PROPFIND response.
   *
   * Tolerates any namespace prefix and inline `xmlns` declarations on both the
   * property element and its `href` child. SabreDAV-based servers (Baïkal)
   * declare the CalDAV namespace inline on `calendar-home-set` rather than at
   * the document root, which a prefix-only matcher misses (issue #71).
   *
   * Returns the raw href string, or null if the property is absent.
   */
  static parseHrefForProperty(xmlText: string, property: string): string | null {
    const tag = `(?:\\w+:)?${property}(?:\\s[^>]*)?`;
    const href = '(?:\\w+:)?href(?:\\s[^>]*)?';
    const regex = new RegExp(`<${tag}>\\s*<${href}>([^<]+)<\\/(?:\\w+:)?href>`);
    const match = xmlText.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Parse calendars from a PROPFIND XML response (static for testing).
   */
  static parseCalendarsFromXML(xmlText: string, contextUrl: string): CalendarInfo[] {
    const calendars: CalendarInfo[] = [];
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

      const url = resolveUrl(hrefMatch[1], contextUrl);

      // Extract display name (handle CDATA, any namespace prefix)
      const nameMatch = responseBlock.match(/<(?:\w+:)?displayname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/(?:\w+:)?displayname>/);
      const displayName = nameMatch ? nameMatch[1].trim() : url;

      // Check if calendar supports VTODO (any namespace prefix, case-insensitive)
      const supportsVTODO = /< ?\w*:?comp name="VTODO"/i.test(responseBlock);

      calendars.push({ url, displayName, supportsVTODO });
    }

    return calendars;
  }
}
