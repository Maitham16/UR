---
description: Create a diagram or flowchart on a Miro board from a description.
argument-hint: "<description> [on board <name | id | url>]"
---

Turn `$ARGUMENTS` into a diagram on a board. If empty, ask what to diagram and
stop.

1. Parse the description into nodes and directed edges (a process, architecture,
   or mind map). Resolve the target board if one is named; otherwise create a new
   board for it.
2. Express the structure as Miro's diagram DSL and create it in one operation so
   layout and connectors are generated cleanly — do not hand-place dozens of
   shapes.
3. Keep labels short; group related nodes in a frame with a title.

Prefer the `miro` MCP tools (`diagram_create`, and `diagram_get_dsl` to inspect
or refine). If the server is not connected, fall back to the REST API with
`$MIRO_TOKEN` (environment variable) and say if connector auto-layout is not available
that way. Report the board URL and the node/edge count.
