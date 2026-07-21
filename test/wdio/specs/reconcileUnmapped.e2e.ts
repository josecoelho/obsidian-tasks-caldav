import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendarUrl, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos, countVtodos } from '../helpers/calendarQuery';
import { appendTaskLine, replaceInFile } from '../helpers/vaultEdit';

/**
 * Regression for the amplifying-duplication loop (unmapped vault task).
 *
 * When a vault task's id drifts out of the id-mapping (interrupted sync, backup
 * restore, multi-device), its content-identical CalDAV counterpart is still in
 * the baseline mapped to the now-absent old id. Before the fix, `reconcileOrphans`
 * excluded baselined CalDAV tasks from the reconcile pool, so the unmapped vault
 * task had nothing to pair with and the diff emitted a CalDAV `create` (a fresh
 * server duplicate) plus a `delete` of the original — churning the server object
 * identity and disabling the de-duplication net exactly when divergence occurs.
 * The fix reconciles the drifted vault task to the existing server VTODO instead.
 *
 * We drift the id in the markdown (leaving mapping + baseline pinned to the old
 * id) to recreate the exact precondition, then re-sync. The decisive assertion is
 * that the server VTODO's UID is PRESERVED across the re-sync: reconcile leaves it
 * untouched, whereas the pre-fix delete+create replaces it with a new UID. The
 * count staying at 1 guards the visible duplicate.
 */
describe('reconcile unmapped vault task', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendarUrl(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  function uidOf(ical: string): string {
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');
    const match = unfolded.match(/^UID:(.+)$/m);
    if (!match) throw new Error(`could not parse UID from server response:\n${ical}`);
    return match[1].trim();
  }

  async function taskIdInCache(title: string): Promise<string | undefined> {
    return await browser.executeObsidian(({ app }, t) => {
      const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
      const task = tp.getTasks().find((x: any) => x.description.includes(t));
      return task?.id as string | undefined;
    }, title);
  }

  it('reconciles a drifted-id vault task to the existing server VTODO instead of duplicating', async function () {
    const title = `Buy milk ${Date.now()}`;

    // Phase 1: create in Obsidian, sync, and confirm one server VTODO exists.
    await appendTaskLine('Tasks.md', `- [ ] ${title} #sync`);
    await waitForTaskInCache(title);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(title),
      { timeout: 15000, interval: 500, timeoutMsg: `"${title}" never reached the server` });

    const originalId = await taskIdInCache(title);
    if (!originalId) throw new Error('task never received a stable id after first sync');
    const originalUid = uidOf(await fetchVtodos(calendarName));

    // Phase 2: drift the vault task's id out of the id-mapping. Mapping and
    // baseline stay pinned to `originalId`; the vault now carries `driftedId`.
    const driftedId = `${originalId.replace(/-.*$/, '')}-dead`;
    await replaceInFile('Tasks.md', `🆔 ${originalId}`, `🆔 ${driftedId}`);
    await browser.waitUntil(async () => (await taskIdInCache(title)) === driftedId,
      { timeout: 20000, interval: 500, timeoutMsg: 'obsidian-tasks never re-indexed the drifted id' });

    // Phase 3: re-sync. The unmapped vault task must reconcile to the existing
    // VTODO, not spawn a duplicate.
    await syncNow();

    const ical = await fetchVtodos(calendarName);
    expect(countVtodos(ical)).toBe(1);
    // The surviving VTODO must be the ORIGINAL one (reconcile), not a recreated
    // copy under a new UID (the pre-fix delete+create behavior).
    expect(uidOf(ical)).toBe(originalUid);
  });
});
