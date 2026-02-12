# ADR-004: Timestamp-based task IDs over UUIDs

**Status:** Accepted
**Date:** 2025-11-05

## Context

Each synced task needs a stable identifier to track the Obsidian task <-> CalDAV VTODO relationship. The ID is injected into the task markdown as an inline field: `[id::20251106-abc]`.

Options considered:
1. **UUID v4** — standard 36-character identifier (e.g., `550e8400-e29b-41d4-a716-446655440000`)
2. **Timestamp + random suffix** — short 12-character identifier (e.g., `20251106-abc`)
3. **Incremental counter** — simple but not collision-safe across devices

## Decision

Use timestamp-based IDs in format `YYYYMMDD-xxx` where `xxx` is a 3-character random alphanumeric suffix.

## Rationale

- **Short** (12 chars vs 36 for UUID) — less visual noise in task markdown
- **Human-readable** — creation date is embedded, making debugging easier
- **Sort-friendly** — chronological ordering by default
- **Collision-resistant** — 36^3 = 46,656 possible suffixes per day; uniqueness verified against existing IDs before assignment
- **Obsidian-compatible** — uses the obsidian-tasks `id` field format

## Consequences

- Theoretical collision risk if generating many IDs on the same day (mitigated by collision check with retry)
- IDs are never regenerated — existing IDs are preserved to support interoperability with other tools
