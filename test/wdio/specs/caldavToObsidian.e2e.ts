import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, syncNow } from '../helpers/pluginConfig';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';

describe('CalDAV -> Obsidian create', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('writes a task line into the vault for a server VTODO', async function () {
    const uid = `wdio-${Date.now()}`;
    const summary = `Server task ${Date.now()}`;
    const ics = buildVtodoIcs(uid, summary);
    await putVtodo(calendarName, uid, ics);

    await syncNow();

    await browser.waitUntil(async () => {
      const inbox = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Inbox.md');
        return f ? app.vault.read(f as any) : '';
      });
      return inbox.includes(summary);
    }, { timeout: 15000, interval: 500, timeoutMsg: `task "${summary}" not written to Inbox.md` });
  });
});
