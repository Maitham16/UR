---
description: One-screen health snapshot of a GitHub repository.
argument-hint: "[owner/repo] (default: current repository)"
---

Build a health snapshot for `$ARGUMENTS` if given, else the current repository.

Gather and summarize:
- Open pull requests: count, and any that are stale or have failing checks.
- Open issues: count and rough theme breakdown.
- Latest CI runs: pass/fail of the most recent runs on the default branch.
- Branches: stale branches merged or long inactive.
- Releases: the latest release/tag and how long ago it shipped.

Keep it to one screen. End with a verdict line, exactly one of:
- `HEALTH: GREEN — nothing demands attention.`
- `HEALTH: YELLOW — a few things to watch.`
- `HEALTH: RED — needs attention now.`
followed by the single highest-priority item.

Prefer the `github` MCP tools; otherwise use `gh` (`gh pr list`, `gh issue list`,
`gh run list`, `gh release view`). If neither is configured, point the user to
the README and stop.
