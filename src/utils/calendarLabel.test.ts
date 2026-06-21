import { calendarLabel, lastPathSegment } from './calendarLabel';
import { CalendarMapping } from '../types';

const base: CalendarMapping = {
  obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '', username: '', password: '',
};

describe('lastPathSegment', () => {
  it('returns the final path segment, ignoring a trailing slash', () => {
    expect(lastPathSegment('https://caldav.example.com/dav/cal/personal-todos/')).toBe('personal-todos');
  });

  it('handles a URL with no trailing slash', () => {
    expect(lastPathSegment('https://caldav.example.com/dav/cal/work')).toBe('work');
  });
});

describe('calendarLabel', () => {
  it('prefers the calendar name when present', () => {
    expect(calendarLabel({ ...base, calendarName: 'Work', calendarUrl: 'https://x/dav/cal/w/' })).toBe('Work');
  });

  it('falls back to the URL path segment when there is no name', () => {
    expect(calendarLabel({ ...base, calendarUrl: 'https://caldav.example.com/dav/cal/personal-todos/' })).toBe('personal-todos');
  });

  it('falls back to the server URL when there is neither name nor URL', () => {
    expect(calendarLabel({ ...base, serverUrl: 'https://caldav.example.com' })).toBe('https://caldav.example.com');
  });

  it('returns an empty string for a blank calendar', () => {
    expect(calendarLabel(base)).toBe('');
  });
});
