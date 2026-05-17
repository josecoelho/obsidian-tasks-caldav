import path from 'node:path';
import { browser } from '@wdio/globals';

const DATAVIEW_VAULT = path.resolve('test/wdio/vault-dataview');

/** Reload Obsidian into the dataview-preset fixture vault with both plugins
 *  enabled, and put our plugin into dataview mode.
 *
 *  obsidian-tasks' dataview format comes from the vault's
 *  `obsidian-tasks-plugin/data.json` (it is installed by id, so its data.json
 *  travels with the vault). Our plugin, however, is installed from the path in
 *  `wdio.conf.mts` capabilities (the emoji vault's plugin folder), so the
 *  installer overwrites the dataview vault's `tasks-caldav-sync/data.json` with
 *  the emoji one — making a preset data.json for our plugin ineffective. We
 *  therefore set `taskFormat` at runtime here. Call once in `before`. */
export async function openDataviewVault(): Promise<void> {
  await browser.reloadObsidian({
    vault: DATAVIEW_VAULT,
    plugins: ['tasks-caldav-sync', 'obsidian-tasks-plugin'],
  });
  await browser.executeObsidian(async ({ app }) => {
    const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { taskFormat: string }; saveSettings: () => Promise<void> }> } })
      .plugins.plugins['tasks-caldav-sync'];
    plugin.settings.taskFormat = 'dataview';
    await plugin.saveSettings();
  });
}
