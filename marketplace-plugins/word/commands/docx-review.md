---
description: Review a Word document's structure, styling, and accessibility.
argument-hint: "<path/to/file.docx>"
---

Review the `.docx` at `$ARGUMENTS`. If empty, ask for a path and stop.

Read the document and report, skipping any section with no findings:

### Structure
Heading hierarchy sanity (no skipped levels, one Title), section/page breaks,
presence and correctness of a table of contents.

### Styling
Manual formatting used where a style belongs, inconsistent fonts or sizes,
direct color use, hard line breaks faking spacing.

### Accessibility
Images without alt text, tables without header rows, low-contrast text, links
with bare URLs instead of descriptive text.

### TL;DR
End with exactly one of:
- `TL;DR: Clean.`
- `TL;DR: Minor fixes.`
- `TL;DR: Needs structural work.`

Prefer the `word` MCP tools to read the document; otherwise inspect it with
`python-docx`. Do not modify the file — this command only reports.
