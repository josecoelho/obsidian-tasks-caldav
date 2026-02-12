# ADR-002: Require obsidian-tasks plugin as a dependency

**Status:** Accepted
**Date:** 2025-11-06

## Context

Two approaches for discovering and parsing tasks in the vault:

1. **Require obsidian-tasks** — use its internal cache and parsing
2. **Fallback to basic parsing** — support both obsidian-tasks and manual markdown parsing

## Decision

Require obsidian-tasks as a mandatory dependency. The plugin will not load without it.

## Rationale

- Users wanting CalDAV sync for tasks already have obsidian-tasks installed
- obsidian-tasks handles custom statuses, priority emojis, date formats, recurrence rules, and dependencies — reimplementing this is not feasible
- Single code path is simpler and more reliable
- Tested with 2,811 real tasks in a production vault

## Consequences

- Plugin will not work without obsidian-tasks installed and enabled
- Must monitor obsidian-tasks releases for breaking changes to internal APIs
- Clear error message shown if obsidian-tasks is missing
