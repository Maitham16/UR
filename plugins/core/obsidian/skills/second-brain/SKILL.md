---
name: Second Brain (Obsidian)
description: Conventions for building and maintaining a durable Obsidian knowledge base — atomic and evergreen notes, Zettelkasten linking, PARA structure, Maps of Content, frontmatter, and daily notes. Use when creating, organizing, linking, or searching notes in an Obsidian vault.
version: 0.1.0
---

# Second Brain (Obsidian)

A second brain is a network of notes, not a folder of documents. Its value is
in the links, not the storage. Optimize for future retrieval and connection.

## Principles

- **Atomic.** One note, one idea. If a note needs "and" in its title, split it.
- **Evergreen.** Write notes you can reuse, not log entries. Phrase titles as
  claims (`Caching trades freshness for latency`), so the title alone carries
  the idea.
- **Your own words.** Restate, never paste. Quotes go under `## Source`.
- **Link first.** A note with no links is lost. Connect every new note to at
  least one existing note while the context is fresh.
- **Concept over category.** Prefer a link to a tag, and a tag to a folder.

## Note types

- **Fleeting** — quick capture, lives in the daily note, processed within a day.
- **Literature** — your summary of one external source, with the citation.
- **Permanent** — one durable idea in your own words, densely linked. The core
  of the vault.

## Frontmatter

```md
---
title: <declarative idea>
created: <YYYY-MM-DD>
tags: [<topic>]
type: permanent      # fleeting | literature | permanent | moc
---
```

## Naming and IDs

Zettelkasten timestamp prefix keeps notes unique and stable under renames:
`<YYYYMMDDHHmm> <slug>.md`. The human title lives in frontmatter and the `# H1`.

## Structure (PARA, lightly)

- `Projects/` — notes tied to an active outcome with a deadline.
- `Areas/` — ongoing responsibilities with no end date.
- `Resources/` — topic notes and references (most permanent notes live here).
- `Archive/` — inactive items.
- `Daily/` — dated notes. `MOCs/` — index notes.

Folders are for lifecycle, not topic. Topic lives in links and tags.

## Maps of Content (MOCs)

When a topic exceeds ~7 notes, make a `<Topic> MOC` that links them under a few
sub-themes and lists open threads. MOCs are the table of contents you grow into;
they replace deep folder trees.

## Tags vs links

- **Links** (`[[note]]`) connect specific ideas. Prefer them.
- **Tags** (`#status/draft`, `#topic/edge`) slice across notes by state or theme.
  Keep a small, controlled tag set; an unbounded tag list is noise.

## Daily notes

The daily note is the inbox and the journal: capture fleeting thoughts, log what
happened, link out to permanent notes. Process fleeting notes out of it regularly
so it never becomes the place ideas go to die.

## Maintenance

- After capture, always backlink.
- Weekly: empty fleeting notes, promote the keepers to permanent, refresh MOCs.
- Treat orphan notes (zero links) as a backlog to wire in, not as done.

## Anti-patterns

- Pasting a source verbatim and calling it a note.
- Noun-titled notes that collect unrelated facts.
- Deep folder hierarchies used as a substitute for linking.
- Tag sprawl: a new tag per note.
- Capturing without ever linking or revisiting.
