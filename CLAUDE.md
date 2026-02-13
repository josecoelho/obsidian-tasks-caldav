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

### Test Commands
- **`npm test`** - Run all tests (unit + E2E) with coverage and threshold enforcement. Starts Radicale via Docker automatically if not already running. **This is the definitive check — work is done when `npm test` passes.**
- `npm run test:watch` - Watch mode for unit tests only (no Docker needed)
- `jest --selectProjects unit` - Run unit tests only (fast, no Docker)
- `jest --selectProjects e2e` - Run E2E tests only (requires Radicale)

### Coverage Thresholds
Enforced on combined unit + E2E coverage via `jest.config.js`:
- `src/sync/` — 80% lines, 80% branches
- `src/caldav/` — 80% lines, 70% branches
- `src/tasks/` — 80% lines, 80% branches

Excluded from coverage: `requestDumper.ts` (debug utility), `obsidianTasksApi.ts` (type definitions), `src/ui/` (Obsidian UI requires manual testing).

### Test Architecture
Single `jest.config.js` with two named projects (`unit` and `e2e`). Coverage is merged across both projects.

**Unit tests** (`src/**/*.test.ts`) — pure logic, fast, no Docker:
- VTODO parsing / mapping, task ID generation, markdown generation
- Sync diff engine, adapters, storage

**E2E tests** (`test/e2e/**/*.e2e.test.ts`) — real CalDAV server via Docker:
- CalDAV protocol round-trips (create → fetch → update → delete)
- Server quirks (line folding, VTIMEZONE, XML namespaces)
- Full sync pipeline validation
- Each test file gets an isolated random calendar via `createIsolatedCalendar()` — tests run in parallel safely

### E2E Test Design
- **Use `FetchHttpClient`** in E2E tests (not Obsidian's `requestUrl`)
- **Test the round-trip**: Create via the client, fetch back, verify the data survives the server's processing
- E2E tests use a local Radicale server via Docker (`docker-compose.yml`). The `ensure-radicale.mjs` script handles idempotent startup.
- Each test file creates its own calendar — no cross-file interference

### Manual Testing
E2E tests replace the manual test loop for CalDAV protocol and sync logic. Manual testing by the user is still required for:
- Obsidian UI integration (settings tab, ribbon icons, notices)
- obsidian-tasks plugin API interactions
- Epic-level acceptance criteria