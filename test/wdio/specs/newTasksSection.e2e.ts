import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, syncNow } from '../helpers/pluginConfig';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';
import { setFileContent } from '../helpers/vaultEdit';

async function readVaultFile(filePath: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, args) => {
    const f = app.vault.getAbstractFileByPath(args.filePath);
    return f ? app.vault.read(f as any) : '';
  }, { filePath });
}

describe('new tasks section setting', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
    await setFileContent('Inbox.md', '# Inbox\n\n## Incoming\n\n## Done\n');
  });

  afterEach(async function () {
    await browser.executeObsidian(async ({ app }) => {
      const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
      plugin.settings.newTasksSection = undefined;
      await plugin.saveSettings();
    });
    await setFileContent('Inbox.md', '# Inbox\n');
    await cleanup?.();
  });

  it('inserts new tasks under the configured heading instead of appending to end of file', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
      plugin.settings.newTasksSection = 'Incoming';
      await plugin.saveSettings();
    });

    const uid = `wdio-section-${Date.now()}`;
    const summary = `Section task ${Date.now()}`;
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, summary));

    await syncNow();

    await browser.waitUntil(async () => {
      const content = await readVaultFile('Inbox.md');
      return content.includes(summary);
    }, { timeout: 15000, interval: 500, timeoutMsg: `task "${summary}" not written to Inbox.md` });

    const content = await readVaultFile('Inbox.md');
    const incomingPos = content.indexOf('## Incoming');
    const donePos = content.indexOf('## Done');
    const taskPos = content.indexOf(summary);

    // Task must be between the two headings — not appended after "## Done"
    expect(taskPos).toBeGreaterThan(incomingPos);
    expect(taskPos).toBeLessThan(donePos);
  });
});
