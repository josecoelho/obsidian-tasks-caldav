# ADR-001: Direct CalDAV client over tsdav library

**Status:** Accepted
**Date:** 2025-11-14
**Supersedes:** Original design (2025-11-05) which chose tsdav

## Context

The initial design evaluated three CalDAV libraries:

1. **tsdav** (originally chosen) — TypeScript-first, modern, browser + Node.js
2. **ts-caldav** — lightweight, promise-based, good sync change detection
3. **dav** — older, widely used, less TypeScript-friendly

tsdav was initially implemented as a wrapper (`CalDAVClient` class) but encountered issues in the Obsidian runtime environment.

## Decision

Replace tsdav with a direct CalDAV implementation (`CalDAVClientDirect`) using Obsidian's native `requestUrl` API and raw XML parsing.

## Rationale

- **CORS avoidance**: Obsidian's `requestUrl` bypasses browser CORS restrictions that affected tsdav
- **Zero external dependencies**: Reduces bundle size and avoids version conflicts
- **Full protocol control**: Direct PROPFIND, REPORT, PUT, DELETE gives precise control over CalDAV discovery and operations
- **Better error handling**: Custom XML parsing allows targeted error messages for CalDAV-specific failures
- **Simpler debugging**: Raw request/response logging (via `requestDumper.ts`) for fixture generation

## Consequences

- Must maintain CalDAV protocol implementation ourselves (discovery, authentication, XML parsing)
- RFC 5545 compliance issues must be handled individually (see issues #7, #8)
- No OAuth helpers (tsdav had built-in OAuth support) — acceptable for v1 which only supports basic auth
