import { browser } from '@wdio/globals';
import { FetchHttpClient } from '../../helpers/fetchHttpClient';
import { createIsolatedCalendar, RADICALE } from '../../helpers/radicaleSetup';
import { useCalendar, syncNow } from '../helpers/pluginConfig';

const http = new FetchHttpClient();

describe('CalDAV -> Obsidian create', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('writes a task line into the vault for a server VTODO', async function () {
    const uid = `wdio-${Date.now()}`;
    const summary = `Server task ${Date.now()}`;
    // CATEGORIES:sync is required — CalDAVAdapter.filterByTag drops tasks without the calendar's sync tag.
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//wdio//EN',
      'BEGIN:VTODO', `UID:${uid}`, `SUMMARY:${summary}`,
      'STATUS:NEEDS-ACTION', 'CATEGORIES:sync', 'END:VTODO', 'END:VCALENDAR',
    ].join('\r\n');

    const put = await http.request({
      url: `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/${uid}.ics`,
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: ics,
    });
    if (![201, 204].includes(put.status)) {
      throw new Error(`PUT failed: ${put.status} ${put.text}`);
    }

    await syncNow();

    await browser.waitUntil(async () => {
      const inbox = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Inbox.md');
        return f ? app.vault.read(f as any) : '';
      });
      return inbox.includes(summary);
    }, { timeout: 15000, interval: 1000, timeoutMsg: `task "${summary}" not written to Inbox.md` });
  });
});
