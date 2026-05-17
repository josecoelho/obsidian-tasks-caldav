import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { RADICALE } from '../../helpers/radicaleSetup';

const http = new FetchHttpClient();

/** Build a minimal RFC-5545 VCALENDAR wrapping one VTODO.
 *  CATEGORIES:sync is included by default — required by CalDAVAdapter.filterByTag,
 *  which drops server tasks lacking the calendar's sync tag. Pass overrides to
 *  add or replace VTODO properties (e.g. { STATUS: 'COMPLETED' }). */
export function buildVtodoIcs(
  uid: string,
  summary: string,
  overrides: Record<string, string> = {},
): string {
  const props: Record<string, string> = {
    UID: uid,
    SUMMARY: summary,
    STATUS: 'NEEDS-ACTION',
    CATEGORIES: 'sync',
    ...overrides,
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wdio//EN',
    'BEGIN:VTODO',
    ...Object.entries(props).map(([k, v]) => `${k}:${v}`),
    'END:VTODO',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** PUT a VTODO to Radicale. Throws on non-2xx. Returns the HTTP status. */
export async function putVtodo(
  calendarName: string,
  uid: string,
  ics: string,
): Promise<number> {
  const res = await http.request({
    url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/${uid}.ics`,
    method: 'PUT',
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
    body: ics,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`PUT ${uid}.ics failed: ${res.status} ${res.text}`);
  }
  return res.status;
}
