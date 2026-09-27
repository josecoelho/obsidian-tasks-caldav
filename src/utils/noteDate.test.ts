import { moment } from 'obsidian';
import { isDayFormat, extractDateFromNotePath } from './noteDate';

describe('isDayFormat', () => {
  it.each([
    'YYYY-MM-DD', 'DD.MM.YYYY', 'YYYY/MM/DD', 'YYYYMMDD',
    'YYYY-M-D', 'D MMM YYYY', 'Do MMMM YYYY',
    'YYYY-DDD', 'YYYY-DDDD', 'DDD/YYYY',
  ])('accepts the complete date format %s', format => {
    expect(isDayFormat(format)).toBe(true);
  });

  it.each([
    '', 'YYYY', 'YYYY-MM', 'MM-DD', 'YYYY-DD', 'DDD',
    // Missing, duplicate, or conflicting date components.
    'YYYY-YYYY-MM-DD', 'YYYY-MM-M-DD', 'YYYY-MM-DD-D',
    'YYYY-MM-DDD', 'YYYY-DD-DDD', 'YYYY-DDD-DDDD',
    // Unsupported year variants and overlong tokens.
    'YY-MM-DD', 'Y-MM-DD', 'y-MM-DD', 'YYYYY-MM-DD',
    'YYYY-MMMMM-DD', 'YYYY-DDDDD',
    // Week dates, weekdays, quarters, localized formats, and times.
    'GGGG-MM-DD', 'GGGG-DDD', 'gggg-MM-DD',
    'YYYY-[W]ww', 'GGGG-[W]WW-E', 'gggg-ww-e', 'YYYY-WW-E',
    'YYYY-MM-DD dddd', 'YYYY-[Q]Q', 'L', 'LL', 'LLLL', 'l',
    'LT', 'LTS', 'lt', 'lts', 'HH:mm', 'YYYY-MM-DD HH:mm',
    'L[T]HH:mm', 'YYYY-MM-DDZ', 'YYYY-MM-DDX',
    // Literals and escapes must not masquerade as tokens or join them.
    'YYYY-MM-\\D', 'YYYY-\\M-DD', 'YYYY-MM-[D]',
    'YYYY-D[x]DD', 'YYYY-D\\xDD', 'YYYY-MM-[Day] DD',
    'Do [of] MMMM YYYY', '\\[YYYY\\]-MM-DD',
    'YYYY_MM_DD', 'YYYY-MM-DD\n',
  ])('rejects unsupported or incomplete format %s', format => {
    expect(isDayFormat(format)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isDayFormat(null as unknown as string)).toBe(false);
    expect(isDayFormat(undefined as unknown as string)).toBe(false);
  });
});

describe('extractDateFromNotePath', () => {
  it.each([
    ['2026-09-21.md', 'YYYY-MM-DD', '2026-09-21'],
    ['Daily/2026-09-21.md', 'YYYY-MM-DD', '2026-09-21'],
    ['Archive/2026/09/2026-09-21.md', 'YYYY-MM-DD', '2026-09-21'],
    ['Journal/21.09.2026.md', 'DD.MM.YYYY', '2026-09-21'],
    ['Notes/2026/09/21.md', 'YYYY/MM/DD', '2026-09-21'],
    ['20260921.md', 'YYYYMMDD', '2026-09-21'],
    ['2026-9-1.md', 'YYYY-M-D', '2026-09-01'],
    ['21 Sep 2026.md', 'D MMM YYYY', '2026-09-21'],
    ['21st September 2026.md', 'Do MMMM YYYY', '2026-09-21'],
    ['2026-264.md', 'YYYY-DDD', '2026-09-21'],
    ['2026-026.md', 'YYYY-DDDD', '2026-01-26'],
    ['Daily/2024/366.md', 'YYYY/DDD', '2024-12-31'],
    ['Daily/2026/September/21st.md', 'YYYY/MMMM/Do', '2026-09-21'],
    ['2024-02-29.md', 'YYYY-MM-DD', '2024-02-29'],
  ])('extracts %s using %s', (path, format, expected) => {
    expect(extractDateFromNotePath(path, format)).toBe(expected);
  });

  it.each([
    ['Inbox.md', 'YYYY-MM-DD'],
    ['2026-09.md', 'YYYY-MM-DD'],
    ['2026-9-21.md', 'YYYY-MM-DD'],
    ['2026-02-29.md', 'YYYY-MM-DD'],
    ['2026-04-31.md', 'YYYY-MM-DD'],
    ['2026-13-01.md', 'YYYY-MM-DD'],
    ['2026-366.md', 'YYYY-DDD'],
    ['2026-000.md', 'YYYY-DDDD'],
    ['2026/02/29.md', 'YYYY/MM/DD'],
    ['21.md', 'YYYY/MM/DD'],
    ['2026-09-21 extra.md', 'YYYY-MM-DD'],
    ['2026-09.md', 'YYYY-MM'],
    ['10:30 AM.md', 'LT'],
    ['2026-09-D.md', 'YYYY-MM-\\D'],
    ['2025-09-21.md', 'GGGG-MM-DD'],
    ['2026-2x21.md', 'YYYY-D[x]DD'],
    ['2025-W38-1.md', 'GGGG-[W]WW-E'],
    ['2026-09-21 Monday.md', 'YYYY-MM-DD dddd'],
    ['2026-09-21 10:30.md', 'YYYY-MM-DD HH:mm'],
  ])('leaves %s undated with format %s', (path, format) => {
    expect(extractDateFromNotePath(path, format)).toBeNull();
  });

  it('returns null when the setting is disabled', () => {
    expect(extractDateFromNotePath('2026-09-21.md', undefined)).toBeNull();
    expect(extractDateFromNotePath('2026-09-21.md', '')).toBeNull();
  });

  it('serializes ASCII dates without changing the active locale', () => {
    const originalLocale = moment.locale();
    const locale = 'note-date-test';
    moment.defineLocale(locale, {
      parentLocale: 'en',
      postformat: (value: string) => value.replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]),
    });
    try {
      expect(moment.utc('2026-09-21').format('YYYY-MM-DD')).toBe('٢٠٢٦-٠٩-٢١');
      expect(extractDateFromNotePath('21 September 2026.md', 'D MMMM YYYY')).toBe('2026-09-21');
      expect(moment.locale()).toBe(locale);
    } finally {
      moment.locale(originalLocale);
      moment.defineLocale(locale, null);
    }
  });
});
