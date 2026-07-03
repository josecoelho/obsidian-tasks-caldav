import { App, Modal, Setting } from 'obsidian';
import { CalDAVDiscoverer, CalendarInfo } from '../caldav/calDAVDiscoverer';
import { CalendarMapping } from '../types';

/** Origin of a URL, or '' if it can't be parsed. */
function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Discovery dialog. Takes a transient server URL (prefilled from the calendar's
 * stored server URL or the origin of its pinned URL), lists the calendars there,
 * and writes the chosen collection URL into `calendar.calendarUrl`. The typed
 * server URL is used only for discovery and is not persisted.
 */
export class BrowseCalendarsModal extends Modal {
  private readonly calendar: CalendarMapping;
  private readonly onPicked: () => Promise<void>;
  private serverUrl: string;
  private listEl!: HTMLElement;

  constructor(app: App, calendar: CalendarMapping, onPicked: () => Promise<void>) {
    super(app);
    this.calendar = calendar;
    this.onPicked = onPicked;
    this.serverUrl = calendar.serverUrl || originOf(calendar.calendarUrl);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Browse calendars' });

    new Setting(contentEl)
      .setName('Server URL')
      .setDesc('Used only to discover your calendars.')
      .addText(text => text
        .setPlaceholder('https://caldav.example.com')
        .setValue(this.serverUrl)
        .onChange(value => { this.serverUrl = value.trim(); }))
      .addButton(button => button
        .setButtonText('Find calendars')
        .setCta()
        .onClick(() => void this.find()));

    this.listEl = contentEl.createDiv();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async find(): Promise<void> {
    this.listEl.empty();
    if (!this.serverUrl) {
      this.listEl.createEl('p', { text: 'Enter your server URL first.' });
      return;
    }
    this.listEl.createEl('p', { text: 'Loading calendars…' });

    const discoverer = new CalDAVDiscoverer(this.serverUrl, this.calendar.username, this.calendar.password);
    let calendars: CalendarInfo[];
    try {
      calendars = await discoverer.listCalendars();
    } catch (error) {
      this.listEl.empty();
      const message = error instanceof Error ? error.message : 'unknown error';
      this.listEl.createEl('p', { text: `Could not load calendars: ${message}` });
      return;
    }

    this.renderList(calendars);
  }

  private renderList(calendars: CalendarInfo[]): void {
    this.listEl.empty();
    if (calendars.length === 0) {
      this.listEl.createEl('p', { text: 'No calendars found on the server.' });
      return;
    }

    const sorted = [...calendars].sort((a, b) => Number(b.supportsVTODO) - Number(a.supportsVTODO));
    for (const calendar of sorted) {
      const badge = calendar.supportsVTODO ? 'tasks' : 'events only';
      new Setting(this.listEl)
        .setName(calendar.displayName)
        .setDesc(`${calendar.url} · ${badge}`)
        .addButton(button => {
          button
            .setButtonText(calendar.supportsVTODO ? 'Use' : 'Use anyway')
            .onClick(() => void this.apply(calendar.url));
          if (!calendar.supportsVTODO) {
            button.setWarning();
          }
        });
    }
  }

  private async apply(url: string): Promise<void> {
    this.calendar.calendarUrl = url;
    await this.onPicked();
    this.close();
  }
}
