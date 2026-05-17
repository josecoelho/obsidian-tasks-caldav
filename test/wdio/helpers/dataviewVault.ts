import path from 'node:path';
import { browser } from '@wdio/globals';

const DATAVIEW_VAULT = path.resolve('test/wdio/vault-dataview');

/** Reload Obsidian into the dataview-preset fixture vault, with both plugins
 *  enabled. Call once in the spec's `before` hook. */
export async function openDataviewVault(): Promise<void> {
  await browser.reloadObsidian({
    vault: DATAVIEW_VAULT,
    plugins: ['tasks-caldav-sync', 'obsidian-tasks-plugin'],
  });
}
