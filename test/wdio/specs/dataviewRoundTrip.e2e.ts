import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';
import { appendTaskLine, replaceInFile } from '../helpers/vaultEdit';
import { openDataviewVault } from '../helpers/dataviewVault';

async function readFile(filePath: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, p) => {
    const f = app.vault.getAbstractFileByPath(p);
    return f ? app.vault.read(f as Parameters<typeof app.vault.read>[0]) : '';
  }, filePath);
}

describe('dataview full round-trip', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  before(async function () {
    await openDataviewVault();
  });

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('syncs Obsidian<->CalDAV with obsidian-tasks in dataview format', async function () {
    const original = `Plan trip ${Date.now()}`;
    const edited = `${original} EDITED`;

    // Phase 1: create in Obsidian -> server
    await appendTaskLine('Tasks.md', `- [ ] ${original} #sync`);
    await waitForTaskInCache(original);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(original),
      { timeout: 15000, interval: 500, timeoutMsg: `original "${original}" not on server` });

    // Phase 2: write-back used dataview, not emoji
    await browser.waitUntil(async () => {
      const tasks = await readFile('Tasks.md');
      return tasks.includes(original) && tasks.includes('[id:: ') && !tasks.includes('🆔');
    }, { timeout: 15000, interval: 500, timeoutMsg: 'write-back did not use dataview format ([id:: ] expected, 🆔 absent)' });

    // Phase 3: edit in Obsidian -> server
    await replaceInFile('Tasks.md', original, edited);
    await waitForTaskInCache(edited);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(edited),
      { timeout: 15000, interval: 500, timeoutMsg: `edited "${edited}" not on server` });

    // Phase 4: complete on server -> Obsidian, still dataview
    const ical = await fetchVtodos(calendarName);
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const uidMatch = unfolded.match(/^UID:(.+)$/m);
    if (!uidMatch) throw new Error(`could not parse UID from server response:\n${ical}`);
    const uid = uidMatch[1].trim();
    await putVtodo(calendarName, uid, buildVtodoIcs(uid, edited, { STATUS: 'COMPLETED', 'PERCENT-COMPLETE': '100' }));
    await syncNow();

    await browser.waitUntil(async () => {
      const tasks = await readFile('Tasks.md');
      return /- \[x\][^\n]*EDITED/.test(tasks) && tasks.includes('[id:: ') && !tasks.includes('🆔');
    }, { timeout: 15000, interval: 500, timeoutMsg: 'server completion not reflected in dataview format' });
  });
});
