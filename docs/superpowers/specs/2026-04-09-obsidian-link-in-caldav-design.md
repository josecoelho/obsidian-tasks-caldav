# Obsidian link in CalDAV tasks

**Issue**: [#63](https://github.com/josecoelho/obsidian-tasks-caldav/issues/63)
**Date**: 2026-04-09

## Problem

Users want to click a link from their CalDAV client (phone, desktop) and jump back to the source task in Obsidian. Currently no link is provided.

## Solution

When enabled, embed an `obsidian://open` link in each synced CalDAV task via both the `URL` property (for clients that support it) and the first line of `DESCRIPTION` (universally visible, auto-linkified by most clients).

On sync-back (CalDAV to Obsidian), strip any `obsidian://open?vault=` lines from the body so the link doesn't pollute the Obsidian markdown.

## Setting

- **Name**: "Include Obsidian link in CalDAV tasks"
- **Key**: `includeObsidianLink: boolean`
- **Default**: `false`

## Link format

```
obsidian://open?vault=<encodeURIComponent(vaultName)>&file=<encodeURIComponent(filePath)>
```

- `vaultName` from `app.vault.getName()`
- `filePath` from `task.taskLocation._tasksFile._path`

## Data flow

### Outbound (Obsidian to CalDAV)

1. `ObsidianAdapter.normalize()` builds the obsidian:// link from vault name + file path and sets it on `CommonTask.obsidianUrl`
2. `CalDAVAdapter` passes the task (with `obsidianUrl`) to `VTODOMapper.taskToVTODO()`
3. `VTODOMapper.taskToVTODO()`:
   - Writes `URL:<obsidianUrl>` property on the VTODO
   - Prepends the link as the first line of DESCRIPTION, separated by a blank line from the original body

Example VTODO:
```
URL:obsidian://open?vault=Notes&file=Projects%2Ftasks.md
DESCRIPTION:obsidian://open?vault=Notes\&file=Projects%2Ftasks.md\n\nOriginal body text
```

### Inbound (CalDAV to Obsidian)

1. `VTODOMapper.vtodoToTask()` strips any line matching `obsidian://open?vault=` from the parsed DESCRIPTION before assigning to `body`
2. `obsidianUrl` is not populated on inbound — the field is only used for outbound

## Schema change

Add optional field to `CommonTask`:

```typescript
obsidianUrl?: string;  // obsidian://open link, only set on Obsidian side
```

## Affected files

| File | Change |
|------|--------|
| `src/sync/types.ts` | Add `obsidianUrl?: string` to `CommonTask` |
| `src/tasks/obsidianTasksWrapper.ts` | No change (path already available) |
| `src/sync/obsidianAdapter.ts` | Build obsidian:// link during `normalize()`, needs vault name |
| `src/caldav/VTODOMapper.ts` | Write `URL` property + prepend to DESCRIPTION; strip on inbound |
| `src/ui/settingsTab.ts` | Add toggle for `includeObsidianLink` |
| Plugin settings type | Add `includeObsidianLink: boolean` (default `false`) |

## Stripping logic

On inbound sync, remove lines from body that match:

```typescript
/^obsidian:\/\/open\?vault=.*/
```

Applied to each line of the parsed DESCRIPTION. Also strip any resulting leading blank lines.

## Testing

- **VTODOMapper unit tests**: Verify URL property and DESCRIPTION prepend on outbound; verify stripping on inbound
- **ObsidianAdapter unit tests**: Verify obsidianUrl is set during normalize when setting is enabled, absent when disabled
- **Round-trip test**: Create task with body, sync out with link, sync back, verify body is clean
