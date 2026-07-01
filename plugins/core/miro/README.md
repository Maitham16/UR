# miro

Create and read Miro boards from any UR session: spin up boards, generate
diagrams from a description, drop sticky-note clusters, and summarize a board to
Markdown. Backed by Miro's **official MCP server** (OAuth), with the Miro REST
API v2 as a fallback.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/miro-board` | `[name \| list]` | Create a board or list the boards in your team. |
| `/miro-diagram` | `<description>` | Generate a diagram/flowchart via the diagram DSL. |
| `/miro-stickies` | `<idea; idea; ...>` | Drop a tidy cluster of sticky notes in a titled frame. |
| `/miro-export` | `<board>` | Summarize a board's frames, items, and connectors as Markdown. |

A bundled `miro-workflow` skill documents the MCP tool groups, the REST fallback,
board conventions, and guardrails.

## Setup

```sh
/plugin install miro@ur-plugins-official
```

On enable, **MIRO_MCP_URL** defaults to `https://mcp.miro.com/`. The server
authenticates via OAuth on first connect; you choose which **team** to grant
access to. Enterprise accounts need admin approval.

The REST fallback (used only when the MCP server is not connected) reads a token
from the `$MIRO_TOKEN` environment variable — scope it `boards:read` and/or
`boards:write`. The primary OAuth path needs no token.

## Security

The MCP server is limited to the team you authorize, and no secret is written
into plugin settings or prompt content. Commands default to reading; creating
boards or bulk items is confirmed first, and existing content is never deleted or
rearranged as a side effect.
