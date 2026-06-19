---
description: Create a Miro board, or list your boards, and return the link.
argument-hint: "[board name | 'list']"
---

Manage boards.

- If `$ARGUMENTS` is empty or `list`, list the boards you can access in the
  authorized team — name and link each.
- Otherwise create a new board named `$ARGUMENTS`, optionally seed it with a
  titled frame, and return its URL.

Prefer the `miro` MCP tools (board listing / creation, `context_explore`). If the
server is not connected, fall back to the Miro REST API
(`GET`/`POST https://api.miro.com/v2/boards`) using `$MIRO_TOKEN` (environment variable).
If neither is configured, point the user to the plugin README and stop. Report
the board name and URL.
