# Pin a CalDAV calendar by URL

**Issue:** [#113](https://github.com/josecoelho/obsidian-tasks-caldav/issues/113) — Request to fix CalDAV
calendar matching logic (use calendar path/URL instead of just name).

## Problem

A calendar mapping currently stores a server *base* URL plus a `calendarName`. On every sync,
`CalDAVClientDirect.connect()` runs CalDAV discovery (well-known → principal → calendar-home-set →
list calendars) and selects the calendar whose `displayName` equals `calendarName`
(`src/caldav/calDAVClientDirect.ts:57`).

When two calendars share a display name — e.g. a VTODO "Personal" and a VEVENT "Personal" — the
`.find()` returns whichever the server lists first. Tasks can then be read from / written to the
wrong collection. The reporter sees this as data corruption/overlap between a tasks calendar and an
events calendar both named "Personal".

Three problems with the current model:
1. **Ambiguity:** display name is not unique, so matching is unreliable.
2. **Cost:** discovery (3–4 PROPFINDs) + the name match run on *every* sync, because `connect()` is
   called per-sync from `caldavAdapter.fetch()` (`src/sync/caldavAdapter.ts:28`).
3. **Redundant UX:** the user supplies a server *base* URL *and* a calendar *name* — two inputs for
   "which calendar?", and still ambiguous.

## Goal

Identify a calendar by its **exact collection URL**, which is unique and lets the client skip
discovery + name-matching. Settings collapse to a single **Calendar URL** field. The server URL — only
needed to *discover* calendars when the user doesn't know the URL — moves into an on-demand "Browse
calendars" modal and is never a persistent settings field.

## Decisions (from brainstorming)

- **Single persistent URL.** Settings shows one **Calendar URL** field (+ Browse + credentials).
  Paste a known URL and you're done. The server URL appears only transiently inside the Browse modal.
- **Migration:** opt-in, zero disruption, **no migration**. Existing name-based calendars keep working
  unchanged; their local sync history (baseline) is never re-keyed or re-synced.
- **Non-VTODO handling:** the Browse list shows all calendars with a `tasks` / `events only` badge
  (tasks-first); picking an `events only` one warns — never hides — because server VTODO-capability
  reporting is sometimes a false negative.

## Model: three states a calendar can be in

| State | `calendarUrl` | `serverUrl` + `calendarName` | Behavior |
|-------|---------------|------------------------------|----------|
| **URL-pinned** (new default) | set | empty | Talk to the URL directly; skip discovery. |
| **Legacy by-name** | empty | set (from old installs) | Discover + match by name (unchanged). |
| **Legacy adopter** | set | set (kept) | Talk to the URL directly; storage key stays on the legacy pair so there is no re-sync. |

`serverUrl` and `calendarName` are **internal** — not shown as settings fields. They persist only for
legacy installs; new URL-pinned calendars leave them empty.

## Design

### 1. Data model

Add an optional field to `CalendarMapping` (`src/types.ts`):

```ts
export interface CalendarMapping {
  obsidianTag: string;
  caldavCategory: string;
  calendarName: string;   // internal: legacy match key + storage key + label (empty for URL-pinned)
  serverUrl: string;      // internal: legacy discovery base + storage key (empty for URL-pinned)
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

### 2. No migration

Purely additive. Existing `data.json` has no `calendarUrl` → it stays a legacy by-name calendar and
behaves exactly as today. No `appliedMigrations` entry, no storage-folder moves. The wdio fixture
vaults are unaffected (the field is optional; their calendars keep syncing by name).

### 3. Storage identity (branch — `src/utils/calendarStorageId.ts`)

The per-calendar baseline + id-mapping folder must stay stable so no one re-syncs. Add a
calendar-aware resolver that branches by state, and keep the existing `calendarStorageId(serverUrl,
calendarName)` untouched (migration 002 still depends on it):

```ts
export function storageIdForCalendar(calendar: CalendarMapping): string {
  // Legacy + legacy-adopter: keep the original key so the baseline is never orphaned.
  if (calendar.serverUrl.trim() && calendar.calendarName.trim()) {
    return calendarStorageId(calendar.serverUrl, calendar.calendarName);
  }
  // URL-pinned: key off the unique collection URL.
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) {
    return sanitizeStorageId(url);
  }
  return calendarStorageId(calendar.serverUrl, calendar.calendarName);
}
```

`sanitizeStorageId` is the existing filesystem-safe sanitizer, extracted so both functions share it.
The legacy-pair branch comes **first**, so a legacy adopter who pins a URL keeps the original key.

### 4. Display label (`src/utils/calendarLabel.ts`, new)

URL-pinned calendars have an empty `calendarName`, so anything that showed the name needs a fallback:

```ts
export function lastPathSegment(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const segment = trimmed.substring(trimmed.lastIndexOf('/') + 1);
  return segment || url;
}

export function calendarLabel(calendar: CalendarMapping): string {
  if (calendar.calendarName.trim()) return calendar.calendarName.trim();
  const url = (calendar.calendarUrl ?? '').trim();
  if (url) return lastPathSegment(url);
  return calendar.serverUrl.trim();
}
```

`syncEngine` uses `calendarLabel(this.calendar)` for its start/complete/error notices and for the
`SyncResult.calendarName` field, so `syncResultModal` (which reads `result.calendarName`) needs no
change.

### 5. Client behavior (`src/caldav/calDAVClientDirect.ts`)

- `CalDAVConnectionConfig` gains `calendarUrl?: string`.
- `connect()`: if `config.calendarUrl` is set → assign `this.calendarUrl` and return (no discovery).
  Else → current discovery + name-match path.
- Extract discovery into a public `listCalendars(): Promise<CalendarInfo[]>` (used by the Browse
  modal). Export `interface CalendarInfo { url; displayName; supportsVTODO }`.
- `fetchVTODOs()` resolves relative hrefs against `this.calendarUrl` (the resolved collection) instead
  of `this.config.serverUrl`. This is both more correct and necessary, since URL-pinned calendars have
  an empty `serverUrl`.

### 6. Required-field validation (`src/utils/calendarConfig.ts`)

A calendar can sync when it has credentials and *either* a URL *or* a legacy pair:

```ts
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  const missing: string[] = [];
  const hasUrl = (calendar.calendarUrl ?? '').trim() !== '';
  const hasLegacy = calendar.serverUrl.trim() !== '' && calendar.calendarName.trim() !== '';
  if (!hasUrl && !hasLegacy) missing.push('calendar URL');
  if (calendar.username.trim() === '') missing.push('username');
  return missing;
}
```

`describeIncompleteCalendar` names the calendar via `calendarLabel(calendar)`, falling back to a
positional `Calendar N`.

### 7. UX / settings (`main.ts` + new `src/ui/browseCalendarsModal.ts`)

Per calendar block (after the tag/category filters), the connection inputs become:

- **Calendar URL** — one text field bound to `calendar.calendarUrl`. Paste a URL → done. Description:
  "Paste your calendar's URL, or browse to find it." When empty and the mapping is legacy by-name,
  show "Currently matched by name \"<calendarName>\" — paste a URL or browse to pin the exact calendar."
- **Browse calendars** button → opens `BrowseCalendarsModal`. Requires username + password (Notice if
  missing).
- **Username**, **Password** — unchanged.

There is **no** "Server URL" field and **no** "Calendar name" field anymore.

**`BrowseCalendarsModal`** (`src/ui/browseCalendarsModal.ts`, extends `Modal`, titled "Browse
calendars"):
- A transient **Server URL** input, prefilled from `calendar.serverUrl` or the origin of
  `calendar.calendarUrl` if present, else empty.
- A **Find calendars** button → builds a `CalDAVClientDirect` with that server URL + the calendar's
  credentials and calls `listCalendars()` (loading → list, or a clear error).
- Each row: display name + full path/URL + `tasks` / `events only` badge, VTODO-capable first.
  Selecting a row (with an events-only warning when applicable) sets `calendar.calendarUrl = <url>`,
  invokes the `onPicked` callback (settings saves + re-renders), and closes. The typed server URL is
  used only for discovery — it is not persisted.

UI text follows sentence case (project convention).

### 8. Testing

- **Unit — `src/caldav/calDAVClientDirect.test.ts`:** `connect()` with `calendarUrl` set makes **zero**
  discovery requests and pins the URL; `connect()` without it still matches by name; `listCalendars()`
  returns the parsed list (reuse existing PROPFIND XML fixtures).
- **Unit — `src/utils/calendarStorageId.test.ts`:** `storageIdForCalendar` returns the legacy key for
  a legacy / legacy-adopter calendar and a URL-derived key for a URL-pinned one.
- **Unit — `src/utils/calendarLabel.test.ts`:** label resolves name → path segment → server URL;
  `lastPathSegment` strips trailing slashes.
- **Unit — `src/utils/calendarConfig.test.ts`:** a URL-only calendar (no server URL / name) is
  configured; a legacy pair is configured; a blank one reports `calendar URL` + `username`.
- **UI:** `src/ui/` is coverage-excluded; logic lives in tested utils/client. Light smoke only.

`npm test` must pass (unit + E2E with coverage). Work is done when it passes.

### 9. Non-goals

- Syncing two calendars that share the same `serverUrl + calendarName` *simultaneously* — a local
  storage-key collision in the legacy scheme. Not required by #113 (which needs to pick *one* of two
  same-named calendars), and URL-pinned calendars avoid it entirely.
- Re-keying storage when a user repoints an existing URL-pinned calendar to a different collection —
  treated as a remove-and-re-add, not an in-place migration.
