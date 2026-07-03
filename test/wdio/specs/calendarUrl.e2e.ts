import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, pinCalendarUrl, calendarUrlFor, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos, countVtodos } from '../helpers/calendarQuery';
import { appendTaskLine, replaceInFile, setFileContent } from '../helpers/vaultEdit';

// The pure URL-pinned round-trip is already covered by the existing specs
// (obsidianToCaldav, caldavToObsidian, bidirectionalUpdate, …) which now all run
// via `useCalendarUrl`. What those don't cover is the *upgrade* from a legacy
// name-based config to a pinned URL — the scenario where a real user adopts the
// new setting — so that is what this spec verifies.

describe('upgrading a legacy calendar to a URL', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    // These specs assert exact VTODO counts, so each test needs an isolated
    // calendar AND a clean Tasks.md — the file (and the obsidian-tasks cache)
    // is shared across `it` blocks within this one Obsidian session.
    await setFileContent('Tasks.md', '# Tasks\n');
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
  });

  afterEach(async function () { await cleanup?.(); });

  it('keeps exactly one VTODO after pinning the URL (baseline preserved, no re-sync)', async function () {
    // Phase 1: legacy name-based config syncs a task to the server.
    await useCalendar(calendarName);
    const title = `Migrate ${Date.now()}`;
    await appendTaskLine('Tasks.md', `- [ ] ${title} #sync`);
    await waitForTaskInCache(title);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(title),
      { timeout: 15000, interval: 500, timeoutMsg: `legacy sync: "${title}" not on server` });
    expect(countVtodos(await fetchVtodos(calendarName))).toBe(1);

    // Phase 2: upgrade by pinning the calendar's URL. serverUrl + calendarName
    // are kept (as the settings UI does), so the storage key — and thus the
    // baseline — is unchanged. No duplicate, no re-create: still one VTODO.
    await pinCalendarUrl(calendarUrlFor(calendarName));
    await syncNow();

    const afterUpgrade = await fetchVtodos(calendarName);
    expect(countVtodos(afterUpgrade)).toBe(1);
    expect(afterUpgrade).toContain(title);
  });

  it('keeps syncing after the upgrade: an Obsidian edit becomes an update, not a duplicate', async function () {
    await useCalendar(calendarName);
    const title = `Edit ${Date.now()}`;
    await appendTaskLine('Tasks.md', `- [ ] ${title} #sync`);
    await waitForTaskInCache(title);
    await syncNow();
    await browser.waitUntil(async () => (await fetchVtodos(calendarName)).includes(title),
      { timeout: 15000, interval: 500, timeoutMsg: `legacy sync: "${title}" not on server` });

    await pinCalendarUrl(calendarUrlFor(calendarName));
    const edited = `${title} EDITED`;
    await replaceInFile('Tasks.md', title, edited);
    await waitForTaskInCache(edited);
    await syncNow();

    await browser.waitUntil(async () => {
      const ical = await fetchVtodos(calendarName);
      return ical.includes(edited) && countVtodos(ical) === 1;
    }, { timeout: 15000, interval: 500, timeoutMsg: 'edit after upgrade not reflected as a single updated VTODO' });
  });
});
