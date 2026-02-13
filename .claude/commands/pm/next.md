Recommend which GitHub issue to work on next.

Steps:
1. Fetch open issues: `gh issue list --state open --limit 50 --json number,title,labels,body,createdAt`
2. Fetch open PRs to see what's already in progress: `gh pr list --state open --json number,title,body`
3. Filter out issues that appear to have active PRs (linked via "closes #N" or "#N" in PR body)
4. Check for dependency chains: scan issue bodies for "blocked by #N" or "depends on #N" patterns — skip issues whose blockers are still open
5. Score remaining issues by:
   - Priority label (p0 = 4, p1 = 3, p2 = 2, p3 = 1, unlabelled = 0)
   - Data-loss or protocol risk (bonus +1)
   - Unblocks other issues (bonus +1)
6. Present top 3 recommendations:
   - Issue number, title, labels
   - Why this one: 1-2 sentences of reasoning
   - What it involves: brief scope estimate
7. Ask which one to pick (or suggest a different one)
