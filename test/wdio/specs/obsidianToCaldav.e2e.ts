import { browser } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

describe('Obsidian -> CalDAV create', function () {
  let calendarName: string;
  let cleanup: () => Promise<void>;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup(); });

  it('creates a VTODO on the server for a tagged task', async function () {
    const title = `Buy milk ${Date.now()}`;
    await browser.executeObsidian(async ({ app }, t) => {
      const file = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(file as any);
      await app.vault.modify(file as any, body + `\n- [ ] ${t} #sync`);
    }, title);

    await waitForTaskInCache(title);
    await syncNow();

    await browser.waitUntil(async () => {
      const res = await http.request({
        url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`,
        method: 'REPORT',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1',
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
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
</c:calendar-query>`,
      });
      return res.status === 207 && res.text.includes(title);
    }, { timeout: 15000, interval: 1000, timeoutMsg: `VTODO for "${title}" not found on server` });
  });
});
