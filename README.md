# Tasks CalDAV Sync

Bidirectional sync between [obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) and any CalDAV server (Nextcloud, Radicale, Baïkal, Fastmail, etc.).

Works with the [obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin — syncs task status, dates, priorities, recurrence, tags, and notes as standard VTODO items.

![Demo](docs/demo.gif)

## Features

- **Multi-calendar support** — sync different tags to different calendars and servers, with independent identifiers per side (Obsidian tag and CalDAV category)
- **Bidirectional sync** — push tasks to CalDAV servers and pull changes back
- **Auto-sync** — configurable interval (default: 5 minutes)
- **Dry-run mode** — preview what will sync before committing changes
- **Conflict detection** — manual resolution or auto-resolve with Obsidian wins
- **Task notes** — indented bullet points below a task round-trip as VTODO DESCRIPTION
- **Recurrence** — `RRULE` round-trips between CalDAV and obsidian-tasks format
- **Delete detection** — three-way diff detects deletions on either side
- **Reconciliation** — automatically matches identical tasks when switching calendars or after lost sync data, preventing duplicates

## Requirements

- Obsidian v0.15.0+
- [obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin (must be installed and enabled)
- A CalDAV server with VTODO support

## Installation

### From Community Plugins (recommended)

Available in the [Obsidian community plugin directory](https://community.obsidian.md/plugins/tasks-caldav-sync):

1. Open Settings → Community plugins → **Browse**
2. Search for "Tasks CalDAV Sync"
3. Click **Install**, then **Enable**

### Using BRAT (for beta releases)

1. Install the [BRAT plugin](https://tfthacker.com/brat-quick-guide)
2. Open BRAT settings → **Add Beta Plugin**
3. Enter `josecoelho/obsidian-tasks-caldav` and click **Add Plugin**
4. Enable "Tasks CalDAV Sync" in Settings → Community Plugins

BRAT will also handle future updates automatically.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` (if present) from the [latest release](https://github.com/josecoelho/obsidian-tasks-caldav/releases)
2. Create `VaultFolder/.obsidian/plugins/obsidian-tasks-caldav/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin in Settings → Community Plugins

## Configuration

Open Settings → Tasks CalDAV Sync. Add one or more calendars, each with:

| Setting | Description |
|---------|-------------|
| **Obsidian tag** | Only Obsidian tasks with this tag are pushed to the server. Leave empty to push every task. |
| **Server category** | Only server tasks with this `CATEGORIES` value are pulled into Obsidian. Leave empty to pull every task (useful when some clients — such as the iOS Reminders app — can't set categories). |
| **Calendar name** | Name of the calendar on the server |
| **Server URL** | CalDAV server endpoint |
| **Username / Password** | CalDAV credentials |

The two fields are independent. Set them to the same value for a symmetric sync (every synced task has that identifier on both sides), or use different values when your Obsidian tag and server category naming conventions differ. Leaving either side empty disables filtering on that side only.

Global settings:

| Setting | Description | Default |
|---------|-------------|---------|
| **Sync interval** | Auto-sync period in minutes | `5` |
| **New tasks destination** | File where incoming CalDAV tasks are created | `Inbox.md` |
| **New tasks section** | Optional heading within the destination file | — |
| **Sync completed tasks** | Include completed tasks in sync | off |
| **Delete behavior** | What happens when a task is deleted on one side | `ask` |

### Conflict resolution

Two modes:

- **Manual** (default) — sync pauses when conflicts are detected, requiring review
- **Auto-resolve Obsidian wins** — automatically keeps the Obsidian version on conflict

## Usage

### Commands

Open the command palette (`Ctrl/Cmd + P`) to access:

| Command | Description |
|---------|-------------|
| **Sync with CalDAV now** | Run an immediate sync |
| **Preview sync (dry run)** | See what would change without applying |
| **View sync status** | Show last sync time and any conflicts |
| **Inject task IDs** | Add unique IDs to selected tasks |
| **Validate task IDs** | Check document for valid/invalid task IDs |

### Task IDs

Each synced task needs a unique ID. The plugin uses the obsidian-tasks native format:

```
- [ ] Buy groceries 🆔 20260213-a1b
```

Use the "Inject task IDs" command to add IDs to existing tasks, or the plugin will assign them automatically during sync.

### Metadata mapping

| Obsidian | CalDAV | Direction |
|----------|--------|-----------|
| Task text | SUMMARY | ↔ |
| Indented bullets | DESCRIPTION | ↔ |
| `📅` due date | DUE | ↔ |
| `🛫` start date | DTSTART | ↔ |
| `✅` done date | COMPLETED | ↔ |
| `🔁` recurrence | RRULE | ↔ |
| Priority emoji | PRIORITY (1-9) | ↔ |
| Tags | CATEGORIES | ↔ |
| Status (done/cancelled) | STATUS | ↔ |

### Task notes

Indented bullet points below a task are synced as the VTODO DESCRIPTION field:

```
- [ ] Plan vacation 🆔 20260213-x2c
    - Research flights
    - Book hotel
    - Pack list
```

These notes round-trip to/from CalDAV clients like Thunderbird or Tasks.org.

## Troubleshooting

### Sync reports success but nothing changes

The **Obsidian tag** and **Server category** settings are hard filters, not just routing — each side independently decides what gets sent across:

- **Obsidian → CalDAV** — only tasks carrying the Obsidian tag are pushed (skipped if **Obsidian tag** is empty: every task is pushed).
- **CalDAV → Obsidian** — only server VTODOs whose `CATEGORIES` include the configured category are pulled (skipped if **Server category** is empty: every task is pulled).

If your server tasks have no matching `CATEGORIES` (for example, tasks created from the iOS Reminders app, which can't set categories), leave **Server category** empty to pull them anyway.

## Known limitations

- **Priority round-trip is lossy** — obsidian-tasks uses emoji-based priorities (⏫🔼🔽) while CalDAV uses numeric PRIORITY (1-9). Obsidian→CalDAV maps correctly, but CalDAV→Obsidian does not write priority emojis back into the task markdown.
- **Internal obsidian-tasks API** — This plugin accesses obsidian-tasks' internal `getTasks()` method, which is not part of the official public API. Future obsidian-tasks updates could break this integration.

## Tested CalDAV servers

| Server | Coverage |
| --- | --- |
| Radicale | Automated E2E suite |
| Nextcloud | Automated E2E suite |
| Vikunja | Automated E2E suite |
| Baïkal (SabreDAV) | Automated E2E suite |
| Fastmail | Manually verified |

Should work with any CalDAV server that supports VTODO, such as Synology.

### iCloud

iCloud Reminders is **not supported directly** — Apple does not expose it as a
standard CalDAV/VTODO backend, so sync fails at later steps even with the
correct server URL ([#74](https://github.com/josecoelho/obsidian-tasks-caldav/issues/74)).

Workaround: sync Obsidian with a standards-compliant CalDAV account (e.g.
[fruux](https://fruux.com)) and add that same account to the iOS Reminders app.
Reported working by [@Jane2100117](https://github.com/josecoelho/obsidian-tasks-caldav/issues/74).

## Development

```bash
npm i            # install dependencies
npm run dev      # watch mode
npm run build    # production build with type checking
npm test         # run all tests (unit + E2E, requires Docker for Radicale)
npm run test:wdio  # run Obsidian smoke tests (requires Docker + downloads Obsidian binary on first run)
```

See [CLAUDE.md](CLAUDE.md) for architecture details and testing guidelines.

## License

MIT
