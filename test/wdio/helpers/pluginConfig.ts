import { browser } from '@wdio/globals';
import { RADICALE } from '../../helpers/radicaleSetup';

/** Point the plugin at an isolated calendar and reinitialize its engines. */
export async function useCalendar(calendarName: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
    // Replace all calendars; each test uses exactly one isolated calendar.
    plugin.settings.calendars = [{
      tag: 'sync',
      calendarName: args.calendarName,
      serverUrl: args.serverUrl,
      username: args.username,
      password: args.password,
    }];
    await plugin.saveSettings();
  }, {
    calendarName,
    serverUrl: RADICALE.baseUrl,
    username: RADICALE.username,
    password: RADICALE.password,
  });
}

/** Wait until obsidian-tasks' cache reports a task whose description includes `text`. */
export async function waitForTaskInCache(text: string): Promise<void> {
  await browser.waitUntil(async () => {
    return await browser.executeObsidian(({ app }, t) => {
      const tp = (app as any).plugins.plugins['obsidian-tasks-plugin'];
      return tp.getTasks().some((task: any) => task.description.includes(t));
    }, text);
  }, { timeout: 20000, interval: 500, timeoutMsg: `task "${text}" never appeared in obsidian-tasks cache` });
}

/** Dispatch the sync-now command and pause for the async pipeline to settle.
 *  Callers must add their own waitUntil on the observable end state. */
export async function syncNow(): Promise<void> {
  await browser.executeObsidianCommand('tasks-caldav-sync:sync-now');
  await browser.pause(4000);
}
