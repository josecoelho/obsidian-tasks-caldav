---
name: pm
description: GitHub Issues-based project management for obsidian-tasks-caldav
---

# Project Management — GitHub Issues as Source of Truth

All task state lives in GitHub Issues. Never create local files for tracking (no markdown task files, no local epics, no PRDs). Use `gh` commands for everything.

## Labels

### Priority
| Label | Use when |
|-------|----------|
| `p0-critical` | Data loss, crash, blocks all other work |
| `p1-high` | Important bug or feature blocking near-term work |
| `p2-medium` | Should do soon, but not blocking |
| `p3-low` | Nice to have, do when convenient |

### Area
| Label | Scope |
|-------|-------|
| `caldav` | CalDAV client, XML, protocol, VTODO mapping |
| `sync` | Sync engine, diff logic, adapters, storage |
| `obsidian-ui` | Settings tab, modals, ribbon, notices |
| `tasks-plugin` | obsidian-tasks API integration |
| `infra` | Build, CI, testing infrastructure, tooling |

### Type
| Label | Meaning |
|-------|---------|
| `bug` | Something broken |
| `feature` | New capability |
| `chore` | Maintenance, refactor, cleanup |
| `spike` | Research or investigation |

## Creating Issues

Every issue must include:

1. **Clear title** — imperative, concise (e.g., "Handle VTIMEZONE in recurring events")
2. **Description** with context on why this matters
3. **Acceptance criteria** — bulleted list of what "done" looks like
4. **Testing note** — specify which testing approach based on CLAUDE.md:
   - `E2E test needed` — CalDAV protocol, sync round-trips, server quirks
   - `Unit test needed` — pure logic, parsing, mapping
   - `Manual test needed` — Obsidian UI, obsidian-tasks API interactions
5. **Labels** — at least one from each category (priority, area, type)

Example:
```
gh issue create \
  --title "Handle line-folded DESCRIPTION in VTODO responses" \
  --body "$(cat <<'EOF'
## Context
Some CalDAV servers fold long DESCRIPTION lines per RFC 5545. Our parser doesn't unfold them, causing truncated task descriptions.

## Acceptance Criteria
- [ ] VTODO parser unfolds continuation lines (space/tab prefix)
- [ ] Round-trip test: create task with long description, fetch back, verify intact
- [ ] Unit test with fixture for folded DESCRIPTION

## Testing
- E2E test needed (server may fold differently than expected)
- Unit test to lock down the parser fix
EOF
)" \
  --label "bug,p1-high,caldav"
```

## Prioritization Guidelines

When triaging, consider:
1. **Data loss risk** → always p0-critical
2. **Blocks other work** → p1-high minimum
3. **Protocol/server compatibility** → p1-high (breaks real users)
4. **Polish, DX, cleanup** → p2-medium or p3-low

## Linking PRs to Issues

Always use `closes #N` in PR descriptions to auto-close issues on merge:
```
gh pr create --title "Fix line folding" --body "Closes #42"
```

## Issue Comments for Context

Use issue comments to record decisions and progress:
```
gh issue comment 42 --body "Investigated: Radicale doesn't fold, but Nextcloud does. Adding fixtures for both."
```

## Workflows

### Triage
1. `gh issue list --state open --json number,title,labels`
2. Find issues missing priority labels
3. Suggest priorities with reasoning based on the guidelines above

### Planning (Breaking Down Features)
Use GitHub sub-issues for feature decomposition:
1. Create a parent tracking issue for the feature
2. Create each work item as its own issue with labels, acceptance criteria, and testing notes
3. Link work items as sub-issues of the parent using the GraphQL API:
   ```
   # Get node IDs
   gh issue view <number> --json id -q .id
   # Add sub-issue
   gh api graphql -f query='mutation { addSubIssue(input: {issueId: "<parent_id>", subIssueId: "<child_id>"}) { issue { id } } }'
   ```
4. Note dependencies between siblings in issue bodies ("Blocked by #N")
5. The parent issue tracks overall progress via its sub-issue list

### From Implementation Plans to Issues
When `superpowers:writing-plans` produces a plan that spans multiple issues, it may be converted to GitHub issues:
- Create a parent issue for the plan
- Each plan step becomes a sub-issue of the parent
- Dependencies between steps become "Blocked by #N" notes in issue bodies
- The plan's acceptance criteria become the issue's acceptance criteria
- Apply appropriate labels based on what each step touches
- Use `/plan` command to automate this conversion

Note: Not all plans need decomposition into issues. When planning the implementation of a single issue, the plan guides the work — no extra issues needed.

### Daily Workflow
1. Check what's open: `gh issue list --state open --label "p0-critical,p1-high"`
2. Pick the highest-priority unblocked issue
3. Create a branch, do the work, link the PR
4. Close via PR merge (using `closes #N`)
