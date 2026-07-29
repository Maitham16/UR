# 13 — Research & File/Media Analysis

Source of truth: `src/services/agents/workingMode.ts`,
`src/constants/prompts.ts`, `src/ur/{notes,researchGraph,fileops,sysinfo}.ts`,
and `src/commands/{research,paper,cite,graph,read,search,index,summarize,analyze,convert,image,video,youtube,mode}/`.

## Working mode

```text
/mode research
/mode code
/mode debug
/mode browser
/mode image
/mode video
/mode data
```

The selected value is persisted in `.ur/mode`. `getWorkingModePrompt()` loads it
for the `working_mode` system-prompt section, so it changes the behavioral
instructions used on subsequent model turns. Invalid or unreadable values fall
back to `code`; changing the mode atomically writes a regular in-workspace
marker and clears the system-prompt section cache. A failed write returns
nonzero and leaves the previous marker intact.

This is prompt guidance, not a different model, tool registry, permission mode,
or deterministic workflow engine. Security-specific mode names are handled by
the separate security module.

## Notes, papers, and citations

| Command | Actual operation | Example |
|---|---|---|
| `/research [note]` | Append a timestamped research note, or list notes. | `/research RAG eval baselines chosen` |
| `/paper [title or path]` | Append a paper string, or list papers. It does not parse a PDF. | `/paper papers/mamba.pdf` |
| `/cite [citation]` | Append a citation string, or list citations. It does not resolve or validate the citation. | `/cite Gu & Dao 2023` |

These are per-project file-backed collections under `.ur/`; they do not
automatically enter the model context merely because they were stored. Record
text is non-empty and capped at 64 KiB. The `.ur/research/` directories and
JSONL collection files must be regular in-workspace paths; symlinked storage,
read failures, and write failures return a nonzero command result rather than
claiming success.

## “Research graph”

`/graph` is currently a set of typed append-only JSONL collections under
`.ur/graph/`, not an edge-traversable graph database.

Supported entity names are `sources`, `papers`, `claims`, `methods`, `datasets`,
`metrics`, `limitations`, `citations`, `concepts`, `notes`, `experiments`,
`open_questions`, and `links`.

```text
/graph
/graph papers
/graph papers Mamba: Linear-Time Sequence Modeling
/graph claims SSMs match attention at 1B scale
```

With no argument it reports per-collection counts. With an entity it lists
that collection. With an entity plus text it appends `{ts,text}`. Records do
not have IDs or validated links, so this surface must not be described as a
relational or knowledge graph. Writes are bounded, reject symlinked/outside
storage, and report a nonzero failure instead of claiming a record was saved.

## Text-file helpers

| Command | Operation |
|---|---|
| `/read <path>` | Return a bounded text-like file to the user/model. |
| `/summarize <path>` | Return the bounded file prefixed with a summarization instruction. The model performs the summary. |
| `/analyze <path>` | Return the bounded file prefixed with an analysis instruction. The model performs the analysis. |
| `/search <query>` | Case-insensitive substring search across bounded workspace text files; at most 60 hits. |
| `/index` | Write a path-only workspace index to `.ur/index/files.txt`; this is not an embedding index. |

`/read`, `/summarize`, and `/analyze` accept the entire remaining command string
as the path, so workspace-relative paths containing spaces work without special
token parsing. `readFileSafe()` rejects absolute paths, `..`, directories,
binary extensions, and symlinks that resolve outside the workspace. Reads are
truncated at 64,000 characters by default.

`/search` and `/index` walk at most 8,000 entries and skip hidden entries other
than `.ur` plus common dependency/build directories. They are dependency-free
convenience helpers, not substitutes for the model tools `Grep`, `Glob`, or
semantic `CodeSearch`. The walker canonicalizes candidate files and skips
symlinks resolving outside the workspace. `/index` writes atomically beneath a
canonical in-workspace `.ur/index/` directory and returns nonzero if
`files.txt` cannot be persisted.

## Conversion and media commands

These commands have intentionally narrow behavior:

| Command | What it actually does |
|---|---|
| `/convert <file> <target>` | Reports which of `pandoc`, `ffmpeg`, and `libreoffice` are installed. It does **not** execute a conversion or create an output file. |
| `/image <file> [task]` | Reports extension/size and, when `tesseract` exists, runs bounded OCR. It ignores the optional task text and does not invoke a vision model. |
| `/video <file\|url> [task]` | For a local file, reports bounded `ffprobe` format/stream metadata. For a URL, reports whether `yt-dlp` is installed. It does not extract frames/audio and ignores task text. |
| `/youtube <url> [task]` | Runs `yt-dlp --dump-json --skip-download` and prints selected metadata/description. It does not fetch subtitles/transcripts or summarize, and ignores task text. |

`/convert`, `/image`, `/video`, and `/youtube` take only the first whitespace
token as the file/URL (and `/convert` takes the second as target), so paths
containing spaces are not supported by those four parsers. Their output may
suggest asking the agent to use Bash or a vision-capable model for the next
step, but the local command itself has not performed that next step.
`/image` and `/video` also accept absolute paths and do not enforce workspace
containment.

`/os` reports presence of `git`, `ollama`, `node`, `bun`, `python3`, `ffmpeg`,
`yt-dlp`, `rg`, `cargo`, and `go`. `/ur-doctor` repeats that tool list, probes
the selected Ollama host, lists selected `.ur` assets, and checks for workspace
Playwright. Its current `mcp cfg` line checks legacy
`.ur/mcp/servers.toml` paths rather than the normal `.mcp.json`/settings MCP
sources, so it is not an authoritative MCP configuration diagnostic.

## Research-oriented bundled skills

The normal build registers these user-invocable prompt workflows:

- `/paper-implementation` (alias `/implement-paper`);
- `/latex-paper` (alias `/latex`); and
- `/benchmark` (aliases `/bench`, `/perf`).

Their prompts instruct the model to spawn an isolated worktree agent, gather
focused evidence, ask before a broader final verification sequence, and avoid
commit/push/PR publication unless separately requested. Those are agent
instructions, not a deterministic guarantee that the model completed every
step; verify the returned worktree, diff, and command evidence.
