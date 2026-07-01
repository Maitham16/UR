---
description: Capture a source into an atomic, linked, tagged permanent note in your vault.
argument-hint: "<url | file path | topic | pasted text>"
---

Capture `$ARGUMENTS` into a single atomic note. If `$ARGUMENTS` is empty, ask
for a source (URL, file, topic, or text) and stop.

1. Resolve the source. URL → fetch and read it. File path → read it. Text or
   topic → use as-is.
2. Distill to ONE idea, in your own words. The title is a declarative phrase
   that states the idea, not a noun (`Spaced repetition beats massed practice`,
   not `Spaced repetition`).
3. Find real connections. Search `${user_config.OBSIDIAN_VAULT_PATH}` for notes
   with overlapping titles, tags, or terms. Keep the 2–5 genuine ones.
4. Write the note: frontmatter, then the idea in 3–6 sentences, then a
   `## Links` section of `[[wikilinks]]` to the related notes (each with a
   4–8 word reason), then a `## Source` line.

   ```md
   ---
   title: <declarative idea>
   created: <YYYY-MM-DD>
   tags: [<topic>]
   type: permanent
   ---
   ```
5. Save under the vault's notes folder (create `notes/` if there is no existing
   convention) with a Zettelkasten filename: `<YYYYMMDDHHmm> <slug>.md`.
6. Add the reciprocal `[[backlink]]` to each related note if missing.

Prefer the `obsidian` MCP tools when the vault is running and reachable;
otherwise operate directly on files under the vault path. If neither the vault
path nor the MCP is configured, point the user to the plugin README and stop.

Follow the `second-brain` skill for note shape and linking discipline. Report
the created path and every link added.
