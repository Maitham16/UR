---
name: Deck Craft (PowerPoint)
description: Conventions for professional PowerPoint decks — layouts over text boxes, one idea per slide, sparse text with detail in notes, visual hierarchy, charts, templates, and accessibility. Use when building, converting, reviewing, or theming .pptx files.
version: 0.1.0
---

# Deck Craft (PowerPoint)

Slides support a talk; they are not the document. Put the argument on the slide,
the detail in the notes.

## One idea per slide

- Each content slide makes a single point; its title states that point as a
  sentence where possible (`Latency dropped 40% after caching`, not `Results`).
- If a slide needs two ideas, it is two slides.

## Sparse text

- Aim for one level of bullets and few words per line. The classic guide is
  roughly six bullets and six words each — treat it as a ceiling, not a target.
- Anything you would read aloud verbatim belongs in the speaker notes.

## Layouts over text boxes

- Use the slide master's layouts and placeholders (title, content, two-content,
  section header). Off-template floating boxes drift and break theming.
- Re-theming should remap content into placeholders, not nudge boxes.

## Visual hierarchy

- One focal point per slide. Size, weight, and position guide the eye to it.
- Align to a grid; consistent margins read as "designed".

## Charts and tables

- Prefer a chart to a table when the point is a trend or comparison.
- Label axes and series; do not make the audience decode a legend.
- Show the takeaway in the title, the evidence in the chart.

## Templates

- Start from a `.potx`/template deck to inherit theme colors, fonts, and layouts.
- Keep brand styling in the template; keep content in the slides.

## Accessibility

- Sufficient contrast; never rely on color alone to convey meaning.
- Alt text on images and charts; slide numbers on; a sensible reading order.

## Flow

- Open with the point, not a long agenda. Use section headers to segment.
- Close with the takeaway and the next step, not "Thank you / Questions" alone.

## Guardrails

- Restyle without rewriting: preserve each slide's message and order.
- Push prose into notes rather than shrinking the font to fit.
- State plainly when a template cannot be applied automatically.
