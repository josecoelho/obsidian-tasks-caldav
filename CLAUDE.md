# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin built with TypeScript. The plugin follows the standard Obsidian plugin architecture using their official API.

## Development Commands

### Build and Development
- `npm run dev` - Start development with watch mode (uses esbuild)
- `npm run build` - Production build with type checking (runs TypeScript compiler then esbuild)
- `npm run version` - Bump version numbers in manifest.json and versions.json

### Installation
- `npm i` - Install dependencies (requires Node.js v16+)

### Type Checking
The build command includes type checking via `tsc -noEmit -skipLibCheck`

## Code Architecture

### Build System
- Uses **esbuild** for fast bundling (config in `esbuild.config.mjs`)
- Entry point: `main.ts` → Output: `main.js`
- Development mode: watch mode with inline sourcemaps
- Production mode: minified, no sourcemaps, tree-shaking enabled
- External packages: `obsidian`, `electron`, all `@codemirror/*` packages, and Node.js builtins

### Plugin Structure
The plugin follows Obsidian's standard class-based architecture:

1. **Main Plugin Class** (extends `Plugin`)
   - `onload()`: Plugin initialization, register commands, events, UI elements
   - `onunload()`: Cleanup
   - `loadSettings()` / `saveSettings()`: Handle plugin settings persistence

2. **Settings Management**
   - Settings interface defines configuration shape
   - `DEFAULT_SETTINGS` constant provides defaults
   - Settings persisted via `loadData()` / `saveData()` from Plugin API
   - Settings UI via `PluginSettingTab` class

3. **Common Plugin Patterns**
   - Commands: Use `addCommand()` with `callback` or `editorCallback`
   - Modals: Extend `Modal` class, implement `onOpen()` / `onClose()`
   - Settings tabs: Extend `PluginSettingTab`, implement `display()`
   - DOM events: Register with `registerDomEvent()` for auto-cleanup
   - Intervals: Register with `registerInterval()` for auto-cleanup
   - Ribbon icons: Use `addRibbonIcon()`
   - Status bar: Use `addStatusBarItem()`

### TypeScript Configuration
- Target: ES6, Module: ESNext
- Strict null checks enabled
- Inline source maps for debugging
- Includes DOM, ES5, ES6, ES7 libraries

## Plugin Distribution Files
When releasing, these files must be included:
- `main.js` (bundled output)
- `manifest.json` (plugin metadata)
- `styles.css` (if present)

## Version Management
- Update `manifest.json` with new version and minimum Obsidian version
- Update `versions.json` with version compatibility mapping
- Can use `npm version patch|minor|major` to automate bumping (after manually updating minAppVersion)
## Testing

### Principles
- Test behavior, not implementation
- Focus on what can break
- Pure functions tested thoroughly
- No trivial setter/getter tests
- Use TDD: write failing test first, then implement
- Coverage threshold must be met before work is considered done

### Coverage Thresholds
Enforced per directory via `jest.config.js` and CI:
- `src/sync/` — 80% lines, 80% branches
- `src/caldav/` — 80% lines, 70% branches (CalDAV client error paths tested via E2E)
- `src/tasks/` — 80% lines, 80% branches

Excluded from coverage: `requestDumper.ts` (debug utility), `obsidianTasksApi.ts` (type definitions), `src/ui/` (Obsidian UI requires manual testing).

### Test Commands
- `npm test` - Run unit tests (mocked Obsidian API, fast, CI-safe)
- `npm run test:coverage` - Run unit tests with Istanbul coverage report and threshold enforcement
- `npm run test:e2e` - Run E2E tests with coverage against a real Radicale CalDAV server (starts Docker automatically, outputs to `coverage-e2e/`)
- `npm run test:all` - Run both unit and E2E tests with coverage (requires Docker). **This is the definitive check — work is done when `test:all` passes.**

### Testing Workflow: Discover with E2E, Lock Down with Unit Tests

**E2E tests** (`test/e2e/**/*.e2e.test.ts`) are the primary tool for validating CalDAV sync behavior. Use them to:
- Validate any change to sync, CalDAV client, or VTODO mapping before claiming done
- Discover real protocol issues (XML namespaces, line folding, server quirks)
- Test full round-trips (create → fetch → update → delete against a real server)
- Debug problems interactively with Radicale (`docker compose up -d` keeps it running)

**Once an E2E test reveals an issue**, add a unit test to lock down the fix:
- Extract the minimal reproducing case (e.g., a specific XML response format)
- Add it as a unit test or fixture so CI catches regressions without Docker
- The E2E test stays as broad integration coverage; the unit test is the fast guard

**Unit tests** (`src/**/*.test.ts`) — for pure logic and locked-down behavior:
- VTODO parsing / mapping
- Task ID generation, markdown generation
- Specific server response formats discovered via E2E (add as fixtures)

### E2E Test Design
- **Keep tests broad** — group related assertions in a single test to avoid recreating calendars repeatedly. One well-structured CRUD test is better than five slow isolated ones.
- **Clean once per describe**, not per test — use `beforeAll` for calendar setup when tests within a group don't conflict. Reserve `beforeEach(cleanCalendar)` for groups where test isolation is essential.
- **Use `FetchHttpClient`** in E2E tests (not Obsidian's `requestUrl`)
- **Test the round-trip**: Create via the client, fetch back, verify the data survives the server's processing
- E2E tests use a local Radicale server via Docker (`docker-compose.yml`). The container stays running between test runs.

### Manual Testing
E2E tests replace the manual test loop for CalDAV protocol and sync logic. Manual testing by the user is still required for:
- Obsidian UI integration (settings tab, ribbon icons, notices)
- obsidian-tasks plugin API interactions
- Epic-level acceptance criteria