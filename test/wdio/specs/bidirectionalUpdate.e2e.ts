import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';
import { appendTaskLine, replaceInFile } from '../helpers/vaultEdit';

describe('bidirectional update', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('propagates an Obsidian edit to the server, then a server completion back', async function () {
    const original = `Plan trip ${Date.now()}`;
    const edited = `${original} EDITED`;

    // Phase 1: Create task in Obsidian and verify it lands on server
    await appendTaskLine('Tasks.md', `- [ ] ${original} #sync`);
    await waitForTaskInCache(original);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(original),
      { timeout: 15000, interval: 500, timeoutMsg: `original "${original}" not on server` });

    // Phase 2: Edit task in Obsidian and verify the update propagates to server
    await replaceInFile('Tasks.md', original, edited);
    await waitForTaskInCache(edited);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(edited),
      { timeout: 15000, interval: 500, timeoutMsg: `edited "${edited}" not on server` });

    // Phase 3: Complete task on server and verify completion reflects in Obsidian
    const ical = await fetchVtodos(calendarName);
    // fetchVtodos returns the REPORT multistatus body; unfold RFC5545 folded
    // lines the same way the production VTODOMapper.unfold does before matching.
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const uidMatch = unfolded.match(/^UID:(.+)$/m);
    if (!uidMatch) throw new Error(`could not parse UID from server response:\n${ical}`);
    const uid = uidMatch[1].trim();
    // Replace the server VTODO with a completed minimal copy (UID + CATEGORIES:sync
    // preserved). UID is the sync join key, so this exercises completion propagation;
    // it is a replacement, not an in-place field-preserving mutation.
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, edited, { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' }));
    await syncNow();

    await browser.waitUntil(async () => {
      const tasks = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Tasks.md');
        return f ? app.vault.read(f as any) : '';
      });
      return tasks.includes(edited) && /- \[x\][^\n]*EDITED/.test(tasks);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'server completion not reflected in Tasks.md' });
  });
});
