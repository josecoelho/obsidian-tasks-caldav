Review the full backlog of open GitHub Issues for this repo.

Steps:
1. Run `gh issue list --state open --limit 100 --json number,title,labels,createdAt,updatedAt`
2. Group issues by **area** label (caldav, sync, obsidian-ui, tasks-plugin, infra, unlabelled)
3. Within each area, sort by priority (p0 > p1 > p2 > p3 > unlabelled)
4. Flag issues that are:
   - **Stale**: no updates in 30+ days
   - **Unlabelled**: missing priority OR area OR type label
   - **Blocked**: mention "blocked by" in their body but the blocking issue is still open
5. Present a summary:
   - Total open issues
   - Count by priority
   - The prioritized list grouped by area
   - A "Needs attention" section for stale/unlabelled issues with recommended actions
6. End with a "What matters now" section: the top 3-5 issues to focus on, with brief reasoning
