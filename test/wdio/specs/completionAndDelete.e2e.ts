import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { appendTaskLine, replaceInFile, removeLineContaining } from '../helpers/vaultEdit';

describe('completion and delete', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('propagates completion, then propagates an Obsidian-side delete to the server', async function () {
    const title = `Submit report ${Date.now()}`;

    await appendTaskLine('Tasks.md', `- [ ] ${title} #sync`);
    await waitForTaskInCache(title);
    await syncNow();

    // title precedes the plugin-appended 🆔 id and #sync tag, so this substring stays valid after write-back
    await replaceInFile('Tasks.md', `- [ ] ${title}`, `- [x] ${title}`);
    await waitForTaskInCache(title);
    await syncNow();
    await browser.waitUntil(async () => {
      const ical = await fetchVtodos(calendarName);
      return ical.includes(title) && /STATUS:COMPLETED/.test(ical);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'completion not propagated to server' });

    await removeLineContaining('Tasks.md', title);
    await browser.waitUntil(async () => {
      const present = await browser.executeObsidian(({ app }, t) => {
        const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
        return tp.getTasks().some((x: any) => x.description.includes(t));
      }, title);
      return !present;
    }, { timeout: 15000, interval: 500, timeoutMsg: `task "${title}" still in obsidian-tasks cache after delete` });
    await syncNow();

    await browser.waitUntil(async () => !(await fetchVtodos(calendarName)).includes(title),
      { timeout: 15000, interval: 500, timeoutMsg: 'delete not propagated to server' });
  });
});
