import { FetchHttpClient } from './fetchHttpClient';
import * as crypto from 'crypto';

export const NEXTCLOUD = {
  baseUrl: 'http://localhost:8080',
  davUrl: 'http://localhost:8080/remote.php/dav',
  username: 'admin',
  password: 'admin',
  get calendarPath() {
    return `/remote.php/dav/calendars/${this.username}/`;
  },
} as const;

const http = new FetchHttpClient();
const SQLITE_SETTLE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function authHeader(): Record<string, string> {
  const encoded = Buffer.from(`${NEXTCLOUD.username}:${NEXTCLOUD.password}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

async function createCalendar(name: string): Promise<void> {
  const url = `${NEXTCLOUD.baseUrl}/remote.php/dav/calendars/${NEXTCLOUD.username}/${name}/`;

  const check = await http.request({
    url,
    method: 'PROPFIND',
    headers: {
      ...authHeader(),
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '0',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:resourcetype /></d:prop>
</d:propfind>`,
  });

  if (check.status === 207) return;

  const resp = await http.request({
    url,
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

/**
 * Delete all VTODOs in a calendar without deleting the calendar itself.
 * Nextcloud moves deleted calendars to trash, so we clear contents instead.
 */
async function clearCalendarContents(name: string): Promise<void> {
  const calUrl = `${NEXTCLOUD.baseUrl}/remote.php/dav/calendars/${NEXTCLOUD.username}/${name}/`;

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
    const resourceUrl = `${NEXTCLOUD.baseUrl}${match[1]}`;
    await http.request({
      url: resourceUrl,
      method: 'DELETE',
      headers: authHeader(),
    });
  }

  // Nextcloud + SQLite needs time to release DB locks after deletes
  if (hrefMatches.length > 0) {
    await sleep(SQLITE_SETTLE_MS);
  }
}

async function deleteCalendar(name: string): Promise<void> {
  await http.request({
    url: `${NEXTCLOUD.baseUrl}/remote.php/dav/calendars/${NEXTCLOUD.username}/${name}/`,
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
