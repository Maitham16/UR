---
description: Triage open GitHub issues — cluster, label, and propose next actions.
argument-hint: "[label | search query] (optional)"
---

List open issues for the current repository, filtered by `$ARGUMENTS` if given.

Then triage:

1. Cluster the issues into 2–5 themes (bug, feature, docs, question, etc.).
2. For each issue, propose: a label, the single next action, and a priority
   (P0 blocking / P1 soon / P2 later) with a one-line reason.
3. Call out duplicates and stale issues (no activity in a long time).

End with the three issues most worth doing next and why.

Prefer the `github` MCP tools; otherwise use `gh issue list`. If neither is
configured, point the user to the README and stop. Propose changes only — do not
label, close, or comment unless explicitly asked.
