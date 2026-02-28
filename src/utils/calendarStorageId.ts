/**
 * Deterministic storage directory ID from server URL + calendar name.
 * Produces a filesystem-safe, human-readable string.
 */
export function calendarStorageId(serverUrl: string, calendarName: string): string {
  const sanitized = `${serverUrl}_${calendarName}`
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized;
}
