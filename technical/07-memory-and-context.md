# 07 — Memory & Context Management

Source of truth: `src/memdir/`, `src/services/{SessionMemory,extractMemories,compact,contextCollapse}/`,
`src/commands/{memory,remember,forget,memory-retention,semantic-memory,knowledge,context-pack,compact,context}`.

## Layered memory model

| Layer | Location | Written by | Loaded |
|---|---|---|---|
| Project instructions | `UR.md` (repo root, committed) | user or `/init` | every session |
| Local project instructions | `UR.local.md` (gitignored) | user | every session |
| Auto-memory (memdir) | `~/.ur` auto-mem path per project (`autoMemoryDirectory` setting; `UR_CODE_REMOTE_MEMORY_DIR` in containers) | the agent, at turn end (`extractMemories`) | `MEMORY.md` index (≤200 lines / 25 KB) injected each session |
| Team memory | shared team paths (`teamMemPaths.ts`, TEAMMEM gate) | team sync service | when enabled |
| Session transcripts | `~/.ur/projects/<slug>/` | automatic | via `/resume`, past-session search |

### Auto-memory (memdir)
- On by default; disable via `UR_CODE_DISABLE_AUTO_MEMORY=1`, `--bare`, or
  `autoMemoryEnabled: false` (project-level opt-out supported).
- One fact per file with frontmatter (`name`, `description`, `type: user|feedback|project|reference`);
  `MEMORY.md` is the index loaded into context.
- `/memory` opens memory files for editing; `#` prefix in the prompt writes a quick note.

### Explicit memory commands
```
/remember we never bump major versions on Fridays   # save a fact
/forget Fridays                                     # remove matching notes
/memory                                             # edit files interactively
/memory-retention set --ttl-days 90 --max-entries 500 --decay-days 14
/memory-retention prune                             # apply the policy now
```
The bundled `/remember` skill (no args) reviews auto-memory and proposes promotions to
UR.md / UR.local.md and detects stale/duplicate/conflicting entries.

### Semantic memory index
```
/semantic-memory build            # embed project memory (local Ollama embeddings)
/semantic-memory search "how do we rotate tokens"
/semantic-memory status
```

### Knowledge base (`/knowledge`, alias `/kb`) — curated, with provenance
```
/knowledge add src/auth/jwt.ts --note "token flow" --label auth
/knowledge build --embeddings --embed-model nomic-embed-text
/knowledge search "refresh rotation"
/knowledge prune --older-than 60
/knowledge status
```

### Context pack (`/context-pack`, aliases `/ctx-pack`, `/project-manifest`)
Repo-architecture summary + task memory + compressed project context in `.ur/context/`:
```
/context-pack scan
/context-pack remember --type decision --text "we chose fastify over express"
/context-pack compress
/context-pack status
```
Types: `decision | constraint | command | diff | note`.

## Context window management

| Feature | How |
|---|---|
| Visualize usage | `/context` (colored grid), `/files` (files in context) |
| Manual compaction | `/compact [focus instructions]` |
| Auto-compaction | `src/services/compact` — triggers near the limit; `DISABLE_AUTO_COMPACT` env disables; PreCompact/PostCompact hooks fire |
| Context collapse | `src/services/contextCollapse` (CONTEXT_COLLAPSE gate) — collapses old tool results; `CtxInspect` tool |
| Micro-compaction | session-memory compact (`sessionMemoryCompact.ts`, `UR_CODE_SM_COMPACT`) |
| Clear | `/clear` (aliases `/reset`, `/new`) |
| Read caps | Read tool truncates large files/lines; `/read`, `/analyze`, `/summarize` for deliberate loads |

## Project DNA & indexes

```
/dna              # detect language, package manager, build/test/lint → .ur/dna
/index            # build workspace file index (.ur/index)
/code-index build # semantic embeddings index (needs UR_CODE_INDEX=1)
/code-index watch # keep it fresh
/code-index search "debounce input"
```
`/project` and `/workspace` display the recorded DNA + workspace facts.

## What gets injected into the system prompt

Per `src/constants/prompts.ts` (assembled in QueryEngine): UR.md + UR.local.md, the
auto-memory `MEMORY.md` index, project DNA summary, active mode/output style, tool list,
and environment info. `--bare` drops memory, hooks and most extras. Verify with the
internal `--dump-system-prompt` flag (ant builds).
