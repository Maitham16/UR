---
description: Report GitLab CI/CD pipeline status and diagnose the latest failures.
argument-hint: "[branch] (default: current branch)"
---

Report the most recent CI/CD pipeline for `$ARGUMENTS` if given, else the current
branch.

1. Get the latest pipeline and its job statuses.
2. For each failed job, pull the tail of its log and state the most likely cause
   in one line — decode the error, do not paste the whole log.
3. List passing, failed, and still-running stages compactly.

End with a verdict line, exactly one of:
- `PIPELINE: PASSING`
- `PIPELINE: FAILING — <the job to fix first>`
- `PIPELINE: RUNNING`

Prefer the `gitlab` MCP tools; otherwise use `glab` (`glab ci status`,
`glab ci view`). If neither is configured, point the user to the README and stop.
Do not retry or cancel jobs unless explicitly asked.
