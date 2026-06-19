# Agent Feature Expansion

This page tracks the nine agent-platform additions that were prioritized after
comparing UR with current Codex, Claude Code, Copilot, and Jules-style agent
workflows.

## Commands

```sh
ur agent-features
ur agent-features init
ur agent-templates list
ur agent-templates install
ur agent-task status
ur agent-task diff
ur agent-task pr
ur agent-task pr --create --dry-run
ur automation list
ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"
ur automation run nightly --dry-run
ur automation run-due
ur model-doctor
ur a2a serve --dry-run
ur bg run "fix the flaky parser test" --worktree --dry-run
ur memory retention show
ur code-index watch --dry-run
ur ide diff capture --title "Working tree review"
ur eval bench list
ur semantic-memory build
ur semantic-memory search "release checks"
ur claim-ledger add --claim "..." --source web:https://example.com
ur claim-ledger validate
ur browser-qa validate
ur browser-qa run home-page-smoke --dry-run
```

## v1.15.0 Additions

Seven additions from the 2026 agent-platform gap list. They keep UR local-first
and route model work through the local Ollama-backed UR runtime.

| Addition | Surface | What it adds |
| --- | --- | --- |
| Managed background agents | `ur bg run|fanout|list|status|logs|attach|kill` | Detached, durable local agent runs with optional worktrees and opt-in PR creation through `gh` |
| Auto compaction and memory retention | `compaction.autoThreshold`, `ur memory retention` | Configurable context compaction threshold plus TTL/max/decay pruning for `.ur/memory/*.jsonl` |
| Code-index auto-reindex | `codeIndex.autoReindex`, `ur code-index watch` | File watcher that rebuilds the local semantic code index after source changes |
| Live artifact steering | `ur artifacts comment <id> --feedback ... --task <bg_id>` | Artifact feedback is queued into the linked background task inbox and injected into active stream-json background agents as `priority: "now"` turns |
| Full opt-in A2A task server | `ur a2a serve`, `/a2a/tasks` lifecycle routes | Token/delegation-protected task submission, status, output, and cancel routes backed by local background tasks |
| IDE inline diff bundles | `ur ide diff capture|list|show|comment|schema`, `extensions/vscode-ur-inline-diffs/` | Editor-readable `.ur/ide/diffs/` manifest, metadata, patch files, comments, plus a native VS Code tree/webview review extension |
| Benchmark adapters | `ur eval bench swe-bench|terminal-bench|aider-polyglot` | Imports local benchmark JSON/JSONL exports into UR eval suites without external downloads |

## Nine Points

| Point | UR surface | What it adds |
| --- | --- | --- |
| Task-to-PR workflow | `ur agent-task status|diff|pr --create` | Summarizes task state, git changes, branch, and can create a GitHub PR through `gh` |
| Recurring automations | `ur automation` and `.ur/automations/` | Project-local automation specs with validation, next-run calculation, manual run, due-run, dry-run, and last-run state |
| Model capability report | `ur model-doctor` | Local Ollama model inventory with context length, advertised capabilities, and likely vision/code readiness |
| Reusable agent templates | `ur agent-templates install` | Project agents for review, tests, browser QA, docs research, security, release notes, PR fixes, and memory curation |
| GitHub agent runner | `.github/workflows/ur-agent.yml` scaffold | Opt-in CI entry point for manual prompts or `/ur` issue comments |
| A2A adapter handoff | `ur a2a serve` | Loopback Agent Card and token-gated task execution endpoint |
| Semantic memory index | `ur semantic-memory build|search` | Local memory index over durable memory, docs, README, and UR instructions |
| Claim provenance ledger | `ur claim-ledger add|list|validate` | Maps generated claims to web, file, MCP, tool, or user sources |
| Browser replay evals | `ur browser-qa list|validate|run` | Validates replay fixtures and performs lightweight target smoke checks |

## Design Notes

These additions keep network-facing behavior opt-in, but the local task, PR,
automation, model, and template surfaces are executable commands. UR already has
tasks, custom agents, memory files, browser workflows, evidence commands, A2A
Agent Card export, and local Ollama routing; these surfaces make those
capabilities easier to discover and reuse.

Network-facing behavior, such as a full A2A task server or a GitHub bot that can
push code, should remain explicitly opt-in because it changes the trust and
permission boundary.

## v1.13 Additions

Five additions from a fresh comparison with current Claude Code, Cursor, Codex,
Cline/Roo, and Copilot workflows.

| Addition | Surface | What it adds |
| --- | --- | --- |
| AGENTS.md runtime context | automatic | Loads `AGENTS.md` from project roots as project memory (before `UR.md`), for drop-in compatibility with the cross-tool standard |
| Semantic code index | `ur code-index build\|search\|status` + `CodeSearch` tool | Local embedding-based code retrieval (Ollama embeddings, incremental). The opt-in `CodeSearch` tool (`UR_CODE_INDEX=1`) finds code by meaning alongside Grep/Glob |
| OS-level execution sandbox | `sandbox.enabled` setting + `/sandbox` | Real enforcement on macOS (Seatbelt) and Linux/WSL (bubblewrap): writes confined to the workspace, optional network block (`UR_SANDBOX_BLOCK_NETWORK`) |
| Self-review PR gate | `ur agent-task pr --create` | Deterministic diff review that blocks PR creation on merge-conflict markers, hardcoded secrets, and focused tests (override `--force`, skip `--no-review`) |
| Named role modes | `ur role-mode list\|show\|install` | Architect / Code / Debug / Ask roles with scoped toolsets, installed as `.ur/agents/*.md` so they work with the existing Agent tool |

### Design notes

- The code index and sandbox are local-first and opt-in. The index uses the
  same local Ollama endpoint UR already uses; the sandbox enforces only when
  the user sets `sandbox.enabled`.
- Role modes reuse the agent system rather than inventing a parallel runtime
  concept — installing a mode just writes a scoped agent definition.
- The self-review gate is heuristic and deterministic; it is the automatic
  safety net on the PR path, not a replacement for the model-driven review.

## v1.13.9 Additions

Five additions from a comparison with current Kiro/Spec Kit, Amp, Cursor,
Jules, and Antigravity workflows. All keep model and exec behind injectable
runners, so the core logic is deterministic and unit-tested offline.

| Addition | Surface | What it adds |
| --- | --- | --- |
| Spec-driven development | `ur spec init\|generate\|approve\|run\|status` + `.ur/specs/` | requirements -> design -> tasks documents and a phase/approval record; executes the Spec Kit / Kiro `- [ ] T1: ...` task list one task at a time, checking off each PASS |
| In-loop model escalation | `ur escalate plan\|run\|oracle\|policy` + `.ur/escalation.json` | capability-aware fast/oracle tiers from `model-doctor`; routine work runs fast and auto-escalates hard/failed work to the strong model; `oracle` is a one-shot second opinion |
| Best-of-N judging | `ur arena "<task>" [--agents N] [--apply]` | runs N agents on one task in isolated worktrees, scores diffs with the self-review gate + verdict/diff heuristics, surfaces (optionally applies) the winner |
| Self-healing CI loop | `ur ci-loop [--command ...] [--commit] [--push]` | run -> on failure summarize -> fix agent -> re-run, bounded by retries; commits/pushes are self-review gated; `--from-log` seeds the first failure |
| Verifiable artifacts | `ur artifacts add\|capture-diff\|capture-tests\|approve\|reject` + `.ur/artifacts/` | reviewable deliverables with pending/approved/rejected status and threaded feedback; threads into the provenance stack (`claim-ledger`, `trace`, `evidence`) |

### Commands

```sh
ur spec init checkout --goal "1. add cart 2. add payment 3. add receipt"
ur spec approve checkout requirements
ur spec run checkout --all
ur escalate plan "debug the race condition in the scheduler"
ur escalate run "refactor the cache layer" --force-oracle
ur escalate oracle "is this lock-free queue correct?"
ur arena "implement the rate limiter" --agents 3 --apply
ur ci-loop --command "bun test" --max-attempts 3
ur artifacts capture-diff
ur artifacts capture-tests --command "bun test"
ur artifacts approve 1
```
