import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { appendTaskLine } from '../helpers/vaultEdit';

describe('subtask sync', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('parent with indented subtask syncs as nested CalDAV subtask', async function () {
    const ts = Date.now();
    const parentTitle = `Parent task ${ts}`;
    const childTitle = `Child task ${ts}`;

    // Write parent (carries sync tag) then indented child (inherits eligibility)
    await appendTaskLine('Tasks.md', `- [ ] ${parentTitle} #sync`);
    await appendTaskLine('Tasks.md', `    - [ ] ${childTitle}`);

    await waitForTaskInCache(parentTitle);
    await waitForTaskInCache(childTitle);
    await syncNow();

    // Wait until both VTODOs appear on the server
    await browser.waitUntil(async () => {
      const ical = await fetchVtodos(calendarName);
      return ical.includes(parentTitle) && ical.includes(childTitle);
    }, { timeout: 15000, interval: 500, timeoutMsg: `parent "${parentTitle}" or child "${childTitle}" not found on server` });

    // Parse the raw REPORT body to verify RELATED-TO points to the parent's UID
    const ical = await fetchVtodos(calendarName);
    // Unfold RFC 5545 folded lines (same as VTODOMapper.unfold)
    const unfolded = ical.replace(/\r?\n[ \t]/g, '');

    // Extract the UID of the parent VTODO (the VTODO whose SUMMARY contains parentTitle)
    const parentVtodoMatch = unfolded.match(/BEGIN:VTODO([\s\S]*?)END:VTODO/g)
      ?.find((block) => block.includes(parentTitle));
    if (!parentVtodoMatch) throw new Error(`could not find parent VTODO block in:\n${ical}`);
    const parentUidMatch = parentVtodoMatch.match(/^UID:(.+)$/m);
    if (!parentUidMatch) throw new Error(`could not parse UID from parent VTODO:\n${parentVtodoMatch}`);
    const parentUid = parentUidMatch[1].trim();

    // Find the child VTODO and assert it carries RELATED-TO;RELTYPE=PARENT:<parentUid>
    const childVtodoMatch = unfolded.match(/BEGIN:VTODO([\s\S]*?)END:VTODO/g)
      ?.find((block) => block.includes(childTitle));
    if (!childVtodoMatch) throw new Error(`could not find child VTODO block in:\n${ical}`);

    const relatedToLine = `RELATED-TO;RELTYPE=PARENT:${parentUid}`;
    if (!childVtodoMatch.includes(relatedToLine)) {
      throw new Error(`child VTODO does not contain ${relatedToLine}\nChild VTODO:\n${childVtodoMatch}`);
    }
  });
});
