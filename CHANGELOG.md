# Changelog

## Unreleased

### Features

- Per-calendar filter is now configured as two independent fields, **Obsidian tag** and **Server category** (#94, #98 — thanks @AlfHou). The previous single **Tag** field is split automatically on first launch; existing setups keep their behavior. Leaving **Server category** empty pulls every task on the server (useful when clients like the iOS Reminders app can't set CATEGORIES). Different values on each side are supported when your Obsidian tag and server category vocabularies differ.

### Bug Fixes

- Convergent edits no longer trigger a conflict — when both sides independently change a task to the same value, the diff treats it as already resolved instead of forcing one side to overwrite the other (#106).

### Infrastructure

- Migrations now record which ones have already run (`appliedMigrations` in settings), so each migration executes at most once per install regardless of its own idempotency checks (#107).

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
