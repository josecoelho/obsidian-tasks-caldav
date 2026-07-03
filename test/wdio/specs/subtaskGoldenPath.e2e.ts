import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { fetchVtodos } from '../helpers/calendarQuery';
import { buildVtodoIcs, putVtodo } from '../helpers/serverVtodo';

describe('subtask golden path', function () {
  let calendarName: string;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    calendarName = cal.calendarName;
    cleanup = cal.cleanup;
    await useCalendar(calendarName);
  });

  afterEach(async function () { await cleanup?.(); });

  it('parent + three subtasks: updates each side, then re-parent by indentation', async function () {
    const ts = Date.now();
    const parentTitle = `Parent task ${ts}`;
    const sub1Title   = `Sub one ${ts}`;
    const sub2Title   = `Sub two ${ts}`;
    const sub3Title   = `Sub three ${ts}`;
    const sub1Renamed = `Sub one renamed ${ts}`;
    const sub2Renamed = `Sub two renamed ${ts}`;

    // ── Step 1: Write the initial file ────────────────────────────────────────
    // Build the complete file content: parent (tagged) + three 4-space-indented children.
    // Use browser.executeObsidian + app.vault.modify to set the whole file at once,
    // matching the approach used when a structured multi-line block is needed.
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const content = [
        `- [ ] ${args.parentTitle} #sync`,
        `    - [ ] ${args.sub1Title}`,
        `    - [ ] ${args.sub2Title}`,
        `    - [ ] ${args.sub3Title}`,
      ].join('\n') + '\n';
      await app.vault.modify(f as any, content);
    }, { parentTitle, sub1Title, sub2Title, sub3Title });

    // ── Step 2: Wait for cache + first sync ───────────────────────────────────
    await waitForTaskInCache(parentTitle);
    await waitForTaskInCache(sub1Title);
    await waitForTaskInCache(sub2Title);
    await waitForTaskInCache(sub3Title);
    await syncNow();

    await browser.waitUntil(async () => {
      const ical = await fetchVtodos(calendarName);
      return (
        ical.includes(parentTitle) &&
        ical.includes(sub1Title) &&
        ical.includes(sub2Title) &&
        ical.includes(sub3Title)
      );
    }, { timeout: 20000, interval: 500, timeoutMsg: 'not all four VTODOs appeared on server after first sync' });

    // ── Step 3: Parse VTODOs and assert initial topology ──────────────────────
    const parseVtodos = (raw: string): Map<string, string> => {
      const unfolded = raw.replace(/\r?\n[ \t]/g, '');
      const blocks = unfolded.match(/BEGIN:VTODO[\s\S]*?END:VTODO/g) ?? [];
      const map = new Map<string, string>();
      for (const block of blocks) {
        const uidM = block.match(/^UID:(.+)$/m);
        const sumM = block.match(/^SUMMARY:(.+)$/m);
        if (uidM && sumM) map.set(sumM[1].trim(), block);
      }
      return map;
    };

    const getUid = (block: string): string => {
      const m = block.match(/^UID:(.+)$/m);
      if (!m) throw new Error(`No UID in block:\n${block}`);
      return m[1].trim();
    };

    let vtodos = parseVtodos(await fetchVtodos(calendarName));

    const parentBlock = vtodos.get(parentTitle);
    if (!parentBlock) throw new Error(`parent VTODO block not found for: ${parentTitle}`);
    const parentUid = getUid(parentBlock);

    const sub1Block0 = vtodos.get(sub1Title);
    if (!sub1Block0) throw new Error(`sub1 VTODO block not found for: ${sub1Title}`);
    const sub1Uid = getUid(sub1Block0);

    const sub2Block0 = vtodos.get(sub2Title);
    if (!sub2Block0) throw new Error(`sub2 VTODO block not found for: ${sub2Title}`);
    const sub2Uid = getUid(sub2Block0);

    const sub3Block0 = vtodos.get(sub3Title);
    if (!sub3Block0) throw new Error(`sub3 VTODO block not found for: ${sub3Title}`);
    const sub3Uid = getUid(sub3Block0);

    // All four UIDs must be distinct
    const allUids = new Set([parentUid, sub1Uid, sub2Uid, sub3Uid]);
    if (allUids.size !== 4) throw new Error(`Expected 4 distinct UIDs, got: ${JSON.stringify([...allUids])}`);

    // Each child must carry RELATED-TO;RELTYPE=PARENT:<parentUid>
    const parentRelLine = `RELATED-TO;RELTYPE=PARENT:${parentUid}`;
    for (const [title, block] of [[sub1Title, sub1Block0], [sub2Title, sub2Block0], [sub3Title, sub3Block0]] as const) {
      if (!block.includes(parentRelLine)) {
        throw new Error(`${title} VTODO missing "${parentRelLine}"\nBlock:\n${block}`);
      }
    }

    // ── Step 4: Obsidian-side update on Sub one ───────────────────────────────
    // replaceInFile replaces first occurrence of the title substring.
    // The 🆔 suffix added by writeBackIds comes AFTER the title, so matching on
    // the title text alone is safe.
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      await app.vault.modify(f as any, body.replace(args.sub1Title, args.sub1Renamed));
    }, { sub1Title, sub1Renamed });

    await waitForTaskInCache(sub1Renamed);
    await syncNow();

    await browser.waitUntil(async () => {
      return (await fetchVtodos(calendarName)).includes(sub1Renamed);
    }, { timeout: 20000, interval: 500, timeoutMsg: `sub1 renamed title "${sub1Renamed}" not on server` });

    vtodos = parseVtodos(await fetchVtodos(calendarName));

    // Sub one must use the SAME uid (update, not create)
    const sub1BlockA = vtodos.get(sub1Renamed);
    if (!sub1BlockA) throw new Error(`sub1 renamed VTODO not found for: ${sub1Renamed}`);
    if (getUid(sub1BlockA) !== sub1Uid) throw new Error(`sub1 UID changed during update: expected ${sub1Uid}, got ${getUid(sub1BlockA)}`);
    if (!sub1BlockA.includes(parentRelLine)) throw new Error(`sub1 RELATED-TO lost after rename. Block:\n${sub1BlockA}`);

    // Sub two and three titles unchanged
    if (!vtodos.has(sub2Title)) throw new Error(`sub2 title changed unexpectedly (expected: ${sub2Title})`);
    if (!vtodos.has(sub3Title)) throw new Error(`sub3 title changed unexpectedly (expected: ${sub3Title})`);

    // ── Step 5: CalDAV-side update on Sub two ─────────────────────────────────
    // buildVtodoIcs accepts parametrised keys as-is (emits `${k}:${v}`), so passing
    // 'RELATED-TO;RELTYPE=PARENT' as the key produces the correct iCal line.
    const sub2Ics = buildVtodoIcs(sub2Uid, sub2Renamed, {
      'RELATED-TO;RELTYPE=PARENT': parentUid,
    });
    await putVtodo(calendarName, sub2Uid, sub2Ics);
    await syncNow();
    await waitForTaskInCache(sub2Renamed);

    vtodos = parseVtodos(await fetchVtodos(calendarName));

    const sub2BlockB = vtodos.get(sub2Renamed);
    if (!sub2BlockB) throw new Error(`sub2 renamed VTODO not found for: ${sub2Renamed}`);
    if (getUid(sub2BlockB) !== sub2Uid) throw new Error(`sub2 UID changed during CalDAV update`);
    if (!sub2BlockB.includes(parentRelLine)) throw new Error(`sub2 RELATED-TO lost after CalDAV rename. Block:\n${sub2BlockB}`);

    // Verify sub2Renamed appears in the vault file
    const vaultAfterSub2 = await browser.executeObsidian(async ({ app }) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      return f ? app.vault.read(f as any) : '';
    });
    if (!vaultAfterSub2.includes(sub2Renamed)) {
      throw new Error(`sub2 renamed title "${sub2Renamed}" not in Tasks.md after CalDAV update`);
    }
    // Sub one and Sub three titles unchanged in vault
    if (!vaultAfterSub2.includes(sub1Renamed)) {
      throw new Error(`sub1 renamed title "${sub1Renamed}" disappeared from Tasks.md`);
    }
    if (!vaultAfterSub2.includes(sub3Title)) {
      throw new Error(`sub3 title "${sub3Title}" disappeared from Tasks.md`);
    }

    // ── Step 6: Re-parent Sub three via indentation ───────────────────────────
    // By this point writeBackIds may have appended 🆔 … to the sub3 line, so we
    // cannot rely on a fixed string. Instead, read the file, find the line
    // containing sub3Title, and prepend 4 more spaces to it.
    await browser.executeObsidian(async ({ app }, args) => {
      const f = app.vault.getAbstractFileByPath('Tasks.md');
      const body = await app.vault.read(f as any);
      const newBody = body
        .split('\n')
        .map((line: string) => {
          if (line.includes(args.sub3Title)) {
            // Add 4 more spaces at the start (re-parent from depth-1 to depth-2)
            return '    ' + line;
          }
          return line;
        })
        .join('\n');
      await app.vault.modify(f as any, newBody);
    }, { sub3Title });

    await syncNow();

    // Wait until the server shows sub3 re-parented to sub2Uid
    const sub3RelToSub2 = `RELATED-TO;RELTYPE=PARENT:${sub2Uid}`;
    await browser.waitUntil(async () => {
      const raw = await fetchVtodos(calendarName);
      const unfolded = raw.replace(/\r?\n[ \t]/g, '');
      const sub3Block = unfolded.match(/BEGIN:VTODO[\s\S]*?END:VTODO/g)
        ?.find((b) => b.includes(sub3Title));
      return sub3Block?.includes(sub3RelToSub2) ?? false;
    }, { timeout: 20000, interval: 500, timeoutMsg: `sub3 RELATED-TO not updated to sub2Uid (${sub2Uid}) on server` });

    // Final parse and full assertions
    vtodos = parseVtodos(await fetchVtodos(calendarName));

    // Sub one: same uid, renamed title, still child of parent
    const sub1Final = vtodos.get(sub1Renamed);
    if (!sub1Final) throw new Error(`sub1 final VTODO not found`);
    if (getUid(sub1Final) !== sub1Uid) throw new Error(`sub1 UID changed in final state`);
    if (!sub1Final.includes(parentRelLine)) throw new Error(`sub1 RELATED-TO changed in final state. Block:\n${sub1Final}`);

    // Sub two: same uid, renamed title, still child of parent
    const sub2Final = vtodos.get(sub2Renamed);
    if (!sub2Final) throw new Error(`sub2 final VTODO not found`);
    if (getUid(sub2Final) !== sub2Uid) throw new Error(`sub2 UID changed in final state`);
    if (!sub2Final.includes(parentRelLine)) throw new Error(`sub2 RELATED-TO changed in final state. Block:\n${sub2Final}`);

    // Sub three: same uid, original title, now child of sub2
    const sub3Final = vtodos.get(sub3Title);
    if (!sub3Final) throw new Error(`sub3 final VTODO not found`);
    if (getUid(sub3Final) !== sub3Uid) throw new Error(`sub3 UID changed in final state`);
    if (!sub3Final.includes(sub3RelToSub2)) throw new Error(`sub3 RELATED-TO not pointing to sub2Uid in final state. Block:\n${sub3Final}`);

    // Parent: no RELATED-TO (it is the root)
    const parentFinal = vtodos.get(parentTitle);
    if (!parentFinal) throw new Error(`parent final VTODO not found`);
    if (parentFinal.includes('RELATED-TO')) throw new Error(`parent VTODO unexpectedly has RELATED-TO. Block:\n${parentFinal}`);
  });
});
