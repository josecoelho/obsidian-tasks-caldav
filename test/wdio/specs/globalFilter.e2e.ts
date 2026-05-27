import { browser } from '@wdio/globals';
import { createIsolatedCalendar } from '../../helpers/radicaleSetup';
import { useCalendar, waitForTaskInCache, syncNow } from '../helpers/pluginConfig';
import { appendTaskLine } from '../helpers/vaultEdit';

/**
 * Issue #93: when obsidian-tasks has a `globalFilter` configured, it strips
 * the filter tag from `task.tags` during parsing. Our plugin must re-add it
 * when writing tasks back, otherwise obsidian-tasks stops recognising the
 * rewritten line as a task.
 */

async function setObsidianTasksGlobalFilter(filter: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
    const data = ((await tp.loadData()) as Record<string, unknown> | null) ?? {};
    data.globalFilter = args.filter;
    await tp.saveData(data);
  }, { filter });
  // Reload Obsidian so obsidian-tasks loads the new setting cleanly.
  await browser.reloadObsidian({ plugins: ['tasks-caldav-sync', 'obsidian-tasks-plugin'] });
}

async function readVaultFile(filePath: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, args) => {
    const f = app.vault.getAbstractFileByPath(args.filePath);
    return f ? app.vault.read(f as any) : '';
  }, { filePath });
}

describe('obsidian-tasks global filter', function () {
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async function () {
    const cal = await createIsolatedCalendar();
    cleanup = cal.cleanup;
    await setObsidianTasksGlobalFilter('#task');
    await useCalendar(cal.calendarName);
  });

  afterEach(async function () {
    await setObsidianTasksGlobalFilter('');
    await cleanup?.();
  });

  it('preserves the global filter tag when writing a task back to the vault', async function () {
    const title = `GlobalFilter ${Date.now()}`;
    await appendTaskLine('Tasks.md', `- [ ] ${title} #task #sync`);

    await waitForTaskInCache(title);
    await syncNow();

    // After sync, the plugin writes back an ID. The line must still carry
    // #task so obsidian-tasks keeps recognising it under the global filter.
    await browser.waitUntil(async () => {
      const content = await readVaultFile('Tasks.md');
      const line = content.split('\n').find(l => l.includes(title));
      if (!line) return false;
      const hasId = line.includes('🆔') || line.includes('[id::');
      return hasId && /#task(\s|$)/.test(line);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'task line missing #task or id after sync' });

    // And obsidian-tasks still parses the rewritten line as a task.
    await browser.waitUntil(async () => {
      return browser.executeObsidian(({ app }, t) => {
        const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
        return tp.getTasks().some((task: any) => task.description.includes(t));
      }, title);
    }, { timeout: 15000, interval: 500, timeoutMsg: 'task no longer recognised by obsidian-tasks after sync' });
  });
});
