import { CalDAVSettings, CalendarMapping } from '../types';

/** The slice of Obsidian's `SecretStorage` (since 1.11.4) that passwords need. */
export interface SecretStore {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}

/**
 * Fill in-memory passwords from secret storage. Plain-text entries pass
 * through untouched; a missing secret leaves the password empty so the
 * calendar reads as incomplete instead of syncing with a stale credential.
 */
export function hydratePasswords(settings: CalDAVSettings, store: SecretStore | undefined): void {
  if (!store) return;
  for (const calendar of settings.calendars) {
    if (calendar.passwordSecretId && !calendar.password) {
      calendar.password = store.getSecret(calendar.passwordSecretId) ?? '';
    }
  }
}

/** True when data.json holds a plain-text password that should move into secret storage. */
export function hasPasswordsToExternalize(settings: CalDAVSettings, store: SecretStore | undefined): boolean {
  if (!store || settings.storePasswordsInPlainText) return false;
  return settings.calendars.some((calendar) => calendar.password !== '' && !calendar.passwordSecretId);
}

/**
 * Shape settings for persistence. Each password moves into secret storage and
 * is blanked in the returned copy, so data.json never holds credentials. When
 * plain text is chosen it is persisted as-is and any stored secret is cleared;
 * when secret storage is unavailable everything passes through untouched, so
 * an Obsidian downgrade never drops the reference to an existing secret.
 * Assigns missing secret ids on the live mapping so repeated saves reuse them.
 */
export function externalizePasswords(settings: CalDAVSettings, store: SecretStore | undefined): CalDAVSettings {
  if (!store) return settings;
  const calendars = settings.storePasswordsInPlainText
    ? settings.calendars.map((calendar) => clearStoredPassword(calendar, store))
    : settings.calendars.map((calendar) => moveToSecret(calendar, store));
  return { ...settings, calendars };
}

/**
 * Blank a calendar's stored secret and return a copy without the reference.
 * Also used on calendar removal so credentials don't outlive the calendar.
 */
export function clearStoredPassword(calendar: CalendarMapping, store: SecretStore | undefined): CalendarMapping {
  if (!store || !calendar.passwordSecretId) return calendar;
  store.setSecret(calendar.passwordSecretId, '');
  return { ...calendar, passwordSecretId: undefined };
}

function moveToSecret(calendar: CalendarMapping, store: SecretStore): CalendarMapping {
  if (!calendar.password && !calendar.passwordSecretId) return calendar;
  calendar.passwordSecretId ??= `caldav-sync-${crypto.randomUUID()}`;
  store.setSecret(calendar.passwordSecretId, calendar.password);
  return { ...calendar, password: '' };
}
