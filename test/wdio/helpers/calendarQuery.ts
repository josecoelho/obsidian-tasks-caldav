import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { RADICALE } from '../../helpers/radicaleSetup';
import { REPORT_VTODOS } from '../../../src/caldav/templates';

const http = new FetchHttpClient();

/** Fetch the raw iCal data for all VTODOs in a calendar via a CalDAV REPORT.
 *  Throws if the server does not return 207 Multi-Status. */
export async function fetchVtodos(calendarName: string): Promise<string> {
  const res = await http.request({
    url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`,
    method: 'REPORT',
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '1' },
    body: REPORT_VTODOS,
  });
  if (res.status !== 207) {
    throw new Error(`REPORT failed: ${res.status} ${res.text}`);
  }
  return res.text;
}
