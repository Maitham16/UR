# powerpoint

Build, convert, review, and theme PowerPoint decks from any UR session. Backed by
the **Office PowerPoint MCP server** (python-pptx, ~32 tools with templates and
themes), with a `python-pptx` fallback so the commands still work headless.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/pptx-new` | `<brief \| outline.md>` | Build a deck from a brief or outline, with speaker notes. |
| `/pptx-from-md` | `<outline.md> [out.pptx]` | Convert a Markdown outline to a sparse deck. |
| `/pptx-review` | `<file.pptx>` | Critique density, consistency, and design with a verdict. |
| `/pptx-theme` | `<file.pptx> [template]` | Apply a template/theme and normalize to layouts. |

A bundled `deck-craft` skill defines the design conventions all commands follow.

## Setup

```sh
/plugin install powerpoint@ur-plugins-official
```

The MCP server runs via `uvx`, so install **uv** once
(`curl -LsSf https://astral.sh/uv/install.sh | sh`). UR launches
`uvx --from office-powerpoint-mcp-server ppt_mcp_server` on demand — no manual
clone. Optionally set **PPTX_DIR** as the default output folder.

The fallback uses `python-pptx` (`pip install python-pptx`); install it if you
want the commands to work without `uvx`.

## Security

The server operates on local files only. Re-theming preserves slide content and
order; reviews never modify the deck.
