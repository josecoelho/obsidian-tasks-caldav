# Dataview format support — design

Issue: https://github.com/josecoelho/obsidian-tasks-caldav/issues/68

## Problem

obsidian-tasks supports two metadata formats: emoji (`📅 2025-01-15`) and
dataview (`[due:: 2025-01-15]`). Parsing is delegated to the obsidian-tasks
plugin, which handles both. But our serializer (`ObsidianMapper.toMarkdown`)
only emits emoji. A user whose vault uses dataview format gets emoji-format
tasks written back, mixing styles in their files.

## Behavior

A global setting picks the default format for newly created tasks. Updates to
existing tasks preserve whatever format that task already uses, detected from
its current markdown line. (Approved option "D": global default + auto-infer
for updates.)

## Setting

One new field in `CalDAVSettings`:

```ts
taskFormat: 'emoji' | 'dataview'; // default: 'emoji'
```

Default `'emoji'` preserves current behavior for existing users (no migration
needed — `Object.assign` with defaults fills it in).

Settings UI: a dropdown labelled "Task format" with options "Emoji" and
"Dataview", in sentence case per project conventions.

## Mapper changes — `src/tasks/ObsidianMapper.ts`

Public API:

```ts
toMarkdown(task: CommonTask, opts: { syncTag?: string; format: 'emoji' | 'dataview' }): string
detectFormat(line: string): 'emoji' | 'dataview' | null
```

`toMarkdown` dispatches on `opts.format` to one of two private methods:

- `toEmojiMarkdown` — current logic, moved unchanged
- `toDataviewMarkdown` — new

### Dataview serialization

Same field set as the emoji serializer (approved option "A" — no priority,
matching the existing emoji gap), same order:

```
- [ ] Title #tag1 [start:: 2025-01-10] [scheduled:: 2025-01-12] [due:: 2025-01-15] [completion:: 2025-01-20] [repeat:: every day] [id:: abc123] #sync-tag
    - body line
```

Field keys follow the obsidian-tasks dataview docs:
`start`, `scheduled`, `due`, `completion`, `repeat`, `id`.

- Recurrence reuses the existing `rruleToText` helper, emitted as
  `[repeat:: <text>]`.
- Tags remain inline `#tag` (same as emoji path).
- Sync tag placed after `[id::]` (same relative position as emoji path).
- Body uses the same indented-bullet format as the emoji path.

### Detection

`detectFormat(line)` returns, checked in this order:

1. `'dataview'` if the line matches
   `/\[(due|scheduled|start|completion|repeat|recurrence|id|priority)::/`
2. `'emoji'` if it contains any of `📅 ⏳ 🛫 ✅ 🔁 🆔`
3. `null` otherwise (e.g. a bare `- [ ] foo` with no metadata)

Dataview is checked first so an ambiguous line containing both wins toward the
unambiguous bracket syntax.

## Adapter changes — `src/sync/obsidianAdapter.ts`

`ObsidianSyncSettings` gains `taskFormat: 'emoji' | 'dataview'`.

Format is chosen per change:

| Change         | Format source |
|----------------|---------------|
| create         | `settings.taskFormat` |
| update         | `mapper.detectFormat(existingTask.originalMarkdown) ?? settings.taskFormat` |
| writeBackIds   | same detection as update |
| complete       | unchanged — uses the obsidian-tasks toggle function, which respects that plugin's own format setting |

This realises option "D": existing tasks keep their format on update; new
tasks use the configured default.

## Tests

Unit only — no e2e impact since the CalDAV side is unchanged.

1. `ObsidianMapper.test.ts` (new cases)
   - `toMarkdown` with `format: 'dataview'`: all field combinations, tag
     placement, body, sync-tag placement, recurrence text, no-dates case
   - `detectFormat`: emoji line, dataview line, bare line (`null`), mixed line
     (dataview wins), a body line that mentions `[x:: y]`-like text shouldn't
     false-positive on the task line itself
2. `obsidianAdapter.test.ts` (new cases)
   - create honors `settings.taskFormat` for both values
   - update detects format from `originalMarkdown` and overrides the setting
   - update with a bare/ambiguous original falls back to the setting

## Out of scope

- Priority serialization (pre-existing gap in the emoji path; separate issue)
- Per-calendar format overrides
- Configurable dataview field-name prefix (obsidian-tasks allows a custom
  prefix; defer until requested)
