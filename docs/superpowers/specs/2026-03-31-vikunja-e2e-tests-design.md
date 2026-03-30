# Vikunja E2E tests to reproduce issue #60

## Problem

Tasks created on the CalDAV server side (Nextcloud/Vikunja) get duplicated on every sync. Server-created tasks never appear in the baseline or ID mappings, so each sync treats them as new and creates another copy in Obsidian. Reported in [#60](https://github.com/josecoelho/obsidian-tasks-caldav/issues/60).

## Goal

Add Vikunja as a second E2E test server to reproduce the duplication bug and validate the fix.

## Docker service

Add a `vikunja` service to `docker-compose.yml`:

- Image: `vikunja/vikunja`
- Port: `3457:3456`
- SQLite backend (no external DB needed)
- Environment: `VIKUNJA_SERVICE_PUBLICURL=http://localhost:3457`, `VIKUNJA_SERVICE_ENABLEREGISTRATION=true`
- Healthcheck on `/api/v1/info`
- tmpfs for `/db` and `/app/vikunja/files` (ephemeral test data)

## Test helper: `test/helpers/vikunjaSetup.ts`

Mirrors `radicaleSetup.ts` pattern:

- `VIKUNJA` config object (baseUrl, username, password)
- `bootstrapVikunjaUser()` — registers a test user via `POST /api/v1/register`, obtains JWT via `POST /api/v1/login`
- `createIsolatedCalendar()` — creates a Vikunja project via REST API (`POST /api/v1/projects`), returns `{ calendarName, projectId, clean, cleanup }` where calendarName is the project's display name
- CalDAV URL: `http://localhost:3457/dav/` with Basic Auth (username/password)
- The CalDAV client discovers calendars via standard well-known flow; Vikunja maps projects to calendars

## Ensure script

Rename `scripts/ensure-radicale.mjs` to `scripts/ensure-servers.mjs`. Check both Radicale (port 5232) and Vikunja (port 3457). Start `docker compose up -d --wait` if either is missing (single compose command starts both).

Update `package.json` test script to reference the new script name.

## Test files

### `test/e2e/vikunja/vikunjaClient.e2e.test.ts`

Basic CalDAV operations against Vikunja (connect, CRUD VTODO round-trip). Validates our CalDAVClientDirect works with Vikunja's CalDAV implementation.

### `test/e2e/vikunja/vikunjaSync.e2e.test.ts`

Reproduction of issue #60 — the core test:

1. Create a task directly on Vikunja (via CalDAV PUT)
2. Run sync logic (normalize → diff → apply) simulating first sync
3. Run sync logic again with updated baseline
4. Assert no duplicate tasks are created on the second sync

Additional scenarios:
- Task created on both sides simultaneously
- Server-created task updated after initial sync

## What changes

| File | Change |
|------|--------|
| `docker-compose.yml` | Add `vikunja` service |
| `scripts/ensure-radicale.mjs` | Rename to `ensure-servers.mjs`, add Vikunja check |
| `package.json` | Update test script path |
| `test/helpers/vikunjaSetup.ts` | New file — server config, user bootstrap, calendar creation |
| `test/e2e/vikunja/vikunjaClient.e2e.test.ts` | New file — basic CRUD E2E |
| `test/e2e/vikunja/vikunjaSync.e2e.test.ts` | New file — issue #60 reproduction |

## What stays the same

- `CalDAVClientDirect` — reused as-is (server-agnostic)
- `FetchHttpClient` — same transport
- `radicaleSetup.ts` — untouched
- Existing Radicale E2E tests — untouched
- Jest config — already matches `**/*.e2e.test.ts` under `test/e2e`
