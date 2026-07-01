---
description: Apply a template or theme to a deck and normalize it to the layouts.
argument-hint: "<file.pptx> [template.pptx | .potx]"
---

Re-theme the deck named first in `$ARGUMENTS`.

1. Identify the source deck and, if given, the template (`.pptx`/`.potx`) to
   apply. With no template, normalize the deck to its own slide master and
   layouts instead.
2. Apply the theme: move free-floating text into the matching layout
   placeholders, unify fonts and colors to the theme, and keep content intact.
3. Preserve every slide's message and order — this restyles, it does not rewrite.

Prefer the `powerpoint` MCP tools (template/theme application, layout mapping).
If unavailable, do what `python-pptx` allows and clearly state what could not be
remapped automatically. Report which slides changed and any that need a manual
pass.
