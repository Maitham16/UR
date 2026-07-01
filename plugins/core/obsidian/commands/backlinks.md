---
description: Find and insert the bidirectional [[wikilinks]] a note should have.
argument-hint: "[note path] (default: most recently modified note)"
---

Wire a note into the vault by adding the links it should have.

Target = `$ARGUMENTS` if given, otherwise the most recently modified `.md` under
`${user_config.OBSIDIAN_VAULT_PATH}`, excluding daily notes.

1. Read the target note's content and tags.
2. Search the vault for notes that share concepts, tags, or named entities with
   the target. Rank by overlap; keep the 3–8 strongest.
3. In the target, add or extend a `## Links` section with `[[wikilinks]]`, each
   followed by a 4–8 word reason.
4. For each linked note, add the reciprocal `[[backlink]]` to the target if
   missing, so every connection is bidirectional.
5. Do not invent links. Connect only notes with a real conceptual relationship;
   if fewer than three exist, say so rather than padding.

Prefer the `obsidian` MCP tools when the vault is running; otherwise edit files
directly. Report every link added in both directions.
