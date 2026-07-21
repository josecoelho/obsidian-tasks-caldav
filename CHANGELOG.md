# Changelog

## Unreleased

## 1.6.0

### Features

- **CalDAV passwords are stored in Obsidian's secret storage** instead of plain text, on Obsidian versions that support it (#133 — thanks @LukasWestholt).
- **Mobile support** with a per-device sync switch, so you can enable syncing selectively per device (#46, #134).
- **Foreign VTODO properties are preserved on update.** Reminders (`VALARM`), `RELATED-TO`, `X-*` extensions, `PERCENT-COMPLETE`, and `VTIMEZONE` blocks written by other CalDAV clients now survive an Obsidian-side edit instead of being dropped, and `STATUS:IN-PROCESS` (e.g. from jtx Board) is kept rather than overwritten with `NEEDS-ACTION` on every sync (#147, supersedes #140 — thanks @LukasWestholt).
- Per-calendar filter is now configured as two independent fields, **Obsidian tag** and **Server category** (#94, #98 — thanks @AlfHou). The previous single **Tag** field is split automatically on first launch; existing setups keep their behavior. Leaving **Server category** empty pulls every task on the server (useful when clients like the iOS Reminders app can't set CATEGORIES). Different values on each side are supported when your Obsidian tag and server category vocabularies differ.

### Bug Fixes

- **Fixed a task-duplication loop.** When a task's ID drifts out of the id-mapping (an interrupted sync, a backup restore, multi-device use, or a from-scratch resync), the plugin now reconciles it to the task already on the server instead of creating a duplicate — which previously got pulled back into the vault and re-duplicated, amplifying on every sync (#149).
- **Vault-side edits of pulled tasks are no longer reverted.** A task first pulled from the server now receives its stable Obsidian ID at discovery, so the sync baseline pairs with it correctly instead of treating later edits as no-baseline conflicts (#144 — surfaced by @ebakerisu14's DavMail testing in #143).
- VTODO sub-components (e.g. `VALARM`) are stripped before task properties are extracted, so reminder text no longer bleeds into the task summary or notes (#139).
- `calendar-data` with attributes or an inline `xmlns` on the tag now parses correctly (Open-Xchange / mailbox.org / DavMail) (#137).
- Convergent edits no longer trigger a conflict — when both sides independently change a task to the same value, the diff treats it as already resolved instead of forcing one side to overwrite the other (#106).
- Corrected the DTSTART metadata mapping description in the README (#141).

### Infrastructure

- **iCalendar parsing and serialization moved to the [`ical.js`](https://github.com/kewisch/ical.js) library** (the engine Thunderbird uses), for more robust VTODO handling and automatic round-tripping of properties the plugin doesn't manage (#145, #147).
- **WebDAV multistatus responses are parsed with the built-in `DOMParser`** instead of hand-rolled regex, handling namespaces, CDATA, and attributed tags natively (#148 — thanks @ebakerisu14, whose DavMail / Exchange (O365) testing in #143 exercised the attributed-tag path).
- Migrations now record which ones have already run (`appliedMigrations` in settings), so each migration executes at most once per install regardless of its own idempotency checks (#107).
- Dependency updates (#146).

## 1.0.0

### Features

- Bidirectional CalDAV sync with tag-based filtering (#2)
- Diff-based sync engine with three-way merge and delete detection (#24)
- Auto-sync with configurable interval (#31)
- Dry-run mode for sync preview (#4)
- Task notes round-trip as VTODO DESCRIPTION (#33)
- Recurrence (RRULE) round-trip between CalDAV and obsidian-tasks (#27)
- Task ID generation and injection using obsidian-tasks native `🆔` format (#1, #24)
- Conflict detection with manual or auto-resolve modes (#24)
- Configurable delete behavior: ask, delete CalDAV, delete Obsidian, keep both (#24)

### Bug Fixes

- Clean task descriptions — strip tags and metadata from VTODO SUMMARY (#5)
- Handle RFC 5545 line folding and TZID dates in VTODO parser (#20)
- Fix DTSTART mapping to start date instead of scheduled date (#24)
- Fix timezone-safe date handling for date-only strings (#4)
- Fix CDATA-wrapped calendar-data and multi-line CATEGORIES parsing (#4)

### Performance

- In-memory caching for sync storage — O(1) file operations per sync (#3)

### Infrastructure

- E2E test suite against Radicale CalDAV server via Docker (#23)
- CI workflow with unit and E2E test jobs (#28)
- Coverage thresholds enforced per directory (#28)
- CalDAV XML templates extracted to constants (#29)
- Plugin initialization cleanup — single SyncEngine init, no ribbon icon (#32)

### Foundation

- CalDAV client using Obsidian's `requestUrl` API — no CORS issues (#1, #2)
- VTODO mapper with status, priority, date, and tag mapping (#1)
- Task manager integration with obsidian-tasks `getTasks()` cache (#1)
- Sync storage with task-to-CalDAV UID mapping (#1)
