---
description: Open a GitLab merge request from the current branch with a generated title and description.
argument-hint: "[target-branch] (default: project default branch)"
---

Open a merge request for the current branch.

1. Determine the target: `$ARGUMENTS` if given, else the project default branch.
2. Confirm the branch is pushed to the remote; if not, push it.
3. Collect the commits between target and HEAD and any diff stat.
4. Draft the MR:
   - **Title**: one Conventional-Commit-style line summarizing the change.
   - **Description**: `## Summary` (what and why), `## Changes` (grouped),
     `## Test plan` (how it was verified).
5. Create the MR against the target and print its URL.

Prefer the `gitlab` MCP tools; otherwise use `glab mr create`. If neither is
configured, point the user to the README and stop. Never merge — creating the MR
is the end state. Do not include secrets in the title or description.
