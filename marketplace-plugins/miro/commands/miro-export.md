---
description: Read a Miro board and summarize its contents as Markdown.
argument-hint: "<board name | id | url>"
---

Summarize a board into text. Target = `$ARGUMENTS`. If empty, ask for a board and
stop.

1. Resolve the board and read its items.
2. Produce a structured Markdown outline: frames as `##` sections, then the
   sticky notes, shapes, text, and connectors within each — grouped, not dumped.
   Capture the relationships that connectors imply (`A → B`).
3. End with a short read of the board: its apparent purpose and any obvious gaps
   or loose, unframed items.

Prefer the `miro` MCP tools (`context_get`, `board_list_items`). If the server is
not connected, fall back to the REST API with `$MIRO_TOKEN` (environment variable). Do not
modify the board — this command only reads.
