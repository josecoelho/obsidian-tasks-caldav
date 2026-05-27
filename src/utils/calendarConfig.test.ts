import { missingCalendarFields, isCalendarConfigured, describeIncompleteCalendar } from './calendarConfig';
import { CalendarMapping } from '../types';

const full: CalendarMapping = {
  obsidianTag: '#todo',
  caldavCategory: '#todo',
  calendarName: 'J ToDo',
  serverUrl: 'http://localhost:37358/',
  username: 'username@mail.com',
  password: 'secret',
};

describe('calendarConfig', () => {
  it('reports no missing fields for a fully configured calendar', () => {
    expect(missingCalendarFields(full)).toEqual([]);
    expect(isCalendarConfigured(full)).toBe(true);
  });

  it('lists every missing field for a blank calendar (issue #72)', () => {
    const blank: CalendarMapping = { obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '', username: '', password: '' };
    expect(missingCalendarFields(blank)).toEqual(['server URL', 'username', 'calendar name']);
    expect(isCalendarConfigured(blank)).toBe(false);
  });

  it('treats whitespace-only values as missing', () => {
    const ws: CalendarMapping = { ...full, serverUrl: '   ' };
    expect(missingCalendarFields(ws)).toEqual(['server URL']);
    expect(isCalendarConfigured(ws)).toBe(false);
  });

  it('does not require tag or password', () => {
    const noTagNoPass: CalendarMapping = { ...full, obsidianTag: '', caldavCategory: '', password: '' };
    expect(isCalendarConfigured(noTagNoPass)).toBe(true);
  });

  describe('describeIncompleteCalendar', () => {
    it('returns null for a fully configured calendar', () => {
      expect(describeIncompleteCalendar(full, 0)).toBeNull();
    });

    it('falls back to a positional name for a blank calendar (issue #72)', () => {
      const blank: CalendarMapping = { obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '', username: '', password: '' };
      expect(describeIncompleteCalendar(blank, 1)).toBe(
        'Calendar 2 (missing server URL, username, calendar name)',
      );
    });

    it('uses the server URL when the calendar name is empty', () => {
      const noName: CalendarMapping = { ...full, calendarName: '', username: '' };
      expect(describeIncompleteCalendar(noName, 0)).toBe(
        'http://localhost:37358/ (missing username, calendar name)',
      );
    });

    it('uses the calendar name when present', () => {
      const noUser: CalendarMapping = { ...full, username: '' };
      expect(describeIncompleteCalendar(noUser, 3)).toBe('J ToDo (missing username)');
    });
  });
});
