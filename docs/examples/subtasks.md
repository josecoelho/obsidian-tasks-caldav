# Subtask examples

How indented tasks in Obsidian map to CalDAV subtasks, shown as **before → after sync**.

The model is asymmetric:

- **Obsidian:** a subtask is an indented checkbox line. Its parent is the nearest
  task line at a shallower indent — there is no stored "parent" reference, just
  position in the file.
- **CalDAV:** every task (parent *and* each subtask) is its own VTODO with its own
  UID. The child VTODO carries `RELATED-TO;RELTYPE=PARENT:<parent-uid>`, which
  clients like Tasks.org, Nextcloud Tasks, and Apple Reminders render as nesting.

Each synced task gets a `🆔` so its Obsidian line maps to a stable CalDAV UID. The
UIDs below (`p1`, `c1`, …) are illustrative; the plugin generates real ones like
`20260528-a4f`. CalDAV blocks are simplified to the properties that matter here.

---

## 1. Basic subtasks

**You write** (`Tasks.md`):

```markdown
- [ ] Weekly groceries #sync
    - [ ] Buy milk
    - [ ] Buy eggs
```

**Obsidian after first sync** — every synced task gains a `🆔`; inherited children
also gain `#sync`:

```markdown
- [ ] Weekly groceries 🆔 p1 #sync
    - [ ] Buy milk 🆔 c1 #sync
    - [ ] Buy eggs 🆔 c2 #sync
```

**CalDAV after sync** — three independent VTODOs; the children point at the parent:

```
VTODO  UID:p1  SUMMARY:Weekly groceries   CATEGORIES:sync
VTODO  UID:c1  SUMMARY:Buy milk           CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
VTODO  UID:c2  SUMMARY:Buy eggs           CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
```

---

## 2. Re-parent by indentation

Starting from example 1, indent "Buy eggs" one level deeper so it nests under
"Buy milk":

**You change** `Tasks.md` to:

```markdown
- [ ] Weekly groceries 🆔 p1 #sync
    - [ ] Buy milk 🆔 c1 #sync
        - [ ] Buy eggs 🆔 c2 #sync
```

**CalDAV after sync** — only `c2`'s parent link changes (`p1` → `c1`); the others
are untouched:

```
VTODO  UID:p1  SUMMARY:Weekly groceries   CATEGORIES:sync
VTODO  UID:c1  SUMMARY:Buy milk           CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
VTODO  UID:c2  SUMMARY:Buy eggs           CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:c1
```

Un-indenting a subtask back to the top level removes its `RELATED-TO` entirely, so
it becomes a root task on CalDAV.

---

## 3. Body notes alongside subtasks

Indented **non-checkbox** bullets are the parent's body/description. Indented
**checkbox** lines are subtasks. They can be mixed:

**You write:**

```markdown
- [ ] Plan trip #sync
    - remember to renew passport
    - budget is £1500
    - [ ] Book flights
    - [ ] Reserve hotel
```

**CalDAV after sync** — the bullet notes become the parent's `DESCRIPTION`; the two
checkboxes become child VTODOs:

```
VTODO  UID:p1  SUMMARY:Plan trip      CATEGORIES:sync
       DESCRIPTION:remember to renew passport\nbudget is £1500
VTODO  UID:c1  SUMMARY:Book flights   CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
VTODO  UID:c2  SUMMARY:Reserve hotel  CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
```

---

## 4. Completing a subtask

Completion is per-task; there is **no** cascade. Completing a child does not
complete the parent, and vice versa.

**You check off one child:**

```markdown
- [ ] Weekly groceries 🆔 p1 #sync
    - [x] Buy milk 🆔 c1 #sync ✅ 2026-05-28
    - [ ] Buy eggs 🆔 c2 #sync
```

**CalDAV after sync** — only `c1` flips to completed:

```
VTODO  UID:p1  SUMMARY:Weekly groceries  STATUS:NEEDS-ACTION  CATEGORIES:sync
VTODO  UID:c1  SUMMARY:Buy milk          STATUS:COMPLETED     CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
VTODO  UID:c2  SUMMARY:Buy eggs          STATUS:NEEDS-ACTION  CATEGORIES:sync  RELATED-TO;RELTYPE=PARENT:p1
```

The reverse works too: completing a subtask in Tasks.org / Nextcloud flips the
matching Obsidian line to `- [x] … ✅ <date>` on the next sync, keeping its indent.

---

## 5. The sync tag is only needed on the top-level task

A subtask inherits sync eligibility from any synced ancestor — you do not have to
tag every child. (On the first sync the plugin then writes the tag onto each child;
see the note below.)

**You write** — only the parent is tagged:

```markdown
- [ ] Release checklist #sync
    - [ ] Cut the tag
    - [ ] Publish release notes
```

Both children sync. A top-level task with **no** sync tag and no synced ancestor is
ignored entirely.

---

## Notes

- **Tag/id materialization:** on the first sync, each previously-bare child line
  gains `🆔 <id>` and `#sync`. This is a one-time write-back (subsequent syncs skip
  lines that already have an id). Dataview format users get `[id:: <id>]` instead of
  `🆔 <id>`.
- **Deletion:** deleting a parent in a CalDAV client typically deletes its children
  too (the client cascades), and those deletions propagate per-task. Removing the
  Obsidian task line from the vault when a task is deleted on the CalDAV side is a
  separate, pre-existing limitation tracked in
  [#99](https://github.com/josecoelho/obsidian-tasks-caldav/issues/99).
- **Not supported:** `⛔ dependsOn` (obsidian-tasks task dependencies) and cross-note
  subtasks — indentation can't span notes.
