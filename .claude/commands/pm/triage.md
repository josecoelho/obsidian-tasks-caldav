Create a GitHub issue from a work description.

Input: $ARGUMENTS

Steps:
1. Parse the description in $ARGUMENTS
2. If the description is vague or missing key details, ask clarifying questions before creating the issue. Specifically check:
   - Is the problem/feature clear enough to write acceptance criteria?
   - Can you determine the area (caldav, sync, obsidian-ui, tasks-plugin, infra)?
   - Is it a bug, feature, chore, or spike?
3. Draft the issue with:
   - **Title**: imperative, concise
   - **Body** including:
     - Context paragraph explaining why this matters
     - Acceptance criteria as a checklist
     - Testing note: specify E2E test / unit test / manual test needed (per CLAUDE.md testing workflow)
   - **Labels**: one priority + one area + one type
4. Show the draft to the user for confirmation
5. Create via: `gh issue create --title "..." --body "..." --label "priority,area,type"`
6. Output the issue URL
