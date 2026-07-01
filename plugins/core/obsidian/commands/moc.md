---
description: Build or refresh a Map of Content (index note) for a topic.
argument-hint: "<topic>"
---

Build or refresh a Map of Content (MOC) — an index note that links every note
on a topic.

Topic = `$ARGUMENTS`. If empty, ask for one and stop.

1. Search `${user_config.OBSIDIAN_VAULT_PATH}` for notes matching the topic by
   tag, title, or body term.
2. Group the hits into 2–5 sub-themes. Derive the grouping from the notes
   themselves, not a fixed taxonomy.
3. Write or overwrite `<Topic> MOC.md`: frontmatter `tags: [moc]`, a one-line
   scope statement, then grouped `[[wikilinks]]` under `###` sub-theme headings.
   Order links by relevance, not alphabetically.
4. Add `## Open threads` listing questions or gaps the current notes do not yet
   answer.
5. Link the MOC back from each member note (add `[[<Topic> MOC]]` under an
   `## Up` line if absent).

Prefer the `obsidian` MCP tools when available; otherwise operate on files
directly. Report the MOC path, how many notes it indexes, and the gaps found.
