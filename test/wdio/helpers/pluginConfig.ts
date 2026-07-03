import { browser } from '@wdio/globals';
import { RADICALE } from '../../helpers/radicaleSetup';

/** Radicale collection URL for an isolated calendar name. */
export function calendarUrlFor(calendarName: string): string {
  return `${RADICALE.baseUrl}/${RADICALE.username}/${calendarName}/`;
}

/**
 * Point the plugin at an isolated calendar using the LEGACY config: a server
 * base URL + calendar name (matched by display name via discovery). Retained to
 * seed the "upgrade a legacy calendar to a URL" migration scenario.
 */
export async function useCalendar(calendarName: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
    // Replace all calendars; each test uses exactly one isolated calendar.
    plugin.settings.calendars = [{
      obsidianTag: 'sync',
      caldavCategory: 'sync',
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

/**
 * Point the plugin at an isolated calendar using the NEW config: its exact
 * collection URL, with empty serverUrl/calendarName. This exercises the
 * URL-pinned path — `connect()` skips discovery and talks to the URL directly.
 */
export async function useCalendarUrl(calendarName: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
    plugin.settings.calendars = [{
      obsidianTag: 'sync',
      caldavCategory: 'sync',
      calendarName: '',
      serverUrl: '',
      username: args.username,
      password: args.password,
      calendarUrl: args.calendarUrl,
    }];
    await plugin.saveSettings();
  }, {
    calendarUrl: calendarUrlFor(calendarName),
    username: RADICALE.username,
    password: RADICALE.password,
  });
}

/**
 * Add a calendarUrl to the already-configured calendar, keeping its serverUrl +
 * calendarName. This mirrors the settings UI's Calendar URL field, which only
 * sets `calendarUrl` — making the calendar a "legacy adopter" whose storage key
 * stays on the original pair (so no baseline is orphaned and no re-sync occurs).
 */
export async function pinCalendarUrl(calendarUrl: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const plugin = (app as any).plugins.plugins['tasks-caldav-sync'];
    plugin.settings.calendars[0].calendarUrl = args.calendarUrl;
    await plugin.saveSettings();
  }, { calendarUrl });
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
