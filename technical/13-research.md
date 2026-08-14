# 13 — Research & File/Media Analysis

Source of truth: `src/services/research/researchWorkspace.ts`,
`src/services/design3d/design3d.ts`, `src/ur/{notes,researchGraph,fileops,sysinfo}.ts`,
`src/commands/{research,design3d,paper,cite,graph,read,search,index,summarize,analyze,convert,image,video,youtube,mode}`.

## Research working mode

```
/mode research      # switch the agent's working mode (also: code, debug, browser, image, video, data)
```

Security research uses the distinct session-only `/mode redteam`; it has a
mandatory warning and preserves operational controls. See doc 12 and
`docs/REDTEAM.md`.

## Evidence-backed research workspaces

```sh
ur research init agent-landscape --question "Which capabilities shipped recently?"
ur research source agent-landscape --url https://example.com/spec --title "Primary specification" --publisher "Standards body"
ur research finding agent-landscape --text "The capability shipped." --cite S1,S2 --confidence high
ur research question agent-landscape --text "Is the protocol final?"
ur research verify agent-landscape
ur research report agent-landscape --out docs/research/agent-landscape.md
```

Projects are stored atomically under `.ur/research/projects/`. URLs must use
HTTP(S); embedded credentials, fragments, and common secret query parameters
are removed. Supported/contested/open findings cite source IDs. Verification
rejects uncited supported claims and warns when high confidence lacks two
independent publishers. Report output is confined to the workspace. The old
`/research <note>` behavior remains available for unrecognized free text.

## Notes, papers, citations

| Command | Use | Example |
|---|---|---|
| `/research <unrecognized note>` | Append a legacy research note | `/research RAG eval baselines chosen` |
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

## Professional 3D / DCC / CAD

```sh
ur design3d doctor
ur design3d init product --engine blender --units mm --format glb
ur design3d init printable --engine openscad --units mm --format stl
ur design3d init studio --engine 3dsmax --units cm --format max
ur design3d build design3d/product --dry-run
ur design3d build design3d/product
ur design3d inspect design3d/product/build/product.glb
ur design3d validate design3d/product
```

The built-in adapters create reviewable Blender Python, OpenSCAD, or MAXScript
source and a unit-aware `design3d.json`. Application/source/output paths stay
inside the project, launches use fixed argv with no shell, execution is bounded,
and overwriting requires `--force`. A custom adapter can drive Maya, FreeCAD,
Houdini, Cinema 4D, Rhino, or another installed app after dry-run review and
explicit `--allow-custom`. GLB/glTF/STL/OBJ/BLEND/MAX inspection is local; an
installed Khronos `gltf_validator` supplies full glTF conformance checks.

## Research-oriented bundled skills

- `/paper-implementation <paper/url>` (`/implement-paper`) — implement an
  algorithm from a paper in an isolated worktree with tests and notes.
- `/latex-paper` (`/latex`) — scaffold/compile a LaTeX paper with a build
  script in an isolated worktree.
- `/benchmark` — add/run benchmarks and record results in an isolated worktree.
- `/research-pro` (`/evidence-research`) — current primary-source research with
  disconfirming evidence, cited atomic findings, and corroboration verification.
- `/dcc-design` (`/professional-3d`) — application-aware, unit-safe parametric
  3D work with dry-run, build, structural/native validation, and honest visual
  review boundaries.

These skills keep changes local, ask before the final full verification or
benchmark sequence, and do not commit, push, or open a PR unless the user makes
a separate explicit request.
