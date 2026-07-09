# 13 — Research & File/Media Analysis

Source of truth: `src/ur/{notes,researchGraph,fileops,sysinfo}.ts`,
`src/commands/{research,paper,cite,graph,read,search,index,summarize,analyze,convert,image,video,youtube,mode}`.

## Research working mode

```
/mode research      # switch the agent's working mode (also: code, debug, browser, image, video, data)
```

## Notes, papers, citations

| Command | Use | Example |
|---|---|---|
| `/research [note]` | Append/list research notes | `/research RAG eval baselines chosen` |
| `/paper [title or path]` | Track papers (local PDFs or titles) | `/paper ~/papers/mamba.pdf` |
| `/cite [citation]` | Track citations | `/cite Gu & Dao 2023` |

Bare invocations list existing entries. Stored per-project via `src/ur/notes.ts`.

## Research graph (`/graph`)

Typed entity graph — papers, claims, methods, datasets, results
(`src/ur/researchGraph.ts`):
```
/graph                       # summary of the graph
/graph paper "Mamba: Linear-Time Sequence Modeling"
/graph claim "SSMs match attention at 1B scale"
/graph method "selective state space"
/graph dataset "The Pile"
```

## Reading & analyzing files

| Command | Use | Example |
|---|---|---|
| `/read <file>` | Load a text-like file into context | `/read docs/rfc-42.md` |
| `/summarize <file>` | Load for summarization | `/summarize paper.tex` |
| `/analyze <file>` | Load for analysis | `/analyze bench-results.json` |
| `/search <query>` | Text search across workspace | `/search "deadline exceeded"` |
| `/index` | Build the workspace file index (`.ur/index`) | `/index` |
| `/convert <file> <target>` | Format conversion, dependency-aware (pandoc/ffmpeg etc.) | `/convert notes.md pdf` |

## Media

| Command | Use | Example |
|---|---|---|
| `/image <file> [task]` | Vision/OCR-aware image inspection | `/image chart.png "extract the numbers"` |
| `/video <file\|url> [task]` | Video inspection (ffmpeg / yt-dlp aware) | `/video talk.mp4 "list the demos shown"` |
| `/youtube <url> [task]` | Metadata/transcript fetch | `/youtube https://youtu.be/… "summarize"` |

Deps are detected at runtime (`/os`, `/ur-doctor` report which of ffmpeg/yt-dlp/
playwright/tesseract-class tools are available); commands degrade gracefully and tell you
what to install.

## Research-oriented bundled skills

- `/paper-implementation <paper/url>` — implement an algorithm from a paper in an
  isolated worktree with tests and notes, then a PR.
- `/latex-paper` — scaffold/compile a LaTeX paper with a build script.
- `/benchmark` — add/run benchmarks and optionally commit results.
