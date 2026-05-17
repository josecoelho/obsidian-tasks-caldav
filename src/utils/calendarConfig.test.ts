import { missingCalendarFields, isCalendarConfigured } from './calendarConfig';
import { CalendarMapping } from '../types';

const full: CalendarMapping = {
  tag: '#todo',
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
    const blank: CalendarMapping = { tag: '', calendarName: '', serverUrl: '', username: '', password: '' };
    expect(missingCalendarFields(blank)).toEqual(['server URL', 'username', 'calendar name']);
    expect(isCalendarConfigured(blank)).toBe(false);
  });

  it('treats whitespace-only values as missing', () => {
    const ws: CalendarMapping = { ...full, serverUrl: '   ' };
    expect(missingCalendarFields(ws)).toEqual(['server URL']);
    expect(isCalendarConfigured(ws)).toBe(false);
  });

  it('does not require tag or password', () => {
    const noTagNoPass: CalendarMapping = { ...full, tag: '', password: '' };
    expect(isCalendarConfigured(noTagNoPass)).toBe(true);
  });
});
