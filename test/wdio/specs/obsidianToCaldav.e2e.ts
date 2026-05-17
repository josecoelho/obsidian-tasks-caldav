import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { appendTaskLine } from '../helpers/vaultEdit';

describe('Obsidian -> CalDAV create', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('creates a VTODO on the server for a tagged task', async function () {
    const title = `Buy milk ${Date.now()}`;
    await appendTaskLine('Tasks.md', `- [ ] ${title} #sync`);

    await waitForTaskInCache(title);
    await syncNow();

    await browser.waitUntil(async () => {
      return (await fetchVtodos(calendarName)).includes(title);
    }, { timeout: 15000, interval: 500, timeoutMsg: `VTODO for "${title}" not found on server` });
  });
});
