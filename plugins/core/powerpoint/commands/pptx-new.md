---
description: Build a PowerPoint deck from a brief or an outline.
argument-hint: "<topic / brief> or <path/to/outline.md>"
---

Build a `.pptx` from `$ARGUMENTS`. If empty, ask for a topic or outline and stop.

1. Gather the brief: a path → read it as the outline; text → treat as the brief
   and propose a slide outline first for anything non-trivial.
2. Plan the deck: title slide, an agenda if there are five or more content
   slides, one idea per content slide, and a clear closing/next-steps slide.
3. Build with the deck's layouts and placeholders — title, content, two-content,
   section header — not free-floating text boxes. Keep one idea, few words, and a
   readable type size per slide. Add speaker notes with the detail that does not
   belong on the slide.
4. Save to `${user_config.PPTX_DIR}` if set, else the current directory.

Prefer the `powerpoint` MCP tools (`create_presentation`, `add_slide`,
`add_textbox`, `add_chart`, templates). If the server is unavailable, fall back
to `python-pptx` via Bash. Apply the `deck-craft` conventions. Report the path
and the slide outline.
