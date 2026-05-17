import { FetchHttpClient } from './fetchHttpClient';
import * as crypto from 'crypto';

export const BAIKAL = {
  baseUrl: 'http://localhost:8081',
  davUrl: 'http://localhost:8081/dav.php',
  username: 'admin',
  password: 'admin',
} as const;

const http = new FetchHttpClient();

function authHeader(): Record<string, string> {
  const encoded = Buffer.from(`${BAIKAL.username}:${BAIKAL.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function calendarUrl(name: string): string {
  return `${BAIKAL.davUrl}/calendars/${BAIKAL.username}/${name}/`;
}

async function createCalendar(name: string): Promise<void> {
  const resp = await http.request({
    url: calendarUrl(name),
    method: 'MKCALENDAR',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${name}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VTODO" />
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>`,
  });

  if (resp.status !== 201 && resp.status !== 207) {
    throw new Error(`MKCALENDAR failed: ${resp.status} ${resp.text}`);
  }
}

async function clearCalendarContents(name: string): Promise<void> {
  const calUrl = calendarUrl(name);

  const listResp = await http.request({
    url: calUrl,
    method: 'PROPFIND',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '1',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:getetag /></d:prop>
</d:propfind>`,
  });

  if (listResp.status !== 207) return;

  const hrefMatches = [...listResp.text.matchAll(/<(?:\w+:)?href>([^<]+\.ics)<\/(?:\w+:)?href>/g)];
  for (const match of hrefMatches) {
    await http.request({
      url: `${BAIKAL.baseUrl}${match[1]}`,
      method: 'DELETE',
      headers: authHeader(),
    });
  }
}

async function deleteCalendar(name: string): Promise<void> {
  await http.request({
    url: calendarUrl(name),
    method: 'DELETE',
    headers: authHeader(),
  });
}

/**
 * Create an isolated test calendar with a random name.
 * Returns the calendar name and cleanup functions.
 */
export async function createIsolatedCalendar(): Promise<{
  calendarName: string;
  clean: () => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  const calendarName = `e2e-${crypto.randomBytes(6).toString('hex')}`;
  await createCalendar(calendarName);
  return {
    calendarName,
    /** Clear all VTODOs from the calendar (use in beforeEach). */
    clean: () => clearCalendarContents(calendarName),
    /** Delete the calendar (use in afterAll). */
    cleanup: () => deleteCalendar(calendarName),
  };
}
