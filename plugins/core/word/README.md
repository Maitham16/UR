# word

Create, convert, review, and edit Microsoft Word documents from any UR session.
Backed by the **Office Word MCP server** (python-docx, ~54 tools), with a
`pandoc` / `python-docx` fallback so the commands still work headless.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/docx-new` | `<brief \| outline.md>` | Create a styled document from a brief or outline. |
| `/docx-from-md` | `<file.md> [out.docx]` | Convert Markdown to a styled `.docx`. |
| `/docx-review` | `<file.docx>` | Report structure, styling, and accessibility issues with a verdict. |
| `/docx-edit` | `<file.docx> — <change>` | Apply targeted edits while preserving styles. |

A bundled `document-craft` skill defines the styling and accessibility
conventions all commands follow.

## Setup

```sh
/plugin install word@ur-plugins-official
```

The MCP server runs via `uvx`, so install **uv** once
(`curl -LsSf https://astral.sh/uv/install.sh | sh`). UR launches
`uvx --from office-word-mcp-server word_mcp_server` on demand — no manual clone.
Optionally set **DOCX_DIR** as the default output folder.

Fallbacks use `pandoc` (Markdown → docx) and `python-docx`
(`pip install python-docx`); install either if you want the commands to work
without `uvx`.

## Security

The server operates on local files only. Edits preserve existing styles, and
in-place overwrites can keep a backup on request.
