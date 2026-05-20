import path from 'node:path';
import { browser } from '@wdio/globals';

const DATAVIEW_VAULT = path.resolve('test/wdio/vault-dataview');

/** Reload Obsidian into the dataview-preset fixture vault with both plugins
 *  enabled.
 *
 *  obsidian-tasks' dataview format comes from the vault's
 *  `obsidian-tasks-plugin/data.json` (it is installed by id, so its data.json
 *  travels with the vault). Our plugin follows obsidian-tasks' configured
 *  format automatically via `getConfiguredFormat()`.
 *
 *  The `plugins` list below selects from the plugins already registered in
 *  `wdio.conf.mts` capabilities — it does not define new plugin paths. */
export async function openDataviewVault(): Promise<void> {
  await browser.reloadObsidian({
    vault: DATAVIEW_VAULT,
    plugins: ['tasks-caldav-sync', 'obsidian-tasks-plugin'],
  });
}
