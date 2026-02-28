# Tag-per-calendar sync

## Problem

Users want to route tasks to different CalDAV calendars based on tags.
Example: `#work` tasks sync to a Work calendar on a corporate server,
`#personal` tasks sync to a Personal calendar on a private server.

GitHub issue: #47

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tasks per calendar | One calendar per task (first match wins) | Avoids duplication and cross-calendar conflicts |
| Unmatched tasks | Skipped (not synced) | Tag is the membership card; no tag, no sync |
| Global syncTag | Removed; each calendar has its own tag | No redundancy; tag = filter = routing |
| Tag removed | Delete from other side | Symmetric: tag controls membership on both sides |
| Tag changed | Natural move via independent loops | Old loop deletes (task gone), new loop creates (task appeared) |
| Storage | Per-calendar directories | Clean isolation, easy to debug |
| Connection config | Per-calendar (independent servers) | Supports work/personal on different CalDAV servers |

## Architecture

Each calendar mapping is a self-contained sync job. The plugin instantiates
one SyncEngine per calendar and runs them independently.

```
sync():
  for each calendar in settings.calendars:
    engine = new SyncEngine(calendar)   // own client, storage, baseline
    await engine.sync()
```

### Settings

```typescript
interface CalendarMapping {
  tag: string;              // without #, e.g. "work"
  calendarName: string;     // e.g. "Work"
  serverUrl: string;
  username: string;
  password: string;
}

interface CalDAVSettings {
  calendars: CalendarMapping[];
  syncInterval: number;
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
}
```

Top-level settings lose `serverUrl`, `username`, `password`, `calendarName`,
and `syncTag`. Connection config moves into each calendar entry.

### Storage layout

```
.caldav-sync/
  state.json                    # global: last sync time, conflicts
  calendars/
    work/
      baseline.json
      id-mapping.json
    personal/
      baseline.json
      id-mapping.json
```

Each calendar gets its own directory with independent baseline and id-mapping.

### Sync flow per calendar

No change from today's single-calendar flow:

1. `obsidianAdapter.fetchTasks(tag)` — filter Obsidian tasks by this calendar's tag
2. `caldavAdapter.fetchTasks(tag, idMapping)` — fetch VTODOs from this calendar
3. `diff(obsidian, caldav, baseline, strategy)` — three-way merge
4. Apply changes to both sides
5. Save new baseline and id-mapping

### Tag change = calendar move (no special logic)

User changes a task from `#work` to `#personal`:

- **Work sync loop**: task no longer has `#work` → not in Obsidian set → baseline
  says it was there → diff produces delete → VTODO removed from Work calendar
- **Personal sync loop**: task has `#personal` → in Obsidian set → no baseline
  entry → diff produces create → VTODO created in Personal calendar

Both loops are independent. The diff engine handles it naturally.

### CalDAV-side tag change

If a task's tag is changed on CalDAV (e.g., `#work` removed from a VTODO in
the Work calendar):

- **Work sync loop**: CalDAV adapter filters by tag, task no longer matches →
  treated as deleted on CalDAV → diff produces delete → task removed from
  Obsidian

Same symmetric behavior as today, just per-calendar.

## Impact per layer

| Layer | Change needed |
|-------|--------------|
| **CalDAVSettings** | Replace single connection + syncTag with `calendars: CalendarMapping[]` |
| **SyncEngine** | Accept `CalendarMapping` instead of global settings; no structural change |
| **CalDAVClientDirect** | No change — already takes server URL + calendar name |
| **CalDAVAdapter** | No change — already parameterized by client + tag |
| **ObsidianAdapter** | No change — `fetchTasks(tag)` already works |
| **Diff** | No change |
| **CommonTask** | No change |
| **SyncStorage** | Accept calendar identifier, load/save from `calendars/{name}/` |
| **Settings UI** | Replace single inputs with dynamic list of calendar mappings |
| **Plugin main** | Loop over calendars, instantiate one SyncEngine per mapping |

## Migration

On first load after upgrade, if old flat files exist:

1. Read old settings: `{ serverUrl, username, password, calendarName, syncTag }`
2. Create `calendars: [{ tag: syncTag, calendarName, serverUrl, username, password }]`
3. Create `calendars/{calendarName}/` directory
4. Move `baseline.json` → `calendars/{calendarName}/baseline.json`
5. Move `id-mapping.json` → `calendars/{calendarName}/id-mapping.json`
6. Save updated settings
7. Remove old top-level connection fields

This is lossless — the old single-calendar config becomes the first entry in
the calendars array.

## Edge cases

| Case | Behavior |
|------|----------|
| Task matches multiple tags | First matching calendar in array wins |
| Task has no matching tag | Not synced (skipped) |
| One server is down | Other calendars sync normally |
| Calendar removed from settings | Its storage files are orphaned (no auto-delete) |
| Empty calendars array | No sync happens |
