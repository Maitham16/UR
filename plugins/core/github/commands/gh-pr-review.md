---
description: Review a GitHub pull request and return a structured verdict.
argument-hint: "[pr-number | url] (default: PR for the current branch)"
---

Resolve the PR: if `$ARGUMENTS` names a number or URL, use it; otherwise find
the open PR for the current branch.

Fetch the diff and metadata, then review it. Produce a markdown report with
these sections, skipping any with no findings:

### Correctness
Logic errors, missed edge cases, null / boundary handling, races, error paths
that swallow failures. Name the file and line and quote the snippet.

### Style and consistency
Naming that fights the surrounding code, dead code, duplicated logic, comments
that contradict the code.

### Test coverage
Was test-shaped code touched? Is the new behaviour tested? Flag changes to
public surface area with no matching test.

### Security
Injection (SQL/shell/path), secret leakage, unsafe deserialization, missing
validation at trust boundaries, over-broad permissions.

### TL;DR
End with exactly one of:
- `TL;DR: Looks good.`
- `TL;DR: Has nits.`
- `TL;DR: Has blockers.`

Prefer the `github` MCP tools (pull request read + diff). If they are not
available, use the `gh` CLI (`gh pr view`, `gh pr diff`), which uses its own
`gh auth login` session. If neither is configured, point the user to the plugin
README and stop. Do not post a review comment unless explicitly asked.
