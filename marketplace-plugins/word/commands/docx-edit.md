---
description: Apply targeted edits to a Word document — find/replace, add sections, restyle.
argument-hint: "<path/to/file.docx> — <what to change>"
---

Edit the `.docx` named in `$ARGUMENTS`. Split the argument into the file path and
the change instruction (separated by `—`, `:`, or a newline). If either is
missing, ask for it and stop.

1. Read the document so edits respect its existing structure and styles.
2. Apply only the requested change: find/replace text, insert or remove a
   heading/section, restyle a range, update a table, refresh the TOC. Preserve
   every unrelated paragraph and its style exactly.
3. Save in place. Before overwriting, note that a copy can be kept on request.

Prefer the `word` MCP tools (`find_and_replace`, `add_heading`, `format_text`,
...). If unavailable, fall back to `python-docx`. Report a concise diff of what
changed — sections touched, replacements made — not the whole document.
