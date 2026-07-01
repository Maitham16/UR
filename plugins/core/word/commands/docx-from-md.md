---
description: Convert a Markdown file into a styled Word document.
argument-hint: "<path/to/file.md> [output.docx]"
---

Convert a Markdown file to `.docx`.

1. Read the source Markdown at the first argument. If missing, ask for a path
   and stop.
2. Map structure to Word styles: `#`→Title or Heading 1, `##`/`###`→Heading 2/3,
   lists→list styles, fenced code→a monospace style, tables→Word tables, images
   →embedded with the alt text preserved.
3. Write to the second argument if given, else the same basename with a `.docx`
   extension in `${user_config.DOCX_DIR}` or the current directory.

Prefer the `word` MCP tools. If unavailable, use `pandoc -o <out>.docx <in>.md`
when pandoc is installed; otherwise fall back to `python-docx` for headings,
paragraphs, lists, and tables. Report the path and note anything that did not
map cleanly.
