# iCalendar handling migration to ical.js

This documents a phased migration away from hand-rolled iCalendar/WebDAV
string handling toward the [ical.js](https://github.com/kewisch/ical.js)
engine (the parser that ships in Thunderbird — pure JS, browser-safe,
ships its own TypeScript types).

## Phase 1 — swap `VTODOMapper` internals to ical.js (this PR)

- `src/caldav/vtodoMapper.ts` now parses and serializes VTODO with
  ical.js instead of regex + manual line building. ical.js owns line
  folding/unfolding, text escaping, `VALUE=DATE` handling, and component
  scoping (`getFirstSubcomponent('vtodo')`), which removes the fragile
  `BEGIN:VTODO…END:VTODO` slice and sub-component stripping.
- **Behavior-preserving, interface unchanged.** `taskToVTODO`,
  `vtodoToTask`, `extractUID`, `extractLastModified`, the `CalendarObject`
  interface, and `getMapper()` usage are all identical. Adapters and the
  CalDAV client are untouched.
- **Domain rules preserved exactly:** inline `#tag` healing (#114), STATUS
  mapping (TODO↔NEEDS-ACTION, IN_PROGRESS↔IN-PROCESS, DONE↔COMPLETED,
  CANCELLED↔CANCELLED), the local-noon COMPLETED anchor (#43, still
  computed by our own helper — ical.js only serializes the resolved UTC
  instant, it does no timezone math), DTSTART→scheduledDate-only with
  start date local-only (#131), priority bucket mapping, and CATEGORIES
  comma/multi-line handling.
- **RRULE stays a verbatim string.** We drive ical.js'
  `design.icalendar.value.recur` (`fromICAL`/`toICAL`) directly rather
  than the `ICAL.Recur` object, because `Recur.toString()` reorders the
  rule parts. The plugin keeps translating natural-language recurrence
  with the `rrule` package elsewhere; ical.js is not used for that.
- All 517 unit tests (73 in `vtodoMapper.test.ts`) stay green with **no
  test edits** — ical.js reproduces the same byte-level output (escaping,
  folding, `VALUE=DATE`).
- **Bundle delta:** `main.js` grows from 115,127 to 193,551 bytes
  (+78,424 bytes, ~+76.6 KB minified). ical.js is bundled by esbuild (it
  is intentionally *not* added to the `external` list).

## Phase 2 — foreign-property round-trip on the write path (follow-up)

- Extend the write path to `taskToVTODO(task, uid, existingData?)`: when
  updating, parse the existing VTODO and mutate only the plugin-owned
  properties, so `VALARM`, `RELATED-TO`, `X-*`, `VTIMEZONE`, and
  `PERCENT-COMPLETE` set by other clients survive an update instead of
  being dropped.
- This is inherent to an ical.js round-trip (re-serialize the parsed
  component) and **subsumes the manual merge approach in the open "jtx
  Board compatibility" PR (#140)**. In particular it correctly handles
  the `VTIMEZONE`-vs-`VTODO` `DTSTART` case that #140's document-wide
  regex got wrong: a `VTIMEZONE` `STANDARD`/`DAYLIGHT` `DTSTART` lives in
  a different component and must never be read as the task's `DTSTART` —
  ical.js scopes to the VTODO component for free.
- Requires small adapter changes to thread `existing.data` through on
  update/complete (`src/sync/caldavAdapter.ts`).
- The `IN-PROCESS` status semantic (#140 proposes IN-PROCESS→TODO) is a
  separate decision to settle with that PR; Phase 1 keeps the current
  IN-PROCESS↔IN_PROGRESS mapping.

## Phase 3 — replace WebDAV XML parsing with `DOMParser` (follow-up)

- Replace the regex WebDAV multistatus parsing in
  `src/caldav/calDAVClientDirect.ts` (`parseVTODOsFromXML` plus the
  href/etag/calendar-data regexes) with the platform `DOMParser`
  (zero new dependency). **ical.js does not parse WebDAV XML** — this is a
  separate, distinct cleanup from the VTODO work.
- It also covers the attribute-on-tag case fixed by the DavMail PR (#143),
  which the current regex mishandles.

## What stays

- **`rrule`** remains a dependency: it does English↔RRULE natural-language
  translation (`fromText`/`toText`) on the Obsidian side, which ical.js
  does not provide.
