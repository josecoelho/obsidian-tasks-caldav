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
events calendar that share the name "Personal".

Two consequences of the current model:
1. **Ambiguity:** display name is not a unique identifier, so matching is unreliable.
2. **Cost:** discovery (3–4 PROPFINDs) plus the name match run on *every* sync, because
   `connect()` is called per-sync from `caldavAdapter.fetch()` (`src/sync/caldavAdapter.ts:28`).

## Goal

Let a user pin a calendar by its **exact collection URL**, which is unique and lets the client skip
discovery and name-matching entirely. Most users don't know that URL offhand, so the primary path is
a discover-and-pick flow; a manual URL field is the escape hatch.

## Decisions (from brainstorming)

- **Selection UX:** calendar selection is a single **Calendar** control in settings — a chip showing
  the pinned calendar with Change/Clear, or a "Choose calendar" button when unset. There are no
  free-text name/URL fields in the calendar block; both live behind a "Select calendar" modal.
- **Modal has two paths:** paste a known URL directly (no discovery round-trip), or "Browse
  calendars" to discover and pick. The modal opens instantly; discovery runs only on demand.
- **Migration:** opt-in, zero disruption. Existing setups keep working via name-matching with no
  re-sync. The URL is purely additive.
- **Non-VTODO handling:** show all calendars with a `tasks` / `events only` badge (tasks-first);
  warn — never hide — when an `events only` calendar is picked, because server VTODO-capability
  reporting is sometimes a false negative.

## Design

### 1. Data model

Add an optional field to `CalendarMapping` (`src/types.ts`):

```ts
export interface CalendarMapping {
  obsidianTag: string;
  caldavCategory: string;
  calendarName: string;
  serverUrl: string;
  username: string;
  password: string;
  /**
   * Exact CalDAV collection URL. When set, the client talks to this collection
   * directly and skips discovery + name-matching. When empty/undefined, the
   * client discovers calendars and matches by `calendarName` (legacy behavior).
   */
  calendarUrl?: string;
}
```

**Semantics**
- `calendarUrl` set → exact collection to read/write; discovery and name-matching skipped.
- `calendarUrl` empty/undefined → unchanged legacy behavior (discover → `displayName === calendarName`).

**`serverUrl` and `calendarName` stay required.**
- `serverUrl` anchors credentials/discovery (used by "Browse") and the local storage key.
- `calendarName` is no longer a free-text *selector* in the UI. It becomes a **label** populated by
  the pick (display name), the manual-URL path (last path segment), or a legacy typed value — and it
  remains the local storage key and the legacy by-name matcher when no `calendarUrl` is set. In the
  new settings UI it is shown read-only inside the calendar chip, which removes the storage-key
  footgun of free-editing it.

**Storage identity is unchanged.** The per-calendar baseline + id-mapping folder is keyed by
`calendarStorageId(serverUrl, calendarName)` (`src/utils/calendarStorageId.ts`). Pinning a URL never
changes that key, so no baseline is orphaned and no full re-sync is triggered.

### 2. No migration

This change is purely additive:
- Existing `data.json` has no `calendarUrl` → `loadData()` merge leaves it `undefined` → identical
  behavior.
- No `appliedMigrations` entry, no storage-folder moves.
- The wdio fixture vault `data.json` is unaffected (the field is optional).

### 3. Client behavior (`src/caldav/calDAVClientDirect.ts`)

- `CalDAVConnectionConfig` gains `calendarUrl?: string`.
- `connect()`:
  - If `config.calendarUrl` is truthy → set `this.calendarUrl = config.calendarUrl` and return.
    No discovery requests.
  - Else → current discovery + name-match path (unchanged).
  - No separate validation request: the next `REPORT` in the sync pipeline surfaces a bad URL with a
    clear error, and picker-sourced URLs are already known to exist.
- Extract the discovery currently inline in `connect()` into a public method:

  ```ts
  listCalendars(): Promise<Array<{ url: string; displayName: string; supportsVTODO: boolean }>>
  ```

  It runs `discoverCalendarHome()` + `findCalendars()` and returns the parsed list. `connect()`'s
  legacy branch reuses it. The picker modal's "Browse" path calls it directly.
- Add a best-effort single-URL lookup for the manual-paste path:

  ```ts
  describeCalendarUrl(url: string): Promise<{ displayName: string; supportsVTODO: boolean } | null>
  ```

  One `PROPFIND` `Depth: 0` against the URL for `displayname` + `supported-calendar-component-set`.
  Returns `null` on any failure — the modal then falls back to the URL's last path segment as the
  label and an "unknown type" badge. Never blocks storing the URL.

### 4. UX / settings (`main.ts` + new `src/ui/calendarPickerModal.ts`)

Calendar selection is **one control**, not two competing text fields. Within each calendar block in
`CalDAVSettingTab.renderCalendarMapping`, after server URL / username / password, render a single
**Calendar** row whose state depends on the mapping:

- **Pinned (`calendarUrl` set):** a chip showing `calendarName · path`, with **Change** (reopens the
  modal) and **Clear** (unsets `calendarUrl`, reverting to name-matching) buttons. The
  `tasks`/`events only` badge is shown in the picker at selection time (where the decision is made),
  not persisted in the chip.
- **Legacy by-name (`calendarUrl` empty, `calendarName` set):** show
  `⚠ matched by name "<calendarName>"` with a **Choose calendar** button to pin an exact one.
- **Unset (both empty):** a **Choose calendar** button. If `serverUrl`/`username`/`password` are
  empty, it shows a Notice asking the user to fill them first (Browse needs them; manual paste does
  not, but a single gate keeps it simple).

The name is shown read-only inside the chip — there is no free-text "calendar name" or "calendar URL"
field in the calendar block anymore. Both live behind the modal.

**`CalendarPickerModal`** (`src/ui/calendarPickerModal.ts`, extends `Modal`, titled "Select
calendar"). Opens **instantly** with two paths; discovery only runs on demand:

1. **Paste a URL** (top): a "Calendar URL" text input + **Use this URL** button. For users who
   already know their URL — no discovery round-trip. On confirm:
   - Calls `describeCalendarUrl(url)` (best-effort) to fill the chip's name + badge; on failure,
     derives the label from the URL's last path segment and marks the type unknown.
   - If the result is `events only`, confirm with a warning first.
   - Stores `calendar.calendarUrl`; fills `calendar.calendarName` only if currently empty.
2. **Browse calendars** (below): a button that calls `listCalendars()` (loading state → list, or a
   clear error). Each row: display name + full path/URL + `tasks` / `events only` badge,
   VTODO-capable first. Selecting a row applies the same outcome as above (events-only warning,
   store URL, fill empty name).

On any successful selection the modal saves settings, closes, and re-renders the settings tab so the
chip reflects the new pin.

UI text follows sentence case (project convention).

### 5. Testing

- **Unit — `src/caldav/calDAVClientDirect.test.ts`:**
  - `connect()` with `calendarUrl` set issues **zero** discovery requests and leaves `calendarUrl`
    pointing at the configured URL.
  - `connect()` without `calendarUrl` still discovers + matches by name (existing behavior).
  - `listCalendars()` returns the parsed calendar list (reuse existing PROPFIND XML fixtures).
  - `describeCalendarUrl()` parses display name + VTODO support from a single-collection PROPFIND,
    and returns `null` on a non-207 / malformed response (manual-paste fallback path).
- **Unit — `src/utils/calendarConfig.test.ts`:** required-field set is unchanged
  (`serverUrl`, `username`, `calendarName`); `calendarUrl` is not required.
- **UI:** `src/ui/` is excluded from coverage thresholds; the testable logic (discovery parsing)
  lives in the client. Light smoke only for the modal.
- A wdio scenario for the picker is a possible follow-up, not part of this change.

`npm test` must pass (unit + E2E with coverage). Work is done when it passes.

### 6. Non-goals

- Syncing two calendars that share the same `serverUrl + calendarName` *simultaneously* — that would
  collide on the local storage key. It is a separate latent edge case, not required by #113 (which
  needs to pick *one* of two same-named calendars).
- Auto-deriving `serverUrl` from a pasted full URL — `serverUrl` stays explicit (it anchors the
  storage key and credentials).
