# ADR-003: Use obsidian-tasks internal getTasks() cache

**Status:** Accepted
**Date:** 2025-11-06

## Context

obsidian-tasks exposes a minimal public API (`apiV1`) with only three methods:
- `createTaskLineModal()` — opens creation UI
- `editTaskLineModal(taskLine)` — opens edit UI
- `executeToggleTaskDoneCommand(line, path)` — toggles done status

None of these support searching or listing tasks. However, the plugin maintains an internal cache accessible via `getTasks()`.

## Decision

Use the undocumented `getTasks()` method on the obsidian-tasks plugin instance to retrieve all parsed tasks, then filter in our code.

## Rationale

- The public API has no search/list capability — `getTasks()` is the only way to access parsed tasks programmatically
- Returns full `Task` objects with all metadata (dates, priority, tags, recurrence, status, location)
- Respects all obsidian-tasks configuration (custom statuses, emoji formats, etc.)
- Verified working in production vault with 2,811 tasks
- Alternative (parsing markdown ourselves) would duplicate obsidian-tasks' complex parsing logic and miss custom configurations

## Risks

- `getTasks()` is undocumented and may change without notice in future obsidian-tasks releases
- TypeScript types are maintained manually (see `src/types/obsidianTasksApi.ts`)

## Consequences

- Must pin or test against specific obsidian-tasks versions
- Should monitor the obsidian-tasks repo for API changes
- If `getTasks()` is removed, we would need to either request a public search API or implement our own markdown parser
