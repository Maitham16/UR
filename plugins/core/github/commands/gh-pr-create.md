---
description: Open a GitHub pull request from the current branch with a generated title and body.
argument-hint: "[base-branch] (default: repo default branch)"
---

Open a pull request for the current branch.

1. Determine the base: `$ARGUMENTS` if given, else the repository default branch.
2. Confirm the branch is pushed to the remote; if not, push it.
3. Collect the commits between base and HEAD and any diff stat.
4. Draft the PR:
   - **Title**: one Conventional-Commit-style line summarizing the change.
   - **Body**: `## Summary` (what and why, 2–4 bullets), `## Changes` (grouped),
     `## Test plan` (how it was verified).
5. Create the PR against the base branch and print its URL.

Prefer the `github` MCP tools; otherwise use `gh pr create`. If neither is
configured, point the user to the README and stop. Never merge — creating the PR
is the end state. Do not include secrets in the title or body.
