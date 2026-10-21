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
- Recall is token-bounded: only a few high-confidence topic memories are
  surfaced for a turn, and each is truncated before injection. This is meant
  to reduce repeated explanation/context, not add a large memory dump.
- One fact per file with frontmatter (`name`, `description`, `type: user|feedback|project|reference`);
  `MEMORY.md` is the index loaded into context.
- `/memory` opens memory files for editing; `#` prefix in the prompt writes a quick note.
- `/remember <text>` writes the legacy project note and also promotes the note
  into auto-memory when auto-memory is enabled, so future turns can recall it
  through the bounded relevance path.

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
- ci-loop, arena, escalation, test-first, executed prompt-plan tasks, and
  terminal crew tasks are folded into
  `.ur/learning/stats.json` as local JSON. This automatic path uses no model
  calls and no prompt tokens.
- Writes are batched, process-locked, private, and atomically renamed. A stale
  reflection run re-reads and merges the current store before saving, so
  parallel agents do not erase each other's outcomes. Valid-but-malformed
  stores normalize to an empty safe shape instead of crashing routing.
- Learned success rates bias auto model routing and escalation only after at
  least five outcomes. Selection uses a confidence-adjusted success bound, so
  a tiny perfect sample does not beat a larger proven record. Otherwise static
  routing is unchanged.
- Learning records task category/model outcomes and failure lessons; it does
  not retrain model weights or blindly replay a previous patch.

### Semantic memory index
```
/semantic-memory build            # current bodies + optional local Ollama embeddings
/semantic-memory search "how do we rotate tokens"
/semantic-memory status
/semantic-memory build --lexical  # explicit offline text retrieval
```

The canonical command refreshes source content on every build/search. Sources are
`UR.md`, `README.md`, and recursive Markdown/text/JSONL files under `.ur/memory`
and `.ur/docs`; quarantine and hidden directories are excluded. Search combines
Unicode-aware lexical scores with cosine similarity when embeddings are available.
Arabic, accented words, camelCase identifiers and space-less East Asian text are
retained. Query-time hash validation also rejects stale entries from an older
in-memory index. Each hit includes its source path, actual line range, SHA-256
source digest and any explicitly declared competing facts.

Embeddings use `UR_MEMORY_EMBED_MODEL`, falling back to the code-index embedding
model (`UR_CODE_INDEX_EMBED_MODEL`, default `nomic-embed-text`). Requests use the
configured Ollama endpoint and existing authentication. Missing models, network
errors, non-finite vectors and dimension mismatches yield explicit lexical mode
and an explanation in JSON/text output. UR does not silently download a model.
`--lexical` avoids embedding requests. Each embedding request has a 10-second
bound and obeys cancellation. Actual semantic/paraphrase quality depends on the
chosen embedding model; lexical fallback does not promise paraphrase recall.

Auto-memory recall uses the same current-body retrieval and consistency rules,
then lets the configured selector model choose up to three memories from up to
40 candidates. It no longer filters solely on filename/description keywords.
Set `UR_MEMORY_EMBED_MODEL` to enable embeddings in automatic recall; without it,
body lexical ranking supplies candidates and the selector still judges meaning.
This avoids automatic embedding requests for users who have not configured a
memory embedding model. Retrieval mode is recorded in debug logs. Candidate
excerpts carry conflict annotations, and files changed during selection are
excluded. The extraction manifest keeps its separate 200-file display limit;
recall scans all eligible memory files before ranking.

Optional Markdown frontmatter makes consistency explicit:

```yaml
---
id: deployment-policy
supersedes: previous-deployment-policy
conflict-key: production-deployment
valid-until: "2027-01-01T00:00:00Z"
anchors:
  - path: src/deploy.ts
    sha256: "<SHA-256 of the source file's UTF-8 content>"
---
Deployment policy and the evidence supporting it.
```

`supersedes` accepts one ID or a list; absent IDs default to the project-relative
memory path. `status: deleted` and `status: superseded` exclude a document.
Expired/invalid validity dates, missing anchors, and mismatched source digests
exclude stale evidence. Competing active documents with the same `conflict-key`
(or duplicate ID with different bodies) remain labeled for model/user judgment;
the retriever does not invent a resolution to arbitrary natural-language
contradictions. Explicit supersession is evaluated across the whole store,
including memories already surfaced earlier in a session.

Deleting or editing a source removes its old text/vectors from the next
persisted refresh. This is cache invalidation, not secure erasure from filesystem
backups. Index writes are private and atomic. Old lexical-only indexes are
rebuilt automatically from sources at the same command and location; no parallel
versioned command exists. Integrity signatures remain the separate
`memory-integrity` facility, not a property inferred from a content hash.

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
| Visualize usage | `/context` (colored grid), `/files` (files in context) |
| Manual compaction | `/compact [focus instructions]` |
| Auto-compaction | `src/services/compact` — triggers near the limit; `DISABLE_AUTO_COMPACT` env disables; PreCompact/PostCompact hooks fire |
| Context collapse | `src/services/contextCollapse` (CONTEXT_COLLAPSE gate) — collapses old tool results; `CtxInspect` tool |
| Micro-compaction | session-memory compact (`sessionMemoryCompact.ts`, `UR_CODE_SM_COMPACT`) |
| Clear | `/clear` (aliases `/reset`, `/new`) |
| Read caps | Read tool truncates large files/lines; `/read`, `/analyze`, `/summarize` for deliberate loads |

### Context exhaustion during a response

A provider's `model_context_window_exceeded` stop is a prompt-too-long event,
not an ordinary output chunk boundary. The recovery input includes partial
assistant output already produced in that turn. With automatic compaction
enabled, UR compacts that history and retries; disabled or unsuccessful
compaction surfaces the context failure rather than appending repeated output
continuation prompts.

Output chunk recovery is separate: empty, reasoning-only, or replayed capped
responses can double the response reservation within model, explicit environment,
and remaining-context limits. Useful output has no fixed total continuation
count. Actual request/usage metadata prevents repeated failed increases, and
two unproductive attempts stop the loop once growth is exhausted. See
[provider recovery](05-providers-and-models.md#response-boundary-recovery) for
the budget, replay, and provider-specific reasoning rules.

## Repo wiki & map

```
/wiki generate       # .ur/wiki/: overview, architecture, dependency map (from DNA + code index)
/wiki install-hook   # refresh automatically after every merge
/wiki map            # regenerate .ur/repo-map.md
```
When `.ur/repo-map.md` exists and is fresh (<7 days), a byte-capped repo map is
injected into the system prompt automatically (zero tokens until generated).

## Project DNA & indexes

```
/dna              # detect language, package manager, build/test/lint → .ur/dna
/index            # build workspace file index (.ur/index)
/code-index build # semantic embeddings index — CodeSearch auto-enables once built
/code-index watch # keep it fresh
/code-index search "debounce input"
```
Code search uses current file hashes before returning results. Changed, deleted,
or unreadable indexed files are excluded; diagnostics identify them and suggest
`/code-index build` to refresh. Path filtering happens before top-k selection.
Every hit has a source hash and ranking reasons (text, embedding, symbol,
dependency). Local symbol declarations and resolved relative imports contribute
to ranking and one-hop context. Extraction is dependency-free and heuristic;
it is not a language server's complete semantic call graph.

All eligible files are indexed by default. `build --max-files=N` is an explicit
optional cap; `build --lexical` works without an embedding service. Build/status
and CodeSearch results report candidate/indexed counts, omitted files, unreadable
or oversized files, and chunk truncation. Files larger than 200,000 bytes are
skipped; line-window chunking caps a file at 200 chunks, and affected paths are
reported. Candidate enumeration honors ripgrep's ignore rules when available.
The fallback filesystem walk excludes generated/hidden trees; its ignore
semantics are narrower. Coverage describes eligible candidates at build time;
new files become searchable after build/watch refresh.

The semantic index is atomically upgraded in place from the previous format.
Unchanged compatible vectors are reused; model changes require rebuilding.
Invalid/unavailable embeddings produce explicit lexical fallback. Structural
`code-index graph` and `code-index repo` queries also validate source hashes and
exclude stale source artifacts. Old graph files without provenance require a
rebuild. Repository artifacts from mismatched build generations are rejected.

`test/codeRetrievalFreshness.test.ts` generates 5,201 source files and records
build latency, query latency, full coverage, and exact-symbol recall. This is a
reproducible retrieval regression fixture, not a real-model engineering benchmark.
`test/memoryRetrieval.test.ts` covers body-only and multilingual retrieval,
controlled embedding paraphrases, unrelated queries, source changes/deletions,
expiry, explicit conflicts/supersession, cancellation, and schema migration.

`/project` and `/workspace` display the recorded DNA + workspace facts.

## What gets injected into the system prompt

Per `src/constants/prompts.ts` (assembled in QueryEngine): UR.md + UR.local.md, the
auto-memory `MEMORY.md` index, project DNA summary, active mode/output style, tool list,
and environment info. `--bare` drops memory, hooks and most extras. Verify with the
internal `--dump-system-prompt` flag (ant builds).
