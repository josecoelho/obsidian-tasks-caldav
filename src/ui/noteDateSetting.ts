import { Component, displayTooltip, Setting } from 'obsidian';
import { isDayFormat } from '../utils/noteDate';

const FORMAT_HELP = [
  'Use each date component once: year + month + day, or year + day of year.',
  'Year: YYYY (2026)',
  'Month: M (9), MM (09), MMM (Sep), MMMM (September)',
  'Day: D (1), DD (01), Do (1st)',
  'Day of year: DDD (26), DDDD (026)',
  'Month names and ordinal days follow your locale.',
  'Separators: spaces, hyphens, dots, slashes, or none.',
  'Examples:',
  'YYYY-MM-DD → 2026-09-21.md',
  'Do MMMM YYYY → 21st September 2026.md',
  'YYYY/MM/DD → Daily/2026/09/21.md',
  'YYYY-DDD → 2026-264.md',
  'Month-only, week-only, and year-only formats are not supported because CalDAV requires a complete calendar date.',
  'Times, weekdays, week dates, and literal text are not supported.',
].join('\n');

/** Owns the format field and help listeners for one settings-tab render. */
export class NoteDateSetting extends Component {
  constructor(
    containerEl: HTMLElement,
    format: string | undefined,
    onChange: (format: string | undefined) => Promise<void>,
  ) {
    super();

    const setting = new Setting(containerEl)
      .setName('Note date format for tasks without due date')
      .setDesc('Use the note filename or path as the due date for undated tasks. Leave empty to disable. ');
    const helpLink = setting.descEl.createEl('a', {
      text: 'Supported formats',
      href: '#',
      attr: { role: 'button' },
    });
    this.registerDomEvent(helpLink, 'click', event => {
      event.preventDefault();
      displayTooltip(helpLink, FORMAT_HELP);
    });
    this.registerDomEvent(helpLink, 'keydown', event => {
      if (event.key === ' ') {
        event.preventDefault();
        displayTooltip(helpLink, FORMAT_HELP);
      }
    });

    const errorEl = setting.descEl.createSpan({ attr: { 'aria-live': 'polite' } });
    setting.addText(text => {
      const updateValidation = (value: string) => {
        const invalid = value.length > 0 && !isDayFormat(value);
        text.inputEl.setAttribute('aria-invalid', String(invalid));
        errorEl.setText(invalid ? ' Invalid date format; note dates will not be inferred.' : '');
      };
      text
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setPlaceholder('YYYY-MM-DD')
        .setValue(format ?? '')
        .onChange(async value => {
          const nextFormat = value.trim();
          updateValidation(nextFormat);
          await onChange(nextFormat || undefined);
        });
      updateValidation(format ?? '');
    });
  }
}
