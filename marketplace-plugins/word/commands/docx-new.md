---
description: Create a new Word document from a brief or an outline.
argument-hint: "<topic / brief> or <path/to/outline.md>"
---

Create a `.docx` from `$ARGUMENTS`. If empty, ask for a topic or outline and stop.

1. Gather the brief: if `$ARGUMENTS` is a path to a file, read it as the outline;
   otherwise treat the text as the brief and propose a structure first.
2. Plan the document: a title, optional subtitle/author, a logical heading
   hierarchy, and the sections to write. Confirm a long structure before writing
   if it is non-trivial.
3. Build the document using real Word styles — `Title`, `Heading 1/2/3`, body —
   never manual bold/size as a substitute for styles. Add a table of contents
   field if there are three or more H1s.
4. Save to `${user_config.DOCX_DIR}` if set, else the current directory, with a
   slugged filename.

Prefer the `word` MCP tools (`create_document`, `add_heading`, `add_paragraph`,
`add_table`, ...). If the server is unavailable, fall back to `python-docx` via
Bash. Apply the `document-craft` conventions. Report the path and the final
outline.
