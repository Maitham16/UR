---
name: Document Craft (Word)
description: Conventions for producing professional Microsoft Word documents — styles over manual formatting, heading hierarchy, tables of contents, templates, track changes, tables, and accessibility. Use when creating, converting, reviewing, or editing .docx files.
version: 0.1.0
---

# Document Craft (Word)

A Word document is a structured object, not formatted text. Edit the structure;
let styles carry the look.

## Styles over manual formatting

- Use `Title`, `Heading 1/2/3`, `Normal`, `Quote`, and list styles. Never fake a
  heading with bold + larger font — it breaks navigation, the TOC, and
  accessibility.
- Change appearance by editing the style once, not each paragraph.
- One font family for body, one for headings. Avoid per-paragraph color and size.

## Heading hierarchy

- Exactly one `Title`. Do not skip levels (no H1 → H3).
- Headings are an outline: a reader should grasp the document from them alone.

## Table of contents

- Insert a TOC **field**, not a typed list, so it updates with the headings.
- Add one when the document has three or more H1 sections.

## Templates

- Start from a `.dotx` template for repeated document types to inherit styles,
  margins, and a title block. Keep brand styling in the template, not the content.

## Track changes and comments

- For review cycles, enable track changes so edits are visible and reversible.
- Use comments for questions and suggestions; resolve them before finalizing.

## Tables

- Mark the first row as a header row (repeats across pages, aids accessibility).
- Use table styles for banding; avoid manual cell shading per row.

## Accessibility

- Every image needs alt text.
- Links use descriptive text, not a bare URL.
- Maintain reading order and sufficient contrast; do not encode meaning in color
  alone.

## Page setup

- Set margins, headers/footers, and page numbers via section settings, not blank
  paragraphs and tabs.

## Guardrails

- Preserve existing styles when editing; do not restyle untouched content.
- Offer to keep a copy before overwriting a document in place.
- Do not flatten styled content to plain paragraphs during conversion.
