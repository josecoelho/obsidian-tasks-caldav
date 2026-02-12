# ADR-005: Diff-based sync architecture

**Status:** Proposed
**Date:** 2026-02-11
**Related:** GitHub issue #6

## Context

The current sync engine (v1, PR #2) has architectural issues:

- Tightly coupled — pull/push logic interleaved with markdown generation, tag cleaning, priority mapping
- Heavy use of `any` types — `convertToObsidianTaskFormat`, `createTaskMarkdown`, `shouldSyncTask`
- No delete handling — tasks deleted on one side are not removed from the other
- Hardcoded conflict resolution — "Obsidian wins" is the only strategy
- Change detection via raw markdown comparison (`task.originalMarkdown.trim()`)

## Decision

Rewrite the sync engine using a diff-based architecture with a common intermediate type.

```
Obsidian tasks  ->  CommonTask[]  (ObsidianAdapter.normalize)
CalDAV VTODOs   ->  CommonTask[]  (CalDAVAdapter.normalize)
                       |
                 diff(obsidian[], caldav[], lastSync[])
                       |
                 Changeset: creates, updates, deletes per side
                       |
                 Apply changes (conflict strategy as parameter)
```

## Key design decisions

- **`CommonTask` type** — replaces all `any` usage with a well-typed intermediate representation
- **Pure function `diff()`** — `diff(left[], right[], baseline[]) -> changes[]` is testable without mocks
- **Thin adapters** — `ObsidianAdapter` and `CalDAVAdapter` handle normalization to/from `CommonTask`
- **Delete handling** — a task present in baseline but absent from one side = deleted on that side
- **Conflict strategy as parameter** — not hardcoded; start with "CalDAV wins"

## Rationale

- Pure diff function enables comprehensive unit testing without CalDAV server or Obsidian mocks
- Adapter pattern isolates format-specific concerns
- Three-way diff (left, right, baseline) is the standard approach for bidirectional sync
- Typed `CommonTask` eliminates `any` and catches mapping bugs at compile time

## Consequences

- Significant rewrite of the sync engine
- Must migrate existing tests
- Existing sync behavior must be preserved during transition
