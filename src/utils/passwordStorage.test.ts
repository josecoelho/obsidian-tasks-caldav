import { CalDAVSettings, CalendarMapping, DEFAULT_CALDAV_SETTINGS } from '../types';
import {
  clearStoredPassword,
  externalizePasswords,
  hasPasswordsToExternalize,
  hydratePasswords,
  SecretStore,
} from './passwordStorage';

function fakeStore(): SecretStore & { secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  return {
    secrets,
    setSecret: (id, secret) => void secrets.set(id, secret),
    getSecret: (id) => secrets.get(id) ?? null,
  };
}

function calendar(overrides: Partial<CalendarMapping> = {}): CalendarMapping {
  return {
    obsidianTag: 'sync',
    caldavCategory: 'sync',
    calendarName: '',
    serverUrl: '',
    username: 'me',
    password: 'hunter2',
    calendarUrl: 'https://dav.example.com/cal/',
    ...overrides,
  };
}

function settings(overrides: Partial<CalDAVSettings> = {}): CalDAVSettings {
  return { ...DEFAULT_CALDAV_SETTINGS, calendars: [calendar()], ...overrides };
}

describe('externalizePasswords', () => {
  it('moves the password into secret storage and blanks the persisted copy', () => {
    const store = fakeStore();
    const live = settings();

    const persisted = externalizePasswords(live, store);

    const saved = persisted.calendars[0];
    expect(saved.password).toBe('');
    expect(saved.passwordSecretId).toMatch(/^caldav-sync-[0-9a-f-]+$/);
    expect(store.getSecret(saved.passwordSecretId!)).toBe('hunter2');
  });

  it('keeps the live password intact and reuses the same secret id across saves', () => {
    const store = fakeStore();
    const live = settings();

    const first = externalizePasswords(live, store);
    const second = externalizePasswords(live, store);

    expect(live.calendars[0].password).toBe('hunter2');
    expect(second.calendars[0].passwordSecretId).toBe(first.calendars[0].passwordSecretId);
    expect(store.secrets.size).toBe(1);
  });

  it('does not mint secrets for calendars without a password yet', () => {
    const store = fakeStore();

    const persisted = externalizePasswords(settings({ calendars: [calendar({ password: '' })] }), store);

    expect(persisted.calendars[0].passwordSecretId).toBeUndefined();
    expect(store.secrets.size).toBe(0);
  });

  it('persists plain text and clears the stored secret when plain text is chosen', () => {
    const store = fakeStore();
    store.setSecret('caldav-sync-old', 'hunter2');
    const live = settings({
      storePasswordsInPlainText: true,
      calendars: [calendar({ passwordSecretId: 'caldav-sync-old' })],
    });

    const persisted = externalizePasswords(live, store);

    expect(persisted.calendars[0].password).toBe('hunter2');
    expect(persisted.calendars[0].passwordSecretId).toBeUndefined();
    expect(store.getSecret('caldav-sync-old')).toBe('');
  });

  it('passes everything through untouched when secret storage is unavailable', () => {
    const live = settings({ calendars: [calendar({ passwordSecretId: 'caldav-sync-old' })] });

    expect(externalizePasswords(live, undefined)).toEqual(live);
  });
});

describe('hydratePasswords', () => {
  it('fills passwords from secret storage by id', () => {
    const store = fakeStore();
    store.setSecret('caldav-sync-a', 'hunter2');
    const loaded = settings({ calendars: [calendar({ password: '', passwordSecretId: 'caldav-sync-a' })] });

    hydratePasswords(loaded, store);

    expect(loaded.calendars[0].password).toBe('hunter2');
  });

  it('leaves plain-text passwords untouched and missing secrets empty', () => {
    const store = fakeStore();
    const loaded = settings({
      calendars: [
        calendar({ password: 'plain' }),
        calendar({ password: '', passwordSecretId: 'caldav-sync-gone' }),
      ],
    });

    hydratePasswords(loaded, store);

    expect(loaded.calendars[0].password).toBe('plain');
    expect(loaded.calendars[1].password).toBe('');
  });

  it('round-trips a password through persist and reload', () => {
    const store = fakeStore();
    const persisted = JSON.parse(JSON.stringify(externalizePasswords(settings(), store))) as CalDAVSettings;

    hydratePasswords(persisted, store);

    expect(persisted.calendars[0].password).toBe('hunter2');
  });
});

describe('hasPasswordsToExternalize', () => {
  it('detects a plain-text password when secret storage is on', () => {
    expect(hasPasswordsToExternalize(settings(), fakeStore())).toBe(true);
  });

  it('is false when opted out, already externalized, or without a store', () => {
    expect(hasPasswordsToExternalize(settings({ storePasswordsInPlainText: true }), fakeStore())).toBe(false);
    expect(hasPasswordsToExternalize(settings(), undefined)).toBe(false);
    const externalized = settings({ calendars: [calendar({ password: '', passwordSecretId: 'caldav-sync-a' })] });
    expect(hasPasswordsToExternalize(externalized, fakeStore())).toBe(false);
  });
});

describe('clearStoredPassword', () => {
  it('blanks the secret and drops the reference', () => {
    const store = fakeStore();
    store.setSecret('caldav-sync-a', 'hunter2');

    const cleared = clearStoredPassword(calendar({ passwordSecretId: 'caldav-sync-a' }), store);

    expect(cleared.passwordSecretId).toBeUndefined();
    expect(store.getSecret('caldav-sync-a')).toBe('');
  });
});
