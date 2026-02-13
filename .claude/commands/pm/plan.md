Break down a feature into multiple GitHub issues using sub-issues for hierarchy.

Input: $ARGUMENTS

Steps:
1. Parse the feature description in $ARGUMENTS
2. If the description is too vague to decompose, ask clarifying questions first
3. Analyze the feature and break it into discrete work items. For each item, determine:
   - What code needs to change (consult the codebase)
   - Which area it touches (caldav, sync, obsidian-ui, tasks-plugin, infra)
   - Whether it depends on other items in the plan
   - What testing approach it needs (E2E / unit / manual per CLAUDE.md)
4. Present the plan as a numbered list showing:
   - Title for each issue
   - Labels (priority, area, type)
   - Dependencies (which items must complete first)
   - Brief acceptance criteria
5. Ask the user to confirm or adjust the plan
6. Once confirmed, create a parent tracking issue for the feature, then create each work item as a sub-issue:
   a. Create the parent issue:
      ```
      gh issue create --title "Feature: <name>" --body "..." --label "feature,<area>,<priority>"
      ```
   b. Create each child issue with `gh issue create` (with labels, acceptance criteria, testing notes, and "Blocked by #N" for dependencies)
   c. Link children as sub-issues of the parent:
      ```
      gh api graphql -f query='mutation { addSubIssue(input: {issueId: "<parent_node_id>", subIssueId: "<child_node_id>"}) { issue { id } } }'
      ```
      Get node IDs via: `gh issue view <number> --json id -q .id`
7. Output the parent issue URL and all sub-issue URLs
