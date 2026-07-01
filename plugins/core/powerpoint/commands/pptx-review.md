---
description: Critique a PowerPoint deck for density, consistency, and design.
argument-hint: "<path/to/file.pptx>"
---

Review the `.pptx` at `$ARGUMENTS`. If empty, ask for a path and stop.

Read every slide and report, skipping any section with no findings:

### Density
Slides over ~6 bullets or ~36 words, walls of text that belong in notes, fonts
smaller than is readable from the back of a room.

### Consistency
Inconsistent titles, fonts, colors, or bullet styles across slides; misaligned
elements; off-template text boxes where a placeholder belongs.

### Design and accessibility
Low text/background contrast, color used as the only signal, charts without
labels, images without alt text, missing slide numbers.

### Flow
Missing agenda or closing, abrupt section changes, a buried key message.

### TL;DR
End with exactly one of:
- `TL;DR: Ready to present.`
- `TL;DR: Minor polish.`
- `TL;DR: Needs a rework.`

Prefer the `powerpoint` MCP tools to read the deck; otherwise inspect it with
`python-pptx`. Do not modify the file — this command only reports.
