import { missingCalendarFields, isCalendarConfigured, describeIncompleteCalendar } from './calendarConfig';
import { CalendarMapping } from '../types';

const legacy: CalendarMapping = {
  obsidianTag: '#todo', caldavCategory: '#todo', calendarName: 'J ToDo',
  serverUrl: 'http://localhost:37358/', username: 'username@mail.com', password: 'secret',
};

const urlPinned: CalendarMapping = {
  obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '',
  username: 'username@mail.com', password: 'secret',
  calendarUrl: 'http://localhost:37358/dav/cal/jtodo/',
};

const blank: CalendarMapping = {
  obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '', username: '', password: '',
};

describe('calendarConfig', () => {
  it('treats a legacy serverUrl + calendarName calendar as configured', () => {
    expect(missingCalendarFields(legacy)).toEqual([]);
    expect(isCalendarConfigured(legacy)).toBe(true);
  });

  it('treats a URL-pinned calendar (no server URL or name) as configured', () => {
    expect(missingCalendarFields(urlPinned)).toEqual([]);
    expect(isCalendarConfigured(urlPinned)).toBe(true);
  });

  it('requires a calendar URL and username for a blank calendar', () => {
    expect(missingCalendarFields(blank)).toEqual(['calendar URL', 'username']);
    expect(isCalendarConfigured(blank)).toBe(false);
  });

  it('reports only a missing calendar URL when credentials are present', () => {
    const credsOnly: CalendarMapping = { ...blank, username: 'user', password: 'pass' };
    expect(missingCalendarFields(credsOnly)).toEqual(['calendar URL']);
  });

  it('does not require a password', () => {
    expect(isCalendarConfigured({ ...urlPinned, password: '' })).toBe(true);
  });

  describe('describeIncompleteCalendar', () => {
    it('returns null for a configured calendar', () => {
      expect(describeIncompleteCalendar(legacy, 0)).toBeNull();
    });

    it('falls back to a positional name for a blank calendar', () => {
      expect(describeIncompleteCalendar(blank, 1)).toBe('Calendar 2 (missing calendar URL, username)');
    });

    it('labels a URL-pinned calendar by its path segment', () => {
      expect(describeIncompleteCalendar({ ...urlPinned, username: '' }, 0)).toBe('jtodo (missing username)');
    });

    it('labels a legacy calendar by its name', () => {
      expect(describeIncompleteCalendar({ ...legacy, username: '' }, 3)).toBe('J ToDo (missing username)');
    });
  });
});
