---
name: caldav-sync-v1
status: backlog
created: 2026-02-12T00:20:49Z
progress: 0%
prd: .claude/prds/caldav-sync-v1.md
github: https://github.com/josecoelho/obsidian-tasks-caldav/issues/12
---

# Epic: caldav-sync-v1

## Overview

Complete the CalDAV sync plugin to a releasable v1 state. The foundation is already merged (PRs #1-#5): CalDAV client, VTODO mapper, task ID generator, storage, and a basic sync engine. The remaining work is: fix VTODO parsing edge cases, rewrite the sync engine with a proper diff-based architecture, clean up the plugin UI, and write documentation.

## Architecture Decisions

All major architecture decisions are made and documented as ADRs:

- **ADR-001**: Direct CalDAV client using Obsidian `requestUrl` (no external deps)
- **ADR-002**: Require obsidian-tasks plugin
- **ADR-003**: Use `getTasks()` internal cache for task discovery
- **ADR-004**: Timestamp-based task IDs (`YYYYMMDD-xxx`)
- **ADR-005**: Diff-based sync with `CommonTask` intermediate type and pure `diff()` function

No new architecture decisions needed — this epic is execution of existing designs.

## Technical Approach

### Sync Engine (the core rewrite — GitHub #6, ADR-005)

Replace the current tightly-coupled `syncEngine.ts` with:

1. **`CommonTask` interface** — typed intermediate representation replacing all `any` usage
2. **`ObsidianAdapter`** — normalizes obsidian-tasks `Task` objects to `CommonTask[]`
3. **`CalDAVAdapter`** — normalizes VTODOs to `CommonTask[]`
4. **`diff(left[], right[], baseline[])`** — pure function producing a changeset (creates, updates, deletes per side)
5. **Changeset application** — applies changes through adapters with configurable conflict strategy

The diff function is the heart: three-way comparison using baseline (last sync snapshot) enables delete detection and conflict identification without timestamps.

### VTODO Parser Hardening (GitHub #7, #8)

Two targeted fixes in `vtodoMapper.ts`:
- **Line folding**: Unfold `\r\n ` continuations before property extraction (RFC 5545 Section 3.1)
- **TZID dates**: Strip time component from `TZID=...:YYYYMMDDTHHMMSS` and extract date-only portion

Both are small, isolated changes with existing test fixtures available.

### Plugin UI (GitHub #10)

Clean up `main.ts`:
- Remove test/debug commands (test-obsidian-tasks-access, test-task-manager, dump-caldav-requests)
- Wire ribbon icon to actual sync
- Add proper "Sync Now" and "View Sync Status" commands
- Add auto-sync interval start/stop/restart
- Fix connection test button to use `CalDAVClientDirect`

### CalDAV Client Cleanup (GitHub #9)

Extract inline XML strings from `calDAVClientDirect.ts` into string constants in a `templates.ts` file. Mustache is overkill since templates have no variables — simple constants are cleaner.

### Documentation (GitHub #11)

- Rewrite README.md (currently sample plugin boilerplate)
- Create usage guide
- Update manifest.json metadata
- Add CHANGELOG

## Implementation Strategy

**Phase 1 — Parser fixes (tasks 1):** Low-risk, unblocks better sync testing with real servers.

**Phase 2 — Sync engine rewrite (tasks 2-3):** The critical path. Build CommonTask + adapters first, then the diff engine. Heavily unit-tested since diff is a pure function.

**Phase 3 — Polish (tasks 4-6):** UI cleanup, CalDAV client cleanup, and docs. Can be parallelized.

## Task Breakdown Preview

- [ ] Task 1: Fix VTODO parser — RFC 5545 line folding + VTIMEZONE date handling (GitHub #7, #8)
- [ ] Task 2: Define CommonTask type and build ObsidianAdapter + CalDAVAdapter (GitHub #6 part 1)
- [ ] Task 3: Implement diff() function, changeset application, and sync engine integration (GitHub #6 part 2)
- [ ] Task 4: Clean up plugin UI — remove debug commands, add production commands (GitHub #10)
- [ ] Task 5: Extract CalDAV XML templates to constants (GitHub #9)
- [ ] Task 6: Documentation — README, usage guide, CHANGELOG (GitHub #11)

## Dependencies

- **obsidian-tasks plugin** — must be installed for task discovery (ADR-002)
- **CalDAV test server** — needed for integration testing (Nextcloud or Radicale)
- **Existing test fixtures** — `test-fixtures/vtodos/` contains real VTODOs from DAVx5/Tasks.org

## Success Criteria (Technical)

- `diff()` function has comprehensive unit tests covering: creates, updates, deletes, conflicts, no-ops
- VTODO round-trip tests pass with real fixtures (including folded lines, TZID dates)
- Sync completes without errors against Nextcloud and at least one other CalDAV server
- No `any` types in sync engine code path
- All test/debug commands removed from production build
- README has clear setup instructions

## Estimated Effort

- **Task 1** (parser fixes): Small — isolated changes with test fixtures ready
- **Task 2** (types + adapters): Medium — type design + two adapter implementations
- **Task 3** (diff + integration): Large — core algorithm + wiring into existing plugin
- **Task 4** (UI cleanup): Small — remove code, wire existing functionality
- **Task 5** (XML templates): Small — extract and replace
- **Task 6** (docs): Medium — README rewrite, usage guide, changelog

**Critical path:** Tasks 1 → 2 → 3 (parser fixes enable better adapter testing; adapters required by diff engine)

**Parallelizable:** Tasks 4, 5, 6 can run in parallel after task 3 or independently.

## Tasks Created
- [ ] #13 - Fix VTODO parser — RFC 5545 line folding and VTIMEZONE dates (parallel: true)
- [ ] #15 - Define CommonTask type and build sync adapters (parallel: false, depends: #13)
- [ ] #17 - Implement diff engine, changeset application, and sync integration (parallel: false, depends: #15)
- [ ] #14 - Clean up plugin UI — remove debug commands, add production commands (parallel: true, depends: #17)
- [ ] #16 - Extract CalDAV XML templates to constants (parallel: true)
- [ ] #18 - Documentation — README, usage guide, CHANGELOG (parallel: true, depends: #17, #14)
- [ ] #22 - Set up local CalDAV server for integration testing (parallel: true, depends: #13)

Total tasks: 7
Parallel tasks: 5 (#13, #14, #16, #18, #22)
Sequential tasks: 2 (#15, #17 — critical path)
Estimated total effort: 29-48 hours
