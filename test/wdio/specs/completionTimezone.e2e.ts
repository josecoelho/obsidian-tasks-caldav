import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, syncNow } from '../helpers/pluginConfig';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';

// Regression for issue #43, exercised in the real Obsidian/Electron process.
// The suite is pinned to Pacific/Auckland (UTC+13 in January) via wdio.conf.mts.
//
// A task completed late on the previous UTC day is still "today" locally.
// COMPLETED:20250114T220000Z == 2025-01-15 11:00 in Auckland, so the Obsidian
// task must show ✅ 2025-01-15 (local date), not ✅ 2025-01-14 (the UTC date
// that the old split('T')[0] produced).
describe('completion date timezone (#43)', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('renders an externally-completed task with the local date, not the UTC date', async function () {
    // Guard: the fix is only meaningfully exercised if Electron honors the
    // pinned non-UTC zone. If it doesn't, fail loudly rather than vacuously.
    const offsetMinutes = await browser.executeObsidian(() => new Date().getTimezoneOffset());
    if (offsetMinutes === 0) {
      throw new Error('Electron is running in UTC; cannot exercise the #43 timezone bug. Set TZ.');
    }

    const uid = `wdio-tz-${Date.now()}`;
    const summary = `Completed abroad ${Date.now()}`;
    const ics = buildVtodoIcs(uid, summary, {
      STATUS: 'COMPLETED',
      COMPLETED: '20250114T220000Z',
    });
    await putVtodo(calendarName, uid, ics);

    await syncNow();

    await browser.waitUntil(async () => {
      const inbox = await browser.executeObsidian(async ({ app }) => {
        const f = app.vault.getAbstractFileByPath('Inbox.md');
        return f ? app.vault.read(f as any) : '';
      });
      return inbox.includes(summary) && inbox.includes('✅ 2025-01-15');
    }, { timeout: 15000, interval: 500, timeoutMsg: `task "${summary}" not written with ✅ 2025-01-15` });

    const inbox = await browser.executeObsidian(async ({ app }) => {
      const f = app.vault.getAbstractFileByPath('Inbox.md');
      return f ? app.vault.read(f as any) : '';
    });
    expect(inbox).not.toContain('✅ 2025-01-14');
  });
});
