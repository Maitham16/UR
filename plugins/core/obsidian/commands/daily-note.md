---
description: Open or create today's daily note and append a timestamped log entry.
argument-hint: "[log entry] (optional)"
---

Open today's daily note, creating it if missing, and append `$ARGUMENTS` as a
timestamped entry when provided.

1. Compute today's date as `YYYY-MM-DD`.
2. Locate the daily note. Check, in order: a `Daily/` folder, a `Journal/`
   folder, then the vault root. If none exists, create `Daily/<YYYY-MM-DD>.md`.
3. If the file is new, seed it:

   ```md
   ---
   date: <YYYY-MM-DD>
   tags: [daily]
   ---
   # <YYYY-MM-DD>

   ## Log
   ```
4. If `$ARGUMENTS` is non-empty, append `- <HH:mm> $ARGUMENTS` under `## Log`.
5. Surface what is due: scan recent notes for `[[<YYYY-MM-DD>]]` references and
   open tasks (`- [ ]`) that name today, and list them under `## Due`.

Prefer the `obsidian` MCP tools if the vault is running; otherwise edit files
under `${user_config.OBSIDIAN_VAULT_PATH}`. Report the note path and what was
appended.
