---
description: Convert a Markdown outline into a PowerPoint deck.
argument-hint: "<path/to/outline.md> [output.pptx]"
---

Convert a Markdown outline to `.pptx`.

1. Read the source at the first argument. If missing, ask for a path and stop.
2. Map structure to slides: `#`→title slide, each `##`→a new slide title,
   bullets→slide bullets (one level of nesting max on screen), a fenced
   `notes:` block or HTML comment→speaker notes, image links→slide images,
   tables→a table or a chart where it reads better.
3. Keep slides sparse — push prose into the notes, not onto the slide.
4. Write to the second argument if given, else the same basename with `.pptx` in
   `${user_config.PPTX_DIR}` or the current directory.

Prefer the `powerpoint` MCP tools; otherwise fall back to `python-pptx`. Report
the path and the slide count, and flag any slide that ended up text-heavy.
