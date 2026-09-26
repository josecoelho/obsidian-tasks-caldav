import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';
import { appendTaskLine, setFileContent } from '../helpers/vaultEdit';

/** Read a vault file's full text (empty string if missing). */
async function readVaultFile(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, p) => {
    const f = app.vault.getAbstractFileByPath(p);
    return f ? app.vault.read(f as any) : '';
  }, path);
}

/**
 * Issue #136: a tag (CATEGORIES) added to a task from an external CalDAV client
 * must propagate back into the Obsidian markdown on the next sync. This is the
 * server -> Obsidian (pull) direction; the write step (toMarkdown / vault write)
 * is only exercisable in a real Obsidian instance, so it lives here in wdio.
 */
describe('tag pull (issue #136)', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
    // Shared vault across it() blocks — start each case from a clean Tasks.md.
    await setFileContent('Tasks.md', '# Tasks\n');
  });

  afterEach(async function () { await cleanup?.(); });

  it('propagates a server-added category to an existing vault task (update pull)', async function () {
    const summary = `Buy milk ${Date.now()}`;

    // Phase 1: create the task in Obsidian and push it to the server.
    await appendTaskLine('Tasks.md', `- [ ] ${summary} #sync`);
    await waitForTaskInCache(summary);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(summary),
      { timeout: 15000, interval: 500, timeoutMsg: `"${summary}" never reached the server` });

    // Phase 2: an external client adds the "urgent" category to that VTODO.
    // Replace the server object with a copy that preserves the UID (the sync
    // join key) but carries CATEGORIES:sync,urgent.
    const ical = await fetchVtodos(calendarName);
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const uidMatch = unfolded.match(/^UID:(.+)$/m);
    if (!uidMatch) throw new Error(`could not parse UID from server response:\n${ical}`);
    const uid = uidMatch[1].trim();
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, summary, { CATEGORIES: 'sync,urgent' }));

    // Phase 3: sync should pull the new tag into the vault line.
    await syncNow();

    await browser.waitUntil(async () => {
      const tasks = await readVaultFile('Tasks.md');
      const line = tasks.split('\n').find((l: string) => l.includes(summary)) ?? '';
      return line.includes('#urgent');
    }, {
      timeout: 15000,
      interval: 500,
      timeoutMsg: `#urgent (server-added category) never appeared on "${summary}" in Tasks.md`,
    });
  });

  it('writes a server category onto a brand-new pulled task (create pull)', async function () {
    const uid = `wdio-tagpull-${Date.now()}`;
    const summary = `Server tagged task ${Date.now()}`;

    // A server-only VTODO that already carries a user category.
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, summary, { CATEGORIES: 'sync,urgent' }));

    await syncNow();

    await browser.waitUntil(async () => {
      const inbox = await readVaultFile('Inbox.md');
      const line = inbox.split('\n').find((l: string) => l.includes(summary)) ?? '';
      return line.includes('#urgent');
    }, {
      timeout: 15000,
      interval: 500,
      timeoutMsg: `#urgent never appeared on newly pulled "${summary}" in Inbox.md`,
    });
  });
});
