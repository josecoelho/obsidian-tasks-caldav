# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Also read `AGENTS.md`** for standard Obsidian community plugin conventions (file structure, manifest rules, security, UX guidelines, coding conventions). This file covers project-specific instructions.

## Project Overview

This is an Obsidian community plugin that provides bidirectional sync between obsidian-tasks and CalDAV servers. Built with TypeScript, bundled with esbuild.

## Development Commands

- `npm run dev` - Start development with watch mode
- `npm run build` - Production build with type checking (`tsc -noEmit -skipLibCheck` then esbuild)
- `npm run lint` - Run ESLint with Obsidian plugin rules
- `npm test` - Run all tests (unit + E2E) with coverage. **Work is done when this passes.**
- `npm run test:watch` - Watch mode for unit tests only
- `npm run version` - Bump version numbers in manifest.json and versions.json

## Coding Standards

### TypeScript
- **No `any`** — use proper types, `unknown`, or type assertions with explanations
- **No floating promises** — always `await`, `void`, or `.catch()` promises
- **No unnecessary type assertions** — only cast when the type actually changes
- **Async functions must use `await`** — if a function doesn't await, don't mark it `async`

### UI Text
- **Sentence case everywhere** — headings, buttons, notices, command names
  - Correct: "Sync with CalDAV now", "View sync status"
  - Wrong: "Sync With CalDAV Now", "View Sync Status"
- See Obsidian style guide: https://help.obsidian.md/style-guide

### Linting
- ESLint config: `eslint.config.mts` using `eslint-plugin-obsidianmd`
- All required Obsidian lint rules must pass before submission
- Test files (`*.test.ts`, `__mocks__/`) have relaxed `any` rules

## Code Architecture

### Build System
- **esbuild** bundler (config in `esbuild.config.mjs`)
- Entry point: `main.ts` → Output: `main.js`
- External: `obsidian`, `electron`, `@codemirror/*`, Node.js builtins

### Plugin Structure
- `main.ts` — plugin lifecycle only (onload, onunload, commands)
- `src/sync/` — sync engine, diff, adapters (CalDAV + Obsidian)
- `src/caldav/` — CalDAV client, VTODO parsing
- `src/tasks/` — task manager, obsidian-tasks integration
- `src/storage/` — sync state persistence
- `src/ui/` — modals, settings tab
- `src/utils/` — task ID generation, helpers
- `src/types/` — TypeScript interfaces

### Key Patterns
- Commands: `addCommand()` with `callback` or `editorCallback`
- Settings: `PluginSettingTab` with `loadData()`/`saveData()`
- Cleanup: `registerDomEvent()`, `registerInterval()` for auto-cleanup
- Modals: extend `Modal`, implement `onOpen()`/`onClose()`

## Testing

### Principles
- Test behavior, not implementation. Focus on what can break.
- Use TDD: write failing test first, then implement
- Coverage thresholds must be met

### Test Architecture
Single `jest.config.js` with two projects (`unit` and `e2e`). Coverage merged.

**Unit tests** (`src/**/*.test.ts`) — pure logic, fast, no Docker:
- VTODO parsing, task ID generation, sync diff engine, adapters, storage

**E2E tests** (`test/e2e/**/*.e2e.test.ts`) — real CalDAV server via Docker:
- CalDAV round-trips, server quirks, full sync pipeline
- Each test file gets isolated random calendar via `createIsolatedCalendar()`

### Coverage Thresholds
- `src/sync/` — 80% lines, 80% branches
- `src/caldav/` — 80% lines, 70% branches
- `src/tasks/` — 80% lines, 80% branches

Excluded: `requestDumper.ts`, `obsidianTasksApi.ts`, `src/ui/`

### E2E Design
- Use `FetchHttpClient` (not Obsidian's `requestUrl`)
- Test the round-trip: create → fetch → verify
- Local Radicale server via Docker (`docker-compose.yml`)

## Release
- Artifacts: `main.js`, `manifest.json`, `styles.css`
- Tag matches `manifest.json` version exactly (no `v` prefix)
- Update `versions.json` with version → minAppVersion mapping
