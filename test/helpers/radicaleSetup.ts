import { FetchHttpClient } from './fetchHttpClient';

export const RADICALE = {
  baseUrl: 'http://localhost:5232',
  username: 'testuser',
  password: 'testpass',
  calendarName: 'e2e-tasks',
  get userPath() {
    return `/${this.username}/`;
  },
  get calendarPath() {
    return `/${this.username}/${this.calendarName}/`;
  },
  get calendarUrl() {
    return `${this.baseUrl}${this.calendarPath}`;
  },
} as const;

const http = new FetchHttpClient();

/**
 * Ensure the parent user collection exists (Radicale requires it).
 */
async function ensureUserCollection(): Promise<void> {
  const url = `${RADICALE.baseUrl}${RADICALE.userPath}`;
  const check = await http.request({
    url,
    method: 'PROPFIND',
    headers: { 'Depth': '0' },
  });
  if (check.status === 207) return;

  await http.request({ url, method: 'MKCOL', headers: {} });
}

/**
 * Create the test calendar via MKCALENDAR if it doesn't already exist.
 */
export async function ensureCalendarExists(): Promise<void> {
  await ensureUserCollection();

  const url = RADICALE.calendarUrl;

  // Check if calendar already exists
  const check = await http.request({
    url,
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Depth': '0',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:resourcetype /></d:prop>
</d:propfind>`,
  });

  if (check.status === 207) {
    return; // already exists
  }

  // Create the calendar
  const resp = await http.request({
    url,
    method: 'MKCALENDAR',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${RADICALE.calendarName}</d:displayname>
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
 * Delete the test calendar and recreate it empty.
 */
export async function cleanCalendar(): Promise<void> {
  await http.request({
    url: RADICALE.calendarUrl,
    method: 'DELETE',
    headers: {},
  });

  await ensureCalendarExists();
}
