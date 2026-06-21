# Pin a CalDAV calendar by URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the server-URL + calendar-name pair with a single **Calendar URL** that pins the exact CalDAV collection, fixing same-name calendar collisions and skipping discovery once pinned.

**Architecture:** `calendarUrl` is added to each mapping. When set, `connect()` uses it directly (no discovery); `serverUrl`/`calendarName` become internal (empty for new URL-pinned calendars, kept for legacy installs). Storage identity and display labels branch on which state a calendar is in, so legacy calendars never re-key or re-sync — no migration. The server URL needed for discovery moves into an on-demand "Browse calendars" modal.

**Tech Stack:** TypeScript, esbuild, Jest (unit + E2E), Obsidian plugin API (`Modal`, `Setting`, `Notice`).

**Spec:** `docs/superpowers/specs/2026-06-21-pin-calendar-by-url-design.md`

---

## File Structure

- **Modify** `src/types.ts` — add optional `calendarUrl?` to `CalendarMapping`.
- **Modify** `src/utils/calendarStorageId.ts` — extract `sanitizeStorageId`; add `storageIdForCalendar(calendar)`.
- **Modify** `src/utils/calendarStorageId.test.ts` — tests for `storageIdForCalendar`.
- **Create** `src/utils/calendarLabel.ts` — `calendarLabel(calendar)` + `lastPathSegment(url)`.
- **Create** `src/utils/calendarLabel.test.ts`.
- **Modify** `src/utils/calendarConfig.ts` — required-field logic accepts a URL *or* a legacy pair; label via `calendarLabel`.
- **Modify** `src/utils/calendarConfig.test.ts` — rewrite for the new contract.
- **Modify** `src/caldav/calDAVClientDirect.ts` — `calendarUrl?` on config; export `CalendarInfo`; short-circuit `connect()`; add `listCalendars()`; resolve `fetchVTODOs` hrefs against the pinned URL.
- **Modify** `src/caldav/calDAVClientDirect.test.ts` — tests for the above.
- **Modify** `src/sync/syncEngine.ts` — use `storageIdForCalendar` + `calendarLabel`.
- **Create** `src/ui/browseCalendarsModal.ts` — discovery modal (UI; coverage-excluded).
- **Modify** `main.ts` — replace the server-URL + calendar-name fields with a single Calendar URL field + Browse button.

No migration file and no change to `DEFAULT_CALDAV_SETTINGS` — the new field is optional.

---

## Task 1: Add the optional `calendarUrl` field

**Files:**
- Modify: `src/types.ts:1-8`
- Modify: `src/caldav/calDAVClientDirect.ts:5-10`

- [ ] **Step 1: Add the field to `CalendarMapping`**

In `src/types.ts`, replace the `CalendarMapping` interface (lines 1-8) with:

```ts
export interface CalendarMapping {
  obsidianTag: string;
  caldavCategory: string;
  /** Internal: legacy name-match key, storage key, and label. Empty for URL-pinned calendars. */
  calendarName: string;
  /** Internal: legacy discovery base and storage key. Empty for URL-pinned calendars. */
  serverUrl: string;
  username: string;
  password: string;
  /**
   * Exact CalDAV collection URL. When set, the client talks to this collection
   * directly and skips discovery + name-matching. When empty, the mapping is a
   * legacy by-name calendar that discovers and matches by `calendarName`.
   */
  calendarUrl?: string;
}
```

- [ ] **Step 2: Add the field to `CalDAVConnectionConfig`**

In `src/caldav/calDAVClientDirect.ts`, replace the `CalDAVConnectionConfig` interface (lines 5-10) with:

```ts
export interface CalDAVConnectionConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarName: string;
  /** When set, used directly as the calendar collection URL (skips discovery). */
  calendarUrl?: string;
}
```

- [ ] **Step 3: Verify the type check passes**

Run: `npm run build`
Expected: type check + esbuild succeed (existing code still compiles; the field is optional).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/caldav/calDAVClientDirect.ts
git commit -m "feat(caldav): add optional calendarUrl to calendar mapping"
```

---

## Task 2: Branch storage identity on calendar state

**Files:**
- Modify: `src/utils/calendarStorageId.ts`
- Test: `src/utils/calendarStorageId.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/utils/calendarStorageId.test.ts`, add these imports at the top (keep the existing `calendarStorageId` import — extend it):

```ts
import { calendarStorageId, storageIdForCalendar } from './calendarStorageId';
import { CalendarMapping } from '../types';
```

Then add this block after the existing `describe('calendarStorageId', ...)` block:

```ts
describe('storageIdForCalendar', () => {
  const base: CalendarMapping = {
    obsidianTag: '', caldavCategory: '', calendarName: '', serverUrl: '', username: '', password: '',
  };

  it('uses the legacy serverUrl + calendarName key when both are present', () => {
    const cal: CalendarMapping = { ...base, serverUrl: 'https://caldav.example.com', calendarName: 'Work' };
    expect(storageIdForCalendar(cal)).toBe(calendarStorageId('https://caldav.example.com', 'Work'));
  });

  it('keeps the legacy key even when a calendarUrl is also set (legacy adopter — no re-sync)', () => {
    const cal: CalendarMapping = {
      ...base, serverUrl: 'https://caldav.example.com', calendarName: 'Work',
      calendarUrl: 'https://caldav.example.com/dav/cal/other/',
    };
    expect(storageIdForCalendar(cal)).toBe(calendarStorageId('https://caldav.example.com', 'Work'));
  });

  it('keys off the calendar URL for a URL-pinned calendar with no legacy pair', () => {
    const cal: CalendarMapping = { ...base, calendarUrl: 'https://caldav.example.com/dav/cal/personal-todos/' };
    expect(storageIdForCalendar(cal)).toBe('caldav-example-com-dav-cal-personal-todos');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit src/utils/calendarStorageId.test.ts -t "storageIdForCalendar"`
Expected: FAIL — `storageIdForCalendar` is not exported.

- [ ] **Step 3: Implement the branch**

Replace the entire contents of `src/utils/calendarStorageId.ts` with:

```ts
import { CalendarMapping } from '../types';

/** Filesystem-safe, human-readable slug from an arbitrary string. */
function sanitizeStorageId(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Deterministic storage directory ID from server URL + calendar name.
 * Retained for the legacy storage scheme (and migration 002).
 */
export function calendarStorageId(serverUrl: string, calendarName: string): string {
  return sanitizeStorageId(`${serverUrl}_${calendarName}`);
}

/**
 * Storage directory ID for a calendar mapping. A legacy (or legacy-adopter)
 * calendar keeps its original serverUrl+calendarName key so its baseline is
 * never orphaned; a URL-pinned calendar keys off its unique collection URL.
 */
export function storageIdForCalendar(calendar: CalendarMapping): string {
  if (calendar.serverUrl.trim() && calendar.calendarName.trim()) {
    return calendarStorageId(calendar.serverUrl, calendar.calendarName);
  }
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) {
    return sanitizeStorageId(url);
  }
  return calendarStorageId(calendar.serverUrl, calendar.calendarName);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit src/utils/calendarStorageId.test.ts`
Expected: PASS — both the existing `calendarStorageId` tests (behavior unchanged by the refactor) and the new `storageIdForCalendar` tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calendarStorageId.ts src/utils/calendarStorageId.test.ts
git commit -m "feat(storage): resolve storage id per calendar state (legacy vs url-pinned)"
```

---

## Task 3: Add the display-label helper

**Files:**
- Create: `src/utils/calendarLabel.ts`
- Test: `src/utils/calendarLabel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/calendarLabel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit src/utils/calendarLabel.test.ts`
Expected: FAIL — module `./calendarLabel` not found.

- [ ] **Step 3: Implement the helper**

Create `src/utils/calendarLabel.ts`:

```ts
import { CalendarMapping } from '../types';

/** Last non-empty path segment of a URL, used as a fallback calendar label. */
export function lastPathSegment(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const segment = trimmed.substring(trimmed.lastIndexOf('/') + 1);
  return segment || url;
}

/**
 * Human label for a calendar: its name when set, otherwise the calendar URL's
 * last path segment, otherwise the server URL. Empty only for a blank calendar.
 */
export function calendarLabel(calendar: CalendarMapping): string {
  if (calendar.calendarName.trim()) {
    return calendar.calendarName.trim();
  }
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) {
    return lastPathSegment(url);
  }
  return calendar.serverUrl.trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit src/utils/calendarLabel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calendarLabel.ts src/utils/calendarLabel.test.ts
git commit -m "feat(utils): add calendarLabel for URL-pinned calendars"
```

---

## Task 4: Update required-field validation

**Files:**
- Modify: `src/utils/calendarConfig.ts`
- Test: `src/utils/calendarConfig.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `src/utils/calendarConfig.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit src/utils/calendarConfig.test.ts`
Expected: FAIL — the current implementation still requires `serverUrl`/`calendarName` and returns the old messages.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/utils/calendarConfig.ts` with:

```ts
import { CalendarMapping } from '../types';
import { calendarLabel } from './calendarLabel';

/**
 * Labels of required fields that are missing. A calendar can sync when it has a
 * username and either a calendar URL or a legacy serverUrl + calendarName pair.
 */
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  const missing: string[] = [];
  const hasUrl = (calendar.calendarUrl ?? '').trim() !== '';
  const hasLegacy = calendar.serverUrl.trim() !== '' && calendar.calendarName.trim() !== '';
  if (!hasUrl && !hasLegacy) {
    missing.push('calendar URL');
  }
  if (calendar.username.trim() === '') {
    missing.push('username');
  }
  return missing;
}

/** True when a calendar has every field required to attempt a sync. */
export function isCalendarConfigured(calendar: CalendarMapping): boolean {
  return missingCalendarFields(calendar).length === 0;
}

/**
 * Human-readable reason a calendar can't sync, or null when it is fully
 * configured. Names the calendar via {@link calendarLabel}, falling back to its
 * position.
 */
export function describeIncompleteCalendar(calendar: CalendarMapping, index: number): string | null {
  const missing = missingCalendarFields(calendar);
  if (missing.length === 0) {
    return null;
  }
  const name = calendarLabel(calendar) || `Calendar ${index + 1}`;
  return `${name} (missing ${missing.join(', ')})`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit src/utils/calendarConfig.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calendarConfig.ts src/utils/calendarConfig.test.ts
git commit -m "feat(config): accept a calendar URL or a legacy pair as configured"
```

---

## Task 5: Short-circuit `connect()`, add `listCalendars()`, fix the href base

**Files:**
- Modify: `src/caldav/calDAVClientDirect.ts`
- Test: `src/caldav/calDAVClientDirect.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/caldav/calDAVClientDirect.test.ts`, add these shared fixtures **after** the `mockConfig` constant (around line 8):

```ts
const PRINCIPAL_XML = `<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/.well-known/caldav</d:href>
    <d:propstat><d:prop>
      <d:current-user-principal><d:href>/principals/user/</d:href></d:current-user-principal>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const HOME_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/principals/user/</d:href>
    <d:propstat><d:prop>
      <c:calendar-home-set><d:href>/calendars/user/</d:href></c:calendar-home-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

const CALENDARS_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/personal-todos/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/user/personal-events/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Personal</d:displayname>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

function mockDiscovery(request: jest.Mock): void {
  request
    .mockResolvedValueOnce({ status: 207, text: PRINCIPAL_XML, headers: {} })
    .mockResolvedValueOnce({ status: 207, text: HOME_XML, headers: {} })
    .mockResolvedValueOnce({ status: 207, text: CALENDARS_XML, headers: {} });
}
```

Then add this `describe` block before the final closing `});` of the file:

```ts
  describe('connect(), listCalendars(), and pinned fetch', () => {
    it('uses calendarUrl directly and makes no discovery requests when pinned', async () => {
      const request = jest.fn();
      const pinned = new CalDAVClientDirect(
        { ...mockConfig, calendarUrl: 'https://caldav.example.com/calendars/user/personal-todos/' },
        { request },
      );

      await pinned.connect();

      expect(request).not.toHaveBeenCalled();
      expect(pinned.isConnected()).toBe(true);
      expect((pinned as unknown as { calendarUrl: string }).calendarUrl)
        .toBe('https://caldav.example.com/calendars/user/personal-todos/');
    });

    it('listCalendars() discovers and returns every calendar with VTODO support flags', async () => {
      const request = jest.fn();
      mockDiscovery(request);
      const c = new CalDAVClientDirect(mockConfig, { request });

      const calendars = await c.listCalendars();

      expect(calendars).toEqual([
        { url: 'https://caldav.example.com/calendars/user/personal-todos/', displayName: 'Personal', supportsVTODO: true },
        { url: 'https://caldav.example.com/calendars/user/personal-events/', displayName: 'Personal', supportsVTODO: false },
      ]);
    });

    it('connect() without calendarUrl matches the calendar by name', async () => {
      const request = jest.fn();
      mockDiscovery(request);
      const c = new CalDAVClientDirect({ ...mockConfig, calendarName: 'Personal' }, { request });

      await c.connect();

      expect((c as unknown as { calendarUrl: string }).calendarUrl)
        .toBe('https://caldav.example.com/calendars/user/personal-todos/');
    });

    it('fetchVTODOs resolves relative hrefs against the pinned URL (empty serverUrl)', async () => {
      const REPORT_XML = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/user/personal-todos/t1.ics</d:href>
    <d:propstat><d:prop>
      <c:calendar-data>BEGIN:VTODO\nUID:1\nEND:VTODO</c:calendar-data>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
      const request = jest.fn().mockResolvedValueOnce({ status: 207, text: REPORT_XML, headers: {} });
      const c = new CalDAVClientDirect(
        { ...mockConfig, serverUrl: '', calendarUrl: 'https://caldav.example.com/calendars/user/personal-todos/' },
        { request },
      );

      await c.connect();
      const vtodos = await c.fetchVTODOs();

      expect(vtodos).toHaveLength(1);
      expect(vtodos[0].url).toBe('https://caldav.example.com/calendars/user/personal-todos/t1.ics');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --selectProjects unit src/caldav/calDAVClientDirect.test.ts -t "connect(), listCalendars"`
Expected: FAIL — `listCalendars` is not a function / pinned `fetchVTODOs` throws on `new URL('')`.

- [ ] **Step 3: Export `CalendarInfo` and retype the parse helpers**

In `src/caldav/calDAVClientDirect.ts`, add this interface just after the `CalDAVConnectionConfig` interface:

```ts
/** A calendar collection discovered on the server. */
export interface CalendarInfo {
  url: string;
  displayName: string;
  supportsVTODO: boolean;
}
```

Change `parseCalendarsFromXML`'s return type and its internal `const calendars` from `Array<{ url: string; displayName: string; supportsVTODO: boolean }>` to `CalendarInfo[]`, and `findCalendars`'s return type from `Promise<Array<{ url: string; displayName: string; supportsVTODO: boolean }>>` to `Promise<CalendarInfo[]>`.

- [ ] **Step 4: Rewrite `connect()` and add `listCalendars()`**

Replace the entire `connect()` method (lines 45-68) with:

```ts
  /**
   * Connect to the CalDAV server and resolve the calendar URL.
   *
   * When `calendarUrl` is configured, it is used directly — no discovery or
   * name-matching. Otherwise the calendar is discovered and matched by name.
   */
  async connect(): Promise<void> {
    try {
      if (this.config.calendarUrl) {
        this.calendarUrl = this.config.calendarUrl;
        return;
      }

      const calendars = await this.listCalendars();
      const calendar = calendars.find(c => c.displayName === this.config.calendarName);
      if (!calendar) {
        throw new Error(`Calendar '${this.config.calendarName}' not found. Available: ${calendars.map(c => c.displayName).join(', ')}`);
      }

      this.calendarUrl = calendar.url;
    } catch (error) {
      console.error('[CalDAV] Connection failed:', error);
      throw error;
    }
  }

  /**
   * Discover and return every calendar in the user's calendar home.
   * Used by the legacy name-match path in `connect()` and by the picker UI.
   */
  async listCalendars(): Promise<CalendarInfo[]> {
    const homeUrl = await this.discoverCalendarHome();
    return this.findCalendars(homeUrl);
  }
```

- [ ] **Step 5: Resolve `fetchVTODOs` hrefs against the pinned URL**

In `fetchVTODOs()`, change the parse base from `this.config.serverUrl` to `this.calendarUrl`. The line currently reads:

```ts
    return CalDAVClientDirect.parseVTODOsFromXML(response.text, this.config.serverUrl);
```

Replace it with:

```ts
    return CalDAVClientDirect.parseVTODOsFromXML(response.text, this.calendarUrl);
```

(`fetchVTODOs` already guards `if (!this.calendarUrl) throw ...` above this line, so `this.calendarUrl` is non-null here. Resolving relative hrefs against the collection URL is correct for both pinned and legacy calendars.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest --selectProjects unit src/caldav/calDAVClientDirect.test.ts`
Expected: PASS — the new block plus all existing `parseCalendarsFromXML` / `parseVTODOsFromXML` / `parseHrefForProperty` tests.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/caldav/calDAVClientDirect.ts src/caldav/calDAVClientDirect.test.ts
git commit -m "feat(caldav): skip discovery when calendarUrl is pinned; expose listCalendars()"
```

---

## Task 6: Wire `syncEngine` to the new resolvers

**Files:**
- Modify: `src/sync/syncEngine.ts`

- [ ] **Step 1: Update the imports**

In `src/sync/syncEngine.ts`, replace the import line:

```ts
import { calendarStorageId } from "../utils/calendarStorageId";
```

with:

```ts
import { storageIdForCalendar } from "../utils/calendarStorageId";
import { calendarLabel } from "../utils/calendarLabel";
```

- [ ] **Step 2: Use the per-calendar storage id**

At line 49, replace:

```ts
		this.storage = new SyncStorage(app, calendarStorageId(calendar.serverUrl, calendar.calendarName));
```

with:

```ts
		this.storage = new SyncStorage(app, storageIdForCalendar(calendar));
```

- [ ] **Step 3: Use the label for notices and results**

Replace the four `this.calendar.calendarName` display usages with `calendarLabel(this.calendar)`:

- Line 76 (start notice):

```ts
				new Notice(`${dryRun ? "[DRY RUN] " : ""}Starting sync for ${calendarLabel(this.calendar)}...`);
```

- Line 265 (result message name):

```ts
		const name = calendarLabel(this.calendar);
```

- Line 284 (success `SyncResult.calendarName`):

```ts
			calendarName: calendarLabel(this.calendar),
```

- Lines 322 + 326 (error message + `SyncResult.calendarName`):

```ts
		const message = `[${calendarLabel(this.calendar)}] Sync failed: ${errorMsg}`;
```

```ts
			calendarName: calendarLabel(this.calendar),
```

- [ ] **Step 4: Run the sync tests**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts`
Expected: PASS — the fixtures set `calendarName`, so `calendarLabel` returns the same value (`'Work'`, `'Personal'`, `'Broken'`) and `storageIdForCalendar` returns the legacy key for those `serverUrl + calendarName` fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncEngine.ts
git commit -m "refactor(sync): resolve storage id and label per calendar state"
```

---

## Task 7: Create the "Browse calendars" modal

**Files:**
- Create: `src/ui/browseCalendarsModal.ts`

UI is coverage-excluded; verify with build + lint. All discovery/parsing logic is in the tested client.

- [ ] **Step 1: Create the modal**

Create `src/ui/browseCalendarsModal.ts` with exactly this content:

```ts
import { App, Modal, Setting } from 'obsidian';
import { CalDAVClientDirect, CalendarInfo } from '../caldav/calDAVClientDirect';
import { CalendarMapping } from '../types';

/** Origin of a URL, or '' if it can't be parsed. */
function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Discovery dialog. Takes a transient server URL (prefilled from the calendar's
 * stored server URL or the origin of its pinned URL), lists the calendars there,
 * and writes the chosen collection URL into `calendar.calendarUrl`. The typed
 * server URL is used only for discovery and is not persisted.
 */
export class BrowseCalendarsModal extends Modal {
  private readonly calendar: CalendarMapping;
  private readonly onPicked: () => Promise<void>;
  private serverUrl: string;
  private listEl!: HTMLElement;

  constructor(app: App, calendar: CalendarMapping, onPicked: () => Promise<void>) {
    super(app);
    this.calendar = calendar;
    this.onPicked = onPicked;
    this.serverUrl = calendar.serverUrl || originOf(calendar.calendarUrl);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Browse calendars' });

    new Setting(contentEl)
      .setName('Server URL')
      .setDesc('Used only to discover your calendars.')
      .addText(text => text
        .setPlaceholder('https://caldav.example.com')
        .setValue(this.serverUrl)
        .onChange(value => { this.serverUrl = value.trim(); }))
      .addButton(button => button
        .setButtonText('Find calendars')
        .setCta()
        .onClick(() => void this.find()));

    this.listEl = contentEl.createDiv();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async find(): Promise<void> {
    this.listEl.empty();
    if (!this.serverUrl) {
      this.listEl.createEl('p', { text: 'Enter your server URL first.' });
      return;
    }
    this.listEl.createEl('p', { text: 'Loading calendars…' });

    const client = new CalDAVClientDirect({ ...this.calendar, serverUrl: this.serverUrl, calendarUrl: undefined });
    let calendars: CalendarInfo[];
    try {
      calendars = await client.listCalendars();
    } catch (error) {
      this.listEl.empty();
      const message = error instanceof Error ? error.message : 'unknown error';
      this.listEl.createEl('p', { text: `Could not load calendars: ${message}` });
      return;
    }

    this.renderList(calendars);
  }

  private renderList(calendars: CalendarInfo[]): void {
    this.listEl.empty();
    if (calendars.length === 0) {
      this.listEl.createEl('p', { text: 'No calendars found on the server.' });
      return;
    }

    const sorted = [...calendars].sort((a, b) => Number(b.supportsVTODO) - Number(a.supportsVTODO));
    for (const calendar of sorted) {
      const badge = calendar.supportsVTODO ? 'tasks' : 'events only';
      new Setting(this.listEl)
        .setName(calendar.displayName)
        .setDesc(`${calendar.url} · ${badge}`)
        .addButton(button => {
          button
            .setButtonText(calendar.supportsVTODO ? 'Use' : 'Use anyway')
            .onClick(() => void this.apply(calendar.url));
          if (!calendar.supportsVTODO) {
            button.setWarning();
          }
        });
    }
  }

  private async apply(url: string): Promise<void> {
    this.calendar.calendarUrl = url;
    await this.onPicked();
    this.close();
  }
}
```

- [ ] **Step 2: Verify it builds and lints**

Run: `npm run build`
Expected: type check + esbuild succeed.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/browseCalendarsModal.ts
git commit -m "feat(ui): add browse-calendars discovery modal"
```

---

## Task 8: Replace the connection fields with a Calendar URL selector

**Files:**
- Modify: `main.ts` (imports; `renderCalendarMapping`; add `openBrowseCalendars`)

- [ ] **Step 1: Import the modal and `CalendarMapping`**

In `main.ts`, change the existing types import (line 2) from:

```ts
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from './src/types';
```

to:

```ts
import { CalDAVSettings, CalendarMapping, DEFAULT_CALDAV_SETTINGS } from './src/types';
```

and add this import after the other `./src/ui/...` import (line 7):

```ts
import { BrowseCalendarsModal } from './src/ui/browseCalendarsModal';
```

- [ ] **Step 2: Remove the "Calendar name" and "Server URL" settings**

In `renderCalendarMapping`, delete the "Calendar name" `Setting` block (lines 365-374) and the "Server URL" `Setting` block (lines 376-385) in full:

```ts
		new Setting(containerEl)
			.setName('Calendar name')
			.setDesc('Name of the calendar on the server')
			.addText(text => text
				.setPlaceholder('Work')
				.setValue(calendar.calendarName)
				.onChange(async (value) => {
					calendar.calendarName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('Calendar server URL')
			.addText(text => text
				.setPlaceholder('https://caldav.example.com')
				.setValue(calendar.serverUrl)
				.onChange(async (value) => {
					calendar.serverUrl = value;
					await this.plugin.saveSettings();
				}));
```

- [ ] **Step 3: Add the "Calendar URL" setting in their place**

Where those two blocks were (before the "Username" setting), insert:

```ts
		const calendarUrlSetting = new Setting(containerEl)
			.setName('Calendar URL')
			.addText(text => text
				.setPlaceholder('https://caldav.example.com/dav/calendars/user/personal/')
				.setValue(calendar.calendarUrl ?? '')
				.onChange(async (value) => {
					calendar.calendarUrl = value.trim() || undefined;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Browse calendars')
				.onClick(() => this.openBrowseCalendars(calendar)));

		if (!calendar.calendarUrl && calendar.calendarName.trim()) {
			calendarUrlSetting.setDesc(`Currently matched by name "${calendar.calendarName}" — paste a URL or browse to pin the exact calendar.`);
		} else {
			calendarUrlSetting.setDesc("Paste your calendar's URL, or browse to find it.");
		}
```

The "Username" and "Password" settings remain unchanged, after this block.

- [ ] **Step 4: Add the `openBrowseCalendars` helper**

Add this private method to the `CalDAVSettingTab` class (e.g. immediately after `renderCalendarMapping`):

```ts
	private openBrowseCalendars(calendar: CalendarMapping): void {
		if (!calendar.username.trim() || !calendar.password.trim()) {
			new Notice('Enter username and password first.');
			return;
		}
		new BrowseCalendarsModal(this.app, calendar, async () => {
			await this.plugin.saveSettings();
			this.display();
		}).open();
	}
```

`Notice` is already imported in `main.ts`.

- [ ] **Step 5: Verify build and lint**

Run: `npm run build`
Expected: type check + esbuild succeed.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add main.ts
git commit -m "feat(ui): configure a calendar by URL with on-demand browse"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm test`
Expected: all unit + E2E tests pass; coverage thresholds for `src/sync`, `src/caldav`, `src/tasks` are met. (The suite is fast — ~15s warm. Do not background it.)

- [ ] **Step 2: Lint the whole project**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (recommended)**

`npm run build`, then in an Obsidian vault with the plugin loaded:
- Add a calendar → enter username + password → **Browse calendars** → enter server URL → **Find calendars** → list shows `tasks` / `events only` badges, tasks first → pick one → the Calendar URL field fills in.
- **Browse calendars** with empty credentials shows the Notice.
- Paste a known calendar URL directly into the field (no Browse) and confirm a sync reads/writes that collection.
- A vault upgraded from an older version (legacy `serverUrl` + `calendarName`, no `calendarUrl`) still syncs by name, shows the "Currently matched by name …" hint, and its `.caldav-sync/calendars/<id>/` folder is unchanged (no re-sync).

- [ ] **Step 4: Confirm the issue scenario (#113)**

With two calendars sharing a name (one VTODO, one VEVENT): Browse, confirm both appear with distinct paths + badges, pick the VTODO one, and verify sync touches only that collection.

---

## Notes for the executor

- **No migration.** The field is optional; `loadData()` merges absent fields to `undefined`. Do not add a migration or touch `appliedMigrations`.
- **Legacy installs are sacred.** Never clear or rewrite an existing `serverUrl`/`calendarName`; `storageIdForCalendar` keeps their key precisely so no one re-syncs.
- **Do not change `calendarStorageId(serverUrl, calendarName)`** — migration 002 depends on its exact output. Add behavior via `storageIdForCalendar` only.
- **Commit trailers:** append the repository's required `Co-Authored-By` / `Claude-Session` trailers per the harness instructions when committing.
- **wdio fixtures** need no change: their calendars keep syncing via the legacy name-match path.
