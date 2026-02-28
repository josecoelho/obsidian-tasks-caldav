import { calendarStorageId } from './calendarStorageId';

describe('calendarStorageId', () => {
  it('should return a stable id for the same inputs', () => {
    const id1 = calendarStorageId('https://caldav.example.com', 'Work');
    const id2 = calendarStorageId('https://caldav.example.com', 'Work');
    expect(id1).toBe(id2);
  });

  it('should strip protocol from server url', () => {
    const id = calendarStorageId('https://caldav.example.com', 'Work');
    expect(id).toBe('caldav-example-com_Work');
  });

  it('should produce different ids for different calendar names', () => {
    const id1 = calendarStorageId('https://caldav.example.com', 'Work');
    const id2 = calendarStorageId('https://caldav.example.com', 'Personal');
    expect(id1).not.toBe(id2);
  });

  it('should produce different ids for different server urls', () => {
    const id1 = calendarStorageId('https://server-a.com', 'Calendar');
    const id2 = calendarStorageId('https://server-b.com', 'Calendar');
    expect(id1).not.toBe(id2);
  });

  it('should sanitize special characters into hyphens', () => {
    const id = calendarStorageId('https://caldav.example.com/dav/user@email.com/', 'My Calendar');
    expect(id).toBe('caldav-example-com-dav-user-email-com-_My-Calendar');
  });

  it('should collapse consecutive hyphens', () => {
    const id = calendarStorageId('https://example.com///path', 'cal');
    expect(id).toBe('example-com-path_cal');
  });

  it('should handle http urls', () => {
    const id = calendarStorageId('http://localhost:5232', 'TestTasks');
    expect(id).toBe('localhost-5232_TestTasks');
  });
});
