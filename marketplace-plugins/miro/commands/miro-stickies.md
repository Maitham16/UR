---
description: Drop a cluster of sticky notes onto a Miro board from a list of ideas.
argument-hint: "<idea; idea; ...> [on board <name | id | url>]"
---

Add sticky notes to a board.

1. Gather the ideas: a `;`- or newline-separated list in `$ARGUMENTS`, a file
   path, or — if none given — the brainstorm from recent conversation context.
   If there is nothing to add, ask and stop.
2. Resolve the target board, or create one named for the topic.
3. Create one sticky per idea, laid out as a tidy grid inside a titled frame.
   Use color to encode a single dimension (theme or priority) if one is obvious;
   otherwise keep them uniform.

Prefer the `miro` MCP item-creation tools. If the server is not connected, fall
back to the REST API (`POST https://api.miro.com/v2/boards/{id}/sticky_notes`)
with `$MIRO_TOKEN` (environment variable). If neither is configured, point the user to the
README and stop. Report the board URL and the number of notes added.
