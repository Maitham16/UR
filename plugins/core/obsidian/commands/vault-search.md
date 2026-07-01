---
description: Answer a question strictly from the vault, with citations to notes.
argument-hint: "<query>"
---

Answer a question using only what the vault contains, with citations.

Query = `$ARGUMENTS`. If empty, ask for one and stop.

1. Search `${user_config.OBSIDIAN_VAULT_PATH}` across filenames, tags, and full
   text for notes relevant to the query.
2. Read the top matches and synthesize a direct answer in 3–6 sentences.
3. Cite every claim with the note it came from as a `[[wikilink]]`. If notes
   disagree, say so and cite both.
4. If the vault does not answer the question, say so plainly — do not fill the
   gap from general knowledge unless asked. Offer to capture a note with
   `/second-brain`.

Prefer the `obsidian` MCP search tools when available; otherwise grep the vault
files directly. End with a `Notes searched: N` line.
