# Memory

- `/remember <text>` saves a fact/preference; `/forget <text>` removes matches;
  `/memory` edits the memory files. Notes persist in `.ur/memory/notes.jsonl`.
- Project conventions live in project instruction files and the project DNA file.
- `/dna` detects language, package manager, build/test/lint/run commands,
  ignored folders, and README, saved to `.ur/project_dna.md`.
- `ur context-pack scan` writes `.ur/project-manifest.json` and
  `.ur/context/architecture.md` from package scripts, instruction files,
  `.ur/verify.json`, and safety config.
- `ur context-pack remember --decision|--constraint|--command|--diff|--note`
  appends provenance-rich, hash-chained task memory to
  `.ur/context/task-memory.jsonl`; `ur context-pack memory verify|quarantine`
  checks or repairs a corrupt tail, `memory rollback --to <entry-id>` preserves
  a private backup before truncation, and `compress` writes
  `.ur/context/compressed.md`.
- `/ur-init` scaffolds the `.ur/` asset folder (docs, superpowers, brainstorming,
  memory, prompts).
