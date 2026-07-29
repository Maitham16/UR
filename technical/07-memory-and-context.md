# 07 — Memory & Context Management

Source of truth: `src/memdir/`, `src/services/{SessionMemory,extractMemories,compact,contextCollapse}/`,
`src/commands/{memory,remember,forget,memory-retention,semantic-memory,knowledge,context-pack,compact,context}`.

## Layered memory model

| Layer | Location | Written by | Loaded |
|---|---|---|---|
| Project instructions | `UR.md` (repo root, committed) | user or `/init` | normal, non-`--bare` root sessions |
| Local project instructions | `UR.local.md` (gitignored) | user | normal, non-`--bare` root sessions |
| Auto-memory (memdir) | the project-scoped auto-memory path under `~/.ur` (`autoMemoryDirectory` setting; `UR_CODE_REMOTE_MEMORY_DIR` in containers) | the main agent, while working, when the injected memory instructions call for a durable note | either the bounded `MEMORY.md` index or selected topic attachments, depending on the relevance-recall gate |
| Team memory | shared team paths (`teamMemPaths.ts`, `TEAMMEM` build gate) | team sync service | source-only in this repository's standard npm build |
| Session transcripts | `~/.ur/projects/<slug>/` | automatic | via `/resume`, past-session search |

### Auto-memory (memdir)
- On by default; disable via `UR_CODE_DISABLE_AUTO_MEMORY=1`, `--bare`, or
  `autoMemoryEnabled: false` (project-level opt-out supported).
- The stable path loads the byte/line-capped `MEMORY.md` index. When the
  `tengu_moth_copse` runtime gate is enabled, UR instead performs a
  non-blocking recall: a lexical header prefilter narrows candidates, a small
  model selects at most three, and each selected file is truncated and
  session-byte-capped before attachment. A failed or late selector never blocks
  the main turn.
- Topic files use frontmatter (`name`, `description`,
  `type: user|feedback|project|reference`); `MEMORY.md` is their index.
- The normal npm build asks the main agent to maintain these files directly.
  The separate turn-end `extractMemories` implementation is behind the
  compile-time `EXTRACT_MEMORIES` feature and is not bundled by
  `scripts/bundle.mjs`; setting an environment variable alone cannot enable
  that background extractor.
- `/memory` opens memory files for editing. There is no special `#` prompt
  prefix for writing a note.
- `/remember <text>` writes the legacy project note and also promotes the note
  into auto-memory when enabled. `/forget <text>` removes matching legacy
  notes, their deterministic promoted topic files, and the corresponding index
  links. Persistence failures are reported as failures or partial results,
  rather than as successful saves. The project-note JSONL text is non-empty
  and capped at 64 KiB; its `.ur/memory/` path must remain a regular directory
  inside the canonical workspace, and symlinked collection files are rejected.

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

### Automatic learning
- On by default; disable via `UR_CODE_DISABLE_AUTO_LEARNING=1` or
  `automaticLearningEnabled: false`.
- ci-loop, arena, escalation, test-first, and cloud-task outcomes are folded into
  `.ur/learning/stats.json` as local JSON. This automatic path uses no model
  calls and no prompt tokens.
- Learned success rates bias auto model routing and escalation only when there
  is enough evidence; otherwise static routing is unchanged.

### Lexical memory index
```
/semantic-memory build            # build a local lexical index
/semantic-memory search "how do we rotate tokens"
/semantic-memory status
```

Despite the historical command name, this implementation does not call an
embedding model. It tokenizes paragraphs from `UR.md`, `README.md`,
`.ur/memory/`, and `.ur/docs/`, then ranks by query-token overlap. Use
`/knowledge build --embeddings` or `/code-index build` when dense embedding
retrieval is required.

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
/context-pack memory verify
/context-pack memory quarantine
/context-pack memory rollback --to <entry-id>
/context-pack compress
/context-pack status
```
Types: `decision | constraint | command | diff | note | architecture |
preference | attempt | accepted | rejected`. New entries contain UUIDs,
source provenance, content digests, and a SHA-256 previous-entry chain. Appends
are locked, private, no-follow, and fsynced; reads fail closed. Quarantine and
rollback preserve a private copy of the full original before replacement.

## Context window management

| Feature | How |
|---|---|
| Visualize usage | `/context` (colored grid); `/files` is an ant-only command and is absent from the standard npm CLI |
| Manual compaction | `/compact [focus instructions]` |
| Auto-compaction | `src/services/compact` — triggers near the limit; `DISABLE_AUTO_COMPACT` env disables; PreCompact/PostCompact hooks fire |
| Context collapse | `src/services/contextCollapse` and `CtxInspect` are behind the compile-time `CONTEXT_COLLAPSE` feature, which the standard npm bundle does not include |
| Micro-compaction | session-memory compact (`sessionMemoryCompact.ts`): force on with `ENABLE_UR_CODE_SM_COMPACT=1`, force off with `DISABLE_UR_CODE_SM_COMPACT=1`; otherwise both `tengu_session_memory` and `tengu_sm_compact` runtime gates must be on |
| Clear | `/clear` (aliases `/reset`, `/new`) |
| Read caps | Read tool truncates large files/lines; `/read`, `/analyze`, `/summarize` for deliberate loads |

## Repo wiki & map

```
/wiki generate       # .ur/wiki/: overview, architecture, dependency map (from DNA + code index)
/wiki install-hook   # refresh automatically after every merge
/wiki map            # regenerate .ur/repo-map.md
```
When `.ur/repo-map.md` exists and is fresh (less than seven days), a byte-capped
repo map is injected into the system prompt automatically (zero tokens until
generated).

## Project DNA & indexes

```
/dna              # detect language, package manager, build/test/lint → .ur/dna
/index            # build workspace file index (.ur/index)
/code-index build # semantic embeddings index — CodeSearch auto-enables once built
/code-index watch # keep it fresh
/code-index search "debounce input"
```
`/project` and `/workspace` display the recorded DNA + workspace facts.

## What gets injected into the system prompt

The interactive and print entrypoints both assemble the prompt through
`src/constants/prompts.ts` plus the context helpers. A normal root prompt
includes UR.md/UR.local.md instructions, auto-memory as described above, the
active working-mode discipline, output style, enabled-tool guidance, and
environment information. Read-only `Explore` and `Plan` subagents omit the
UR.md hierarchy when the default-on `tengu_slim_subagent_agentmd` runtime gate
is active and the caller did not explicitly supply user context. Project DNA
is not injected directly; it can appear through a fresh generated repo map.
`--bare` replaces the root prompt with a minimal prompt and drops automatic
memory, hooks, and most extras. The internal `--dump-system-prompt` diagnostic
exists only in ant builds.
