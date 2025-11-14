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
- Testing Approach

Principles:

    Test behavior, not implementation
    Focus on what can break
    Pure functions tested thoroughly
    No trivial setter/getter tests