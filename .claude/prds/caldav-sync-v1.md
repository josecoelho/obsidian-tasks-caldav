---
name: caldav-sync-v1
description: Bidirectional sync between Obsidian tasks (via obsidian-tasks plugin) and CalDAV servers
status: backlog
created: 2026-02-12T00:19:28Z
---

# PRD: caldav-sync-v1

## Executive Summary

An Obsidian plugin that enables bidirectional synchronization between markdown tasks managed by the obsidian-tasks plugin and CalDAV-compatible servers (Nextcloud, Radicale, DAVx5/Tasks.org, etc.). Users can sync their Obsidian task lists with any CalDAV task list, keeping both sides in sync with conflict detection and resolution.

The foundation (task ID generation, CalDAV client, VTODO mapping, storage, basic sync engine) is implemented and merged (PRs #1-#5). This PRD covers completing v1 to a releasable state.

## Problem Statement

Users who manage tasks in Obsidian with the obsidian-tasks plugin have no way to access those tasks on mobile or other devices without Obsidian. CalDAV is the open standard for task synchronization supported by most task apps (Apple Reminders, Tasks.org, Nextcloud Tasks, Thunderbird, etc.).

Currently there is no Obsidian plugin that bridges obsidian-tasks with CalDAV. Users must manually duplicate tasks or give up on one system.

## User Stories

### US-1: Mobile task access
**As** an Obsidian user who manages tasks with obsidian-tasks,
**I want** my tasks to sync to a CalDAV server,
**So that** I can view and complete tasks from my phone using any CalDAV-compatible app.

**Acceptance criteria:**
- Tasks matching a configurable query are pushed to CalDAV
- Task status, due date, priority, and description are preserved
- Completing a task on mobile is reflected in Obsidian on next sync

### US-2: Sync from CalDAV to Obsidian
**As** a user who creates tasks on mobile,
**I want** new CalDAV tasks to appear in my Obsidian vault,
**So that** I have a single source of truth in my notes.

**Acceptance criteria:**
- New tasks created on CalDAV appear in a configurable destination file
- Task metadata (dates, priority, status) is mapped correctly
- Tasks get an Obsidian task ID assigned automatically

### US-3: Conflict handling
**As** a user who edits tasks on both sides between syncs,
**I want** conflicts to be detected and resolved,
**So that** I don't lose changes from either side.

**Acceptance criteria:**
- Conflicts are detected via three-way diff (baseline, Obsidian, CalDAV)
- Conflict resolution strategy is configurable
- No silent data loss

### US-4: Tag-based sync filtering
**As** a user with many tasks,
**I want** to sync only tasks with a specific tag (e.g., `#caldav`),
**So that** I control which tasks are visible externally.

**Acceptance criteria:**
- Sync query is configurable using obsidian-tasks filter syntax
- Only matching tasks are synced
- Unmatched tasks are never modified

## Requirements

### Functional Requirements

#### FR-1: CalDAV connectivity
- Connect to CalDAV servers using basic authentication
- Discover calendars via PROPFIND/well-known
- CRUD operations on VTODOs (create, read, update, delete)
- Connection test button in settings
- **Status:** Implemented (CalDAVClientDirect, see ADR-001)

#### FR-2: Task discovery and ID management
- Access obsidian-tasks cache via `getTasks()` (see ADR-003)
- Filter tasks using configurable query
- Generate timestamp-based IDs for tasks without IDs (see ADR-004)
- Preserve existing task IDs
- **Status:** Implemented (TaskManager, TaskIdGenerator)

#### FR-3: VTODO mapping
- Bidirectional mapping: Obsidian task <-> VTODO
- Map: status, summary/description, due date, start date, completed date, priority
- Handle RFC 5545 line folding (GitHub issue #7)
- Handle VTIMEZONE dates with TZID parameters (GitHub issue #8)
- **Status:** Partially implemented (vtodoMapper — issues #7, #8 outstanding)

#### FR-4: Sync engine
- Bidirectional sync with three-way diff (baseline, Obsidian, CalDAV)
- Create, update, and delete tasks on both sides
- Configurable conflict resolution strategy
- Mapping persistence in `.caldav-sync/`
- **Status:** Needs rewrite (current engine is MVP — GitHub issue #6, ADR-005)

#### FR-5: Plugin UI
- Settings tab with CalDAV connection config, sync query, interval
- Ribbon icon for manual sync
- "Sync Now" command
- "View Sync Status" command
- Auto-sync interval management
- **Status:** Partially implemented (GitHub issue #10)

#### FR-6: Documentation
- README with setup instructions
- Usage guide
- CHANGELOG
- **Status:** Not started (GitHub issue #11)

### Non-Functional Requirements

#### NFR-1: Performance
- Sync should complete within 10 seconds for up to 500 tasks
- In-memory caching for SyncStorage (implemented, PR #3)
- No blocking of Obsidian UI during sync

#### NFR-2: Reliability
- Network failures handled gracefully with user notification
- Corrupted state files recovered with warning
- No silent data loss — conflicts surfaced to user

#### NFR-3: Compatibility
- Tested with: Nextcloud, Radicale, DAVx5/Tasks.org
- Obsidian v0.15.0+
- Requires obsidian-tasks plugin (ADR-002)

#### NFR-4: Security
- Passwords stored via Obsidian's data persistence
- HTTPS enforced (warn on HTTP)
- Credentials never logged

## Success Criteria

- Bidirectional sync works reliably with at least 2 CalDAV servers (Nextcloud + one other)
- Task status, dates, and priority round-trip without data loss
- Conflicts detected and surfaced to user (no silent overwrites)
- Plugin loads and syncs without errors in production vault
- Unit test coverage for sync diff logic, VTODO mapping, and adapters

## Constraints & Assumptions

- **Constraint:** obsidian-tasks plugin must be installed (ADR-002)
- **Constraint:** `getTasks()` is undocumented and may break in future obsidian-tasks versions (ADR-003)
- **Constraint:** Basic auth only for v1 (no OAuth)
- **Assumption:** Users have a working CalDAV server with task list support
- **Assumption:** Single CalDAV account per vault

## Out of Scope

- Multiple CalDAV accounts/calendars
- OAuth authentication
- Subtask/checklist synchronization
- Attachment support
- Tag/category bidirectional sync (tags used for filtering only)
- Recurrence rule sync (RRULE)
- Standalone operation without obsidian-tasks

## Dependencies

- **obsidian-tasks plugin** — required for task discovery and parsing
- **Obsidian Plugin API** — `requestUrl` for CalDAV HTTP, Vault API for file operations
- **CalDAV server** — user-provided, RFC 4791 compliant

## Existing GitHub Issues

| Issue | Title | Category |
|-------|-------|----------|
| #6 | Rewrite sync engine with diff-based architecture | Sync engine |
| #7 | Handle RFC 5545 line folding in iCal parser | VTODO parsing |
| #8 | Handle VTIMEZONE dates (TZID parameter) in VTODO parser | VTODO parsing |
| #9 | Use Mustache templates for CalDAV request XML bodies | CalDAV client |
| #10 | Plugin UI: ribbon icon, sync commands, auto-sync interval | Plugin UI |
| #11 | Documentation: README, usage guide, release prep | Documentation |

## ADRs

- [ADR-001: Direct CalDAV client over tsdav](../docs/adr/001-direct-caldav-client.md)
- [ADR-002: Require obsidian-tasks plugin](../docs/adr/002-require-obsidian-tasks.md)
- [ADR-003: Use getTasks() internal cache](../docs/adr/003-use-gettasks-cache.md)
- [ADR-004: Timestamp-based task IDs](../docs/adr/004-timestamp-task-ids.md)
- [ADR-005: Diff-based sync architecture](../docs/adr/005-diff-based-sync-architecture.md)
