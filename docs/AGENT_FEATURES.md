# Agent Feature Expansion

This page tracks the agent-platform additions that were prioritized after
comparing UR with current Codex, Claude Code, Copilot, and Jules-style agent
workflows.

UR's intended advantage is not being another generic coding agent. It is a
reproducible autonomous software engineering agent: every substantial task can
be driven as `spec -> plan -> patch -> test -> report -> rollback`, with the
spec as the durable source of truth and command evidence as the success gate.

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
ur test-first detect
ur test-first --dry-run
ur test-first install
ur safety status
ur safety init
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack compress
ur acp serve --port 8123
ur acp status --json
ur exec "add tests for the parser" --concurrency 4 --json
ur repo-edit index
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
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
ur --discover-ollama
ur --ollama-host http://192.168.1.50:11434
ur worktree list
ur worktree clean --dry-run
ur eval run starter --metrics --json
ur eval report starter --dashboard
ur eval dashboard
ur spec init auth-refactor --goal "refactor login without changing behavior"
ur spec run auth-refactor --all
ur spec verify auth-refactor
```

## v1.24.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Plugin marketplace capability surfaces | `.ur-plugin/marketplace.json`, `src/utils/plugins/schemas.ts`, `marketplace-plugins/engineering-discipline/` | Marketplace entries can advertise MCP tools, executable skills, templates, validators, language adapters, LSP servers, hooks, agents, and commands. The `engineering-discipline` reference plugin ships a command, reproducible-release skill, release-verifier template, release-gate validator, and Markdown adapter metadata. |
| Autonomous engineering workflow identity | `README.md`, `documentation/`, `marketplace-plugins/engineering-discipline/skills/reproducible-release` | Positions UR as an autonomous engineering workflow engine: plan, execute, test, verify, document, benchmark, and reproduce, with command evidence and rollback discipline as the product promise. |
| Release readiness guard | `.github/workflows/test.yml`, `test/releaseReadiness.test.ts` | Asserts production bundle, release, package, and global-install checks run only after the Bun test step succeeds in GitHub CI. |

## v1.22.3 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| AST-aware editing | `ur repo-edit rename\|move\|organize-imports\|unused\|callers`, `src/services/repoEditing/ast/*` | Uses the TypeScript compiler API, LSP, and Tree-sitter fallback engines instead of blind text replacement. Supports symbol rename, function/class move, import updates, unused-code detection, caller mapping, patch preview, diagnostics before/after edits, and rollback on new diagnostics or failed checks. |
| Built-in LSP servers | `LSPTool`, `src/services/lsp/config.ts` | Auto-discovers installed `typescript-language-server`, `pyright-langserver`, `rust-analyzer`, and `gopls` after workspace trust. LSP-backed editing and code intelligence can use TypeScript, Python, Rust, and Go servers without requiring a plugin. |
| Executable skill directories | `ur skill list\|show\|run\|init`, `src/skills/skillSpec.ts` | A `.ur/skills/<name>/` directory with `skill.yaml` compiles into a `WorkflowSpec`. Supports `instructions.md`, `scripts/`, `templates/`, and `checklists/`. Step prompts support `$ARGUMENTS`, `$0..$N`, and `$ARGUMENTS[N]`. |
| Semantic repo index | `ur code-index repo build\|status\|search\|symbols\|callers\|tests\|docs\|configs`, `src/utils/codeIndex/repoIndex.ts` | Offline, dependency-free indexes under `.ur/code-index/`: `repo.json`, `symbols.json`, `calls.json`, `tests.json`, `docs.json`, `configs.json`. Classifies files, extracts symbols, records intra-file calls, maps tests, and indexes doc refs and config keys. |

## v1.22.2 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Lifecycle hooks | `.ur/hooks.json`, `UR.md` frontmatter, `src/utils/hooks.ts` | New hook events `BeforeEdit`, `AfterEdit`, `BeforeCommand`, `AfterCommand`, `BeforeCommit`, and `OnFailure`. Fire around file edits, shell commands, git commits, and failures. Advisory by default; can block actions or write project memory. |
| Persistent project memory | `ur context-pack remember`, `src/services/context/projectContextManifest.ts` | New memory kinds `architecture`, `preference`, `attempt`, `accepted`, and `rejected` with status, rationale, scope, and source metadata. Stored in `.ur/context/task-memory.jsonl` and surfaced in the compressed context summary. |

## v1.22.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Eval execution metrics | `ur eval run <suite> --metrics`, `UR_EVAL_METRICS_FILE` | Child-serialized cost, tokens, model, duration, files changed, insertions/deletions, command failures, human-edit heuristics, and per-case `testCommand` pass/fail. Safe for parallel runs because each child writes its own metrics file. |
| Richer eval dashboard | `ur eval dashboard`, `ur eval report <suite> --dashboard` | Local-first HTML dashboard with summary cards and a per-case timeline showing model, time, cost, tokens, diffs, test result, command failures, and human edits. |
| Per-case run metrics persistence | `.ur/evals/.runs/<suite>/<case>.json` | `ur eval run <suite> --metrics` writes each case's metrics to a JSON file for downstream analysis. |
| Spec verification / verifier kernel role | `ur spec verify <name>`, `src/services/agents/specVerifier.ts` | Deterministic project gates first, then a read-only deep verification subagent that must prove compile/test/lint/diff/runtime before PASS. Writes `.ur/specs/<name>/verification.md` and a `verification` record in `spec.json`. First concrete kernel role: verifier is stricter than the generator. |
| AgentKernel abstraction | `ur spec run|verify <name> --kernel`, `src/services/agents/kernel.ts` | Pure orchestrator separating planner, executor, verifier, critic, memory, router, and guard. Routes spec run/verify through kernel stages while keeping the legacy loop as default. Foundation for applying the same orchestration to workflows, crew, and CI loop. |
| Rich task decomposition | `ur crew create|run|plan ... --decompose`, `src/services/agents/decomposer.ts` | Splits large goals into atomic subtasks with goal, files touched, risk level (low/medium/high), tests required, and rollback point. Deterministic fallback + optional LLM-driven JSON decomposition. |
| Parallel specialized subagents | `ur pattern parallel "<task>" --execute`, `src/services/agents/patterns.ts` | Bug finder, patch writer, test writer, security auditor, and style reviewer run in parallel via the workflow executor, then a synthesizer merges results into one plan. |

The spec-first path is the default reliability story: `ur spec init` turns a
request into requirements/design/tasks, `ur spec run --all` applies atomic
tasks, and `ur spec verify` requires compile proof, test proof, lint proof,
diff proof, and runtime proof. The AgentKernel keeps planner, executor,
verifier, critic, memory manager, tool router, and permission guard as separate
components instead of one giant prompt.

## v1.21.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Agent skill runner | `src/services/agents/agentSkillRunner.ts` | Reusable wrapper around `startBackgroundTask({ worktree: true, pr: true })` that polls to completion and returns a PR-style summary. |
| Worktree slash skills | `/debug-v2`, `/refactor`, `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, `/latex-paper` | Bundled slash skills that expand into prompts for isolated worktree work with clean commits and PR output. |
| Agent templates | `ur agent-templates install` | Adds `debug-v2`, `refactor`, `paper-implementation`, `benchmark`, `security-review`, `dockerize`, and `latex-paper` reusable agent templates under `.ur/agents/`. |
| Worktree command | `ur worktree list\|status\|clean` | Inspect and clean up UR agent worktrees created by `ur bg` or slash skills. |

## v1.20.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| ACP server for IDE extensions | `ur acp serve\|stop\|status` | HTTP+JSON-RPC Agent Communication Protocol server that exposes tool listing, tool calls, task submission, and status for VS Code/Cursor/Zed-like editors. |
| Non-interactive pool execution | `ur exec [prompts...]` | Run one or more prompts headlessly with optional concurrency, worktrees, output capture, and dry-run. |
| GitHub tool | `GitHub` | PR/issue/repo operations via the `gh` CLI. |
| API tool | `Api` | REST HTTP calls with JSON/text output. |
| Browser tool | `Browser` | Headless browser automation (fetch/goto/click/type/evaluate/screenshot); interactive actions require `UR_BROWSER_TOOL=1`. |
| Docker tool | `Docker` | Container and compose operations via the `docker` CLI. |
| Test-runner tool | `TestRunner` | Auto-detect and run project tests. |
| Database tool | `Database` | SQL queries against SQLite, Postgres, MySQL, and DuckDB. |

## Core Agent Primitives

UR documents the same core primitives that Cursor-style agent products expose,
while keeping them project-local and manifest-backed:

| Primitive | UR surface | Project-backed source |
| --- | --- | --- |
| Agent | `ur`, `ur agents`, `ur crew`, `ur bg`, `ur agent-templates` | `.ur/agents/`, `AGENTS.md`, `UR.md` |
| Rules | `ur context-pack scan`, `ur safety`, `ur guardrails`, `ur hooks` | `AGENTS.md`, `UR.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.ur/safety-policy.json`, `.ur/guardrails.json`, `.ur/hooks.json` |
| MCP | `ur mcp`, built-in MCP server mode, MCP tools/resources | `.mcp.json`, `.ur/mcp/`, plugin manifests |
| Skills | `/skills`, `/create-skill`, bundled skills, plugin skills | `.ur/skills/`, user skills, plugin skill folders |
| CLI | `ur --help`, `ur -p`, `ur exec`, `ur acp`, workflow subcommands | `package.json` scripts, `.ur/project-manifest.json`, `.ur/verify.json` |
| Models | `ur model`, `ur model-doctor`, model router, Ollama discovery | Ollama endpoint, settings, `OLLAMA_MODEL`, model metadata cache |

## v1.19.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Permission and safety policy | `ur safety status\|init\|check` | Separates read/write/execute/network command permissions, asks before destructive commands, recommends sandboxing for risky operations, and denies common secret-file and secret-like environment exfiltration paths before broad Bash allow rules. |
| Project context pack | `ur context-pack scan\|remember\|compress` | Builds `.ur/project-manifest.json` and `.ur/context/architecture.md` from manifests, instruction files, Project DNA, verify gates, and safety config; stores task decisions, constraints, commands, diffs, and notes; compresses old context into `.ur/context/compressed.md`. |

## v1.18.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Test-first execution loop | `ur test-first [run\|detect\|install]` | Detects the project stack, orders compile/test/lint commands, runs them as command evidence, stores failed command traces under `.ur/test-first/traces/`, invokes a bounded fix agent, and can install the detected commands into `.ur/verify.json` for after-edit gates. |

## v1.17.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Reliable repo editing | `ur repo-edit index\|search\|plan\|preview\|apply` | Dependency-free repo edit index, indexed symbol/content search, AST-aware JavaScript/TypeScript identifier renames, explicit patch preview, transactional multi-file apply, and rollback when syntax validation or an optional check command fails. |

## v1.16.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Network Ollama discovery | `ur --discover-ollama`, `ur --ollama-host <url>`, `settings.ollama` | Scans active local subnets for Ollama servers on port 11434, verifies via `/api/tags`, and shows a host picker for the current session. |

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
| Permission and safety policy | `ur safety status|init|check` | Project-aware shell safety checks for destructive operations, sandbox recommendations, permission classes, and secret exfiltration denial |
| Project context pack | `ur context-pack scan|remember|compress` | Architecture manifest, durable task memory, and compressed context summaries based on manifests and instructions |

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
