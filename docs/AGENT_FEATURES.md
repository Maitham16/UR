# Agent Feature Expansion

This page tracks the agent-platform additions that were prioritized after
comparing UR with current Codex, Claude Code, Copilot, and Jules-style agent
workflows.

UR's intended advantage is not being another generic coding agent. It is a
reproducible autonomous software engineering agent: every substantial task can
be driven as `spec -> plan -> patch -> test -> report -> rollback`, with the
spec as the durable source of truth and command evidence as the success gate.

## v1.80.10 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Deterministic read-only agent registry | Public bundle, development runtime, `Agent` gate | Ships the protected `Explore` and `Plan` definitions in every public runtime so task-free research always has a real read-only destination. Tests now exercise the real registry and verify the release feature flag. |

## v1.80.9 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Research-only intent recovery | Shared Agent execution gate | Handles providers that retain a pure research/report brief but omit the caller's “read-only” wording. The call is reduced to shipped Explore capabilities; any implementation or mutation directive remains task-gated. |

## v1.80.8 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Provider-independent research routing | Shared Agent prompt and execution gate | Directs every model family to use the shipped `Explore` worker for task-free read-only research. If a model still labels an explicitly read-only research brief `general-purpose`, UR reduces it to protected Explore capabilities before task gating; write-capable and custom delegation remains gated. |

## v1.80.7 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Recoverable local-model tool mismatch | Ollama native/text calls, streaming/non-streaming execution | Converts a valid call to a tool absent from the active profile into a safe `UnavailableTool` result instead of aborting the provider turn. Identical retries are bounded and omitted tools cannot be revived through legacy aliases. |
| Task-free read-only research | `Agent`, strict-hybrid task gate | Lets the main session launch the exact shipped `Explore` and `Plan` definitions before tasks exist in every parent permission mode, while forcing those children into plan permissions and keeping all custom or write-capable delegation gated. |

## v1.80.6 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Read-only planning delegation | Plan mode, `Agent`, strict-hybrid task gate | Lets the shipped `Explore` and `Plan` agents research before implementation tasks exist, eliminating failed-first delegation while retaining plan permissions and task requirements for every custom, write-capable, nested, team, or worktree agent. |

## v1.80.5 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Plan-to-task synchronization | `Write`/`Edit` plan artifact, `ExitPlanMode`, canonical `TaskCreate` lifecycle | Removes the circular task-gate failure while keeping project mutations protected. Approval preserves an existing actionable board or creates bounded, deduplicated implementation tasks and a dependent verification task before coding begins. |

## v1.80.4 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Permanent-link circuit breaker | `WebFetch` | Stops repeat and alternating loops over dead 4xx URLs without disabling legitimate retries for transient network or server failures. URL identities are prompt-independent, hashed, bounded, and query-scoped. |
| Plan/task recovery | `EnterPlanMode`, `TaskCreate` gate | Makes the distinction between an implementation plan and visible executable tasks explicit before workspace mutation. |
| Safe CLI parity | `ur config set|get|list`, `ur a2a card --v1`, `ur session status` | Makes accessibility/editor configuration, current Agent Card preview, and conversation inspection available to scripts without weakening compatibility defaults. |
| Complete command display hardening | Background shell details | Escapes deceptive control, invisible, and bidirectional characters before truncation. |

## v1.80.3 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Strict-hybrid task planning | Interactive `TaskCreate` lifecycle, `tasks.requireBeforeChanges` | Keeps atomic low-risk work direct, but requires a visible actionable task before mutation for multi-outcome, sequenced, planned, delegated, project-sized, and high-risk lifecycle work. Reads stay open, custom profiles without `TaskCreate` cannot deadlock, and operators retain advisory and fully strict modes. |

## v1.80.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Credential-safe sandbox | `sandbox.credentials`, `sandbox.network.strictAllowlist`, `sandbox.network.tlsTerminate` | Masked file/environment credentials, JWT claims, AWS/SigV4 handling, strict unattended egress, trusted-source-only policy, and trailing-slash deny regression coverage. |
| Permission parser hardening | `Tool(parameter:value)`, Bash/PowerShell checks | Parameter-aware wildcard rules, zsh conditional command detection, visible hidden characters, and quoted PowerShell path validation. |
| Accessible terminal | `--screen-reader`, `/config screenReader=true` | Append-only plain output, edit announcements, and reduced animation. |
| Current agent protocols | `ur mcp serve-web`, roots notifications, `input_required` | Final tool-input continuation results, compatibility roots, added-directory notifications, Tasks, and Apps under one professionally named web surface. |
| Bounded observable delegation | `--forward-subagent-text`, session budgets, OpenTelemetry | Nested-agent text correlation, WebSearch session limits, advisory spawn warnings, assistant response events, and workflow/run correlation. |
| Session and input ergonomics | `/session`, `ur session`, `/config key=value`, `DirectoryAdded`, `vimEscape` | Explicit archive/restore, direct settings, directory automation, and Vim insert escape sequences. |
| Command cleanup | `/fix-bug`, command registry integrity | Replaces the versioned debug-skill name, removes no-op command registrations and duplicate 3D aliases, and rejects version jargon in public command descriptions. |

## v1.79.1 Addition

| Addition | Surface | What it adds |
| --- | --- | --- |
| Self-healing Bash task output | `src/utils/Shell.ts`, `src/utils/permissions/filesystem.ts`, `test/shellExecutionIntegration.test.ts` | Uses the platform temp directory instead of assuming `/tmp`, aligns sandbox and permission roots, re-ensures temporary output storage for every launch, and atomically retries stdout/stderr creation after external directory cleanup so Bash recovers without restarting UR. |

## v1.79.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Cross-catalog plugin discovery | `ur plugin search\|show`, `src/utils/plugins/pluginDiscovery.ts` | Deterministic ranked discovery across managed, personal, workspace, implicit, built-in, session, and installed catalogs with source/scope provenance, capability/status filters, secret redaction, graceful catalog degradation, and JSON output. |
| Evidence-backed deep research | `ur research init\|source\|finding\|question\|verify\|report`, `/research-pro`, `.ur/research/projects/` | Atomic source-backed projects, sanitized URLs, cited/contested/open findings, independent-publisher checks for high confidence, durable open questions, SHA-256 state digests, workspace-confined Markdown reports, and a primary-source research workflow. |
| Compiler/graph change impact | `ur repo-edit impact`, `src/services/repoEditing/changeImpact.ts` | Combines compiler-resolved callers, import-graph dependents, definitions, focused tests, related docs/config, risk reasons, and detected package verification commands before editing. Imported aliases resolve correctly and read-only AST results retain exact references. |
| Professional 3D and DCC/CAD automation | `ur design3d`, `/dcc-design`, `src/services/design3d/design3d.ts` | Parametric Blender Python, OpenSCAD, and 3ds Max MAXScript scaffolds; discovery for Maya, FreeCAD, Houdini, Cinema 4D, Rhino, and Khronos validation; shell-free reviewed custom adapters; bounded build execution; workspace confinement; and GLB/glTF/STL/OBJ/BLEND/MAX inspection. |

## v1.49.0 Additions

- Signed A2A Agent Cards. An Agent Card is discovery metadata served over plain
  HTTP, so a client cannot otherwise distinguish a genuine card from one
  rewritten in transit — the endpoints, skills, and auth schemes it advertises
  are all taken on trust. UR can now sign the v1 card with an Ed25519 key,
  producing an RFC 7515 detached JWS over the card's RFC 8785 canonical form,
  which a client verifies before trusting anything the card claims. Multiple
  keys can sign one card independently, and verification refuses a
  caller-supplied `alg` so a signature cannot be stripped by substituting
  `none`. Signing is opt-in: without a provisioned key the card is served
  unsigned and unchanged.

## v1.48.0 Additions

- `ur cloud --runner managed` persists remote environment/session lifecycle,
  cursor reconciliation, bounded output, explicit remote branches, cancellation,
  and idempotent steering. Only PASS results with safe review branches are
  eligible; all eligible results receive deterministic ranks rather than an
  unverified comparative-quality score. Cancellation wins over a concurrent
  session start. The authenticated A2A compatibility task API exposes the same
  owner-isolated steering boundary for mobile clients.
- `ur learn playbooks` mines repeated proof-backed run shapes behind a Wilson
  confidence floor, rejects unsafe/secret-like traces, and requires explicit
  approval before materializing a normal validated workflow. Disabling verifies
  that workflow and moves it to the private disabled archive.
- Project task memory accepts content-digested file and run citations plus
  explicit user/web citations. Resolution revalidates freshness and excludes
  rejected, superseded, stale, or missing evidence by default.
- `ur agent-ci` runs untrusted event tasks in detached worktrees with actor
  policy, read-only GitHub permissions, scrubbed code subprocesses, bounded
  redacted output, exact NUL-delimited path policy, pre/post verification-state
  binding, and a post-check hash-addressed patch for a separate publish decision.
- Eval cases capture redacted control-flow trajectories and grade tool choice,
  order, success, repetition, failures, permission denials, and turns. `ur eval
  gate` makes those scores and outcome/cost/duration regressions enforceable.
- `ur desktop-qa` drives bounded Electron fixtures and attaches teardown-safe,
  masked screenshots, hashes, diagnostics, and reports to the artifact review
  surface. Raw video/trace evidence is available only without selector
  redaction; incompatible fixtures fail validation. Attachment sources reject
  symlinks and unsafe MIME types download as sandboxed octet streams.
- `/btw` is now a durable, private, hash-chained side chat with
  create/continue/list/show/rename/close lifecycle and cancellation, while every
  fork remains one-turn and tool-free.
- `ur workspace` enrolls canonical repository identities, validates a
  dependency DAG, serializes writers per repository, uses isolated worktrees,
  resumes private state, runs repository gates, and emits PR/rollback plans
  without executing them.
- `ur arena` now has deterministic, model, and hybrid judges. Only
  proof-backed, verification-passing, safety-eligible candidates reach the
  strict anonymous judge schema; oversized full diffs are excluded rather than
  partially judged, and apply requires the original clean base.
- Background, managed-cloud, A2A/mobile, artifacts, evals, and the standard CLI
  share bounded/idempotent control, nonzero CI failure semantics, private state,
  and reviewable evidence.

See [Frontier Agent Workflows](FRONTIER_AGENT_FEATURES.md) for commands and
trust boundaries.

## v1.47.0 Additions

- `ur ag-ui serve` adds a secure AG-UI HTTP/SSE boundary for user-facing
  applications. Official schemas and encoding, truthful capability discovery,
  full text/tool/state lifecycle events, cancellation, exact CORS, bearer
  protection, redacted errors, and independent resource bounds are covered by
  provider-free regression tests.
- A2A now runs v0.3 and v1 side by side. Strict v1 JSON-RPC and HTTP+JSON
  bindings add version negotiation, tenant isolation, durable tasks and
  artifacts, pagination, continuation, references, and cancellation without
  removing the stable v0.3 SDK path.
- ACP stdio now implements durable list/load/delete/resume/close, bounded exact
  history replay, modes, configuration options, and available commands in
  addition to streaming prompts, permission requests, MCP servers, and roots.
- `ur mcp serve-web` exposes the opt-in stateless Model Context Protocol
  surface with Tasks and a self-contained Apps resource. It is loopback-only
  without authentication and enforces request metadata, capability negotiation,
  owner isolation, limits, private persistence, and corrupt-state quarantine.
- OpenAI users can opt into the Responses transport with
  `ur config set openai_transport responses`. Chat Completions remains the
  default; Responses defaults to `store=false` and supports streaming,
  background polling/cancellation, WebSocket continuation, compaction, and
  deferred tool search through tested provider adapters.
- OpenTelemetry export is explicit per signal. GenAI inference, agent,
  workflow, tool, memory, duration, token, cache, response,
  time-to-first-chunk, inter-output-chunk latency, and error fields follow
  current semantic conventions, while prompts and tool/memory content stay
  redacted unless the operator
  separately opts in.
- Agent Skills receive strict open-spec validation and deterministic provenance.
  `ur skill verify|sign|keygen` supports Ed25519 integrity manifests and trusted
  keys; loaded skills are re-hashed immediately before execution. Native
  `.ur/skills/` and standard cross-client `.agents/skills/` project/user roots
  use explicit, deterministic precedence.
- Project task memory now has per-entry provenance, UUIDs, SHA-256 content
  digests, an append-only hash chain, cross-process locks, private atomic writes,
  and `ur context-pack memory verify|quarantine|rollback` recovery commands.

## v1.46.0 Additions

- Native ACP v1 stdio support now uses the official SDK and includes durable
  sessions, resume/close, MCP server configuration, additional roots,
  permission requests, cancellation, and streaming updates. The separate HTTP
  automation API is documented as UR JSON-RPC rather than mislabelled ACP.
- A2A interoperability now uses the official stable JavaScript SDK for the
  advertised v0.3 JSON-RPC binding, with authenticated discovery, scoped
  delegation, durable tasks, cancellation, and bounded request execution.
- The VS Code Actions view can safely start, inspect, and cancel background
  tasks, including isolated worktree execution. The JetBrains client now
  propagates cancellation, rejects overlapping prompts, and closes sessions.
- Background-task state uses locked, atomic, private manifest writes with
  corruption detection, structural limits, and symlink-safe artifact paths.
- Provider protocol handling, MCP validation, CI supply-chain controls, release
  version checks, and secret-input paths received additional compatibility and
  security coverage.

## v1.45.6 Additions

- Project verification approval is deduplicated per user turn. The agent asks
  once before the final compile/test/lint commands, then respects that decision
  without presenting the same gate again.

## v1.45.5 Additions

- Ollama Cloud requests have bounded response-header and streaming phases and
  do not amplify a deliberate stream timeout through fallback retries. Local
  model timing and explicit timeout overrides are unchanged.
- The verifier now recognizes terminal promises such as "Let me create it
  now" or "I will run the tests now" and requires the corresponding successful
  mutation or Bash call before the turn may complete.

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
ur ag-ui serve --help
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
ur provider list
ur provider status
ur provider doctor
ur auth chatgpt
ur auth claude
ur auth gemini
ur auth antigravity
ur config set provider ollama
ur config set provider openai-compatible
ur config set model qwen2.5-coder:7b
ur config set base_url http://localhost:11434/v1
ur config set provider.fallback ollama
ur upgrade
```

The optional `provider.fallback` value is used only to print an explicit
recovery recommendation in provider diagnostics. It never silently or
automatically changes the active provider.

## v1.45.4 Additions

- Fresh workspaces require a provider/model choice before their first
  interactive session and persist the validated pair locally.
- Fresh headless workspaces fail before model execution unless a model is
  supplied explicitly or by workspace/managed configuration.
- Resume, initialization-only, and explicit model paths remain uninterrupted;
  AutoApprove behavior is unchanged.

## v1.45.3 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Deterministic slash registry | `src/commands.ts`, `test/commandRegistryIntegrity.test.ts` | Resolves bundled, plugin, project, workflow, and built-in commands by explicit source priority; rejects duplicate canonical tokens, removes only conflicting aliases, validates every lazy loader, and keeps the technical command catalog complete. |
| Unified sandbox command | `/sandbox [status\|check\|init\|eval\|exclude]` | One interactive slash command now owns both the settings UI and text subcommands; the shell-facing `ur sandbox` implementation is shared rather than separately registered. |
| Actionable CI cwd handling | `ur ci-loop --cwd <path>` | Reports the absolute execution directory, retains assertion and stack context, and stops "No tests found" after one attempt without wasting a fix-agent run. |
| Explicit worktree completion | `/fix-bug`, `/refactor`, `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, `/latex-paper`, `/batch` | Keeps changes local, asks before the final full suite, and never commits, pushes, or opens a PR unless separately requested. |

## v1.25.x Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Legal multi-provider connectivity | `ur provider list\|status\|doctor`, `ur config set provider ...`, bridge diagnostics only when explicitly enabled | API-key providers and local/OpenAI-compatible runtimes are UR-native. Subscription access is visible but unavailable unless a real independent backend exists; UR does not expose fake subscription models. External app bridges are blocked from normal runtime unless explicitly enabled. UR stores only safe non-secret preferences and never scrapes browser sessions, extracts OAuth tokens, reads hidden provider auth files, bypasses provider restrictions, or proxies consumer web sessions as APIs. |
| Provider-aware status bar | Interactive bottom status bar, `src/components/StatusLine.tsx`, `src/utils/statusBar.ts` | Shows only important runtime state: active provider, selected model, mode, git branch, active task state, checks/build state when known, and update availability. Hidden in CI, dumb terminals, and non-interactive mode; custom status-line hooks still override it. |
| Clean update checks | `ur upgrade`, `ur update`, `src/cli/update.ts` | Detects development/source checkouts and prints a short pull-or-install message instead of attempting self-mutation. npm-installed builds compare the local version with `ur-agent` on npm and print update, latest, registry failure, and malformed-response states without stale planning text. |
| Bundled IDE extension install | `extensions/vscode-ur-inline-diffs/`, `src/utils/ide.ts`, `ur ide diff` | Public VS Code install now packages the repo's bundled inline-diffs extension as a local VSIX instead of trying an unpublished marketplace ID. The extension remains local-only and reviews `.ur/ide/diffs` bundles from the current workspace. |
| Professional clarification dialogs | `AskUserQuestion`, `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` | Supports up to eight concrete options, infers labels from description-only option objects, accepts prompt aliases, deduplicates equivalent labels, safely repairs single-suggestion payloads with a neutral rejection choice, and is loaded without ToolSearch preloading so typed schemas are available before use. |
| Documentation release sync | `README.md`, `docs/`, `documentation/`, `CHANGELOG.md` | Keeps the npm README, static documentation site, provider guide, usage guide, feature ledger, validation runbook, and release notes aligned with current release behavior. |

## v1.24.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| Plugin marketplace capability surfaces | `.ur-plugin/marketplace.json`, `src/utils/plugins/schemas.ts`, `src/utils/plugins/pluginDiscovery.ts`, `plugins/core/engineering-discipline/` | Marketplace entries can advertise MCP tools, executable skills, templates, validators, language adapters, LSP servers, hooks, agents, and commands. `ur plugin search/show` adds deterministic cross-catalog discovery, scope/source provenance, installed/enabled state, capability filters, JSON output, and graceful per-catalog failure reporting. The `engineering-discipline` reference plugin demonstrates the extension contract. |
| Autonomous engineering workflow identity | `README.md`, `documentation/`, `plugins/core/engineering-discipline/skills/reproducible-release` | Positions UR as an autonomous engineering workflow engine: plan, execute, test, verify, document, benchmark, and reproduce, with command evidence and rollback discipline as the product promise. |
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
| Dependency-aware crew recovery | `ur crew run ... --workers N --worktrees --max-attempts N` | Runs independent tasks concurrently, blocks failed or cyclic dependency chains, and retries crashed workers only within finite limits and fresh isolated worktrees. |
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
| Agent skill runner | `src/services/agents/agentSkillRunner.ts` | Reusable isolated-worktree wrapper that polls to completion; PR creation is available only with explicit `createPr: true`. |
| Worktree slash skills | `/fix-bug`, `/refactor`, `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, `/latex-paper`, `/batch` | Bundled slash skills keep changes local, run focused checks, ask before the final full suite, and never publish automatically. |
| Agent templates | `ur agent-templates install` | Adds `bug-fixer`, `refactor`, `paper-implementation`, `benchmark`, `security-review`, `dockerize`, and `latex-paper` reusable agent templates under `.ur/agents/`. |
| Worktree command | `ur worktree list\|status\|clean` | Inspect and clean up UR agent worktrees created by `ur bg` or slash skills. |

## v1.20.0 Additions

| Addition | Surface | What it adds |
| --- | --- | --- |
| ACP and IDE transports | `ur acp stdio`; `ur acp serve\|stop\|status` | Official-SDK ACP v1 stdio agent for native ACP editors, plus a distinct UR HTTP JSON-RPC API for tools, tasks, scripts, and the experimental JetBrains plugin. |
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
| Rules | `ur context-pack scan`, `ur safety`, `/guardrails`, `/hooks` | `AGENTS.md`, `UR.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.ur/safety-policy.json`, `.ur/guardrails.json`, `.ur/hooks.json` |
| Model Context Protocol | `ur mcp`, standard-input mode, opt-in web Tasks/Apps, tools/resources | `.mcp.json`, `.ur/mcp/`, plugin manifests |
| Skills | `/skills`, `/create-skill`, `ur skill verify\|sign\|keygen`, bundled/plugin skills | `.ur/skills/`, `.agents/skills/`, user skills, plugin skill folders, trusted key store |
| CLI | `ur --help`, `ur -p`, `ur exec`, `ur acp`, workflow subcommands | `package.json` scripts, `.ur/project-manifest.json`, `.ur/verify.json` |
| Models | `/model`, `ur model-doctor`, model router, Ollama discovery | Ollama endpoint, settings, `OLLAMA_MODEL`, model metadata cache |

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
| Opt-in A2A + compatibility server | `ur a2a serve`, `/a2a/jsonrpc`, `/a2a/v1/*`, `/a2a/tasks` | Negotiated v1 JSON-RPC/HTTP+JSON and stable-SDK v0.3, plus clearly separate protected UR background-task compatibility routes |
| IDE inline diff bundles | `ur ide diff capture|list|show|comment|schema`, `extensions/vscode-ur-inline-diffs/` | Editor-readable `.ur/ide/diffs/` manifest, metadata, patch files, comments, plus a native VS Code tree/webview review extension |
| Benchmark adapters | `ur eval bench swe-bench|terminal-bench|aider-polyglot` | Imports local benchmark JSON/JSONL exports into UR eval suites without external downloads |

## Nine Points

| Point | UR surface | What it adds |
| --- | --- | --- |
| Task-to-PR workflow | `ur agent-task status|diff|pr --create` | Summarizes task state, git changes, branch, and can create a GitHub PR through `gh` |
| Recurring automations | `ur automation` and `.ur/automations/` | Project-local automation specs with validation, next-run calculation, manual run, due-run, dry-run, and last-run state |
| Model capability report | `ur model-doctor` | Local Ollama model inventory with context length, advertised capabilities, and likely vision/code readiness |
| Reusable agent templates | `ur agent-templates install` | Project agents for review, tests, browser QA, docs research, security, release notes, PR fixes, and memory curation |
| GitHub agent runner | `.github/workflows/ur.yml` scaffold | Opt-in CI entry point for manual prompts or `/ur` issue comments |
| A2A interoperability | `ur a2a serve` | Version-negotiated strict v1 JSON-RPC/HTTP+JSON plus stable-SDK v0.3, durable tenant-isolated protocol state, and a separate UR compatibility API |
| Semantic memory index | `ur semantic-memory build|search` | Local memory index over durable memory, docs, README, and UR instructions |
| Claim provenance ledger | `ur claim-ledger add|list|validate` | Maps generated claims to web, file, MCP, tool, or user sources |
| Browser replay evals | `ur browser-qa list|validate|run` | Validates replay fixtures and performs lightweight target smoke checks |
| Permission and safety policy | `ur safety status|init|check` | Project-aware shell safety checks for destructive operations, sandbox recommendations, permission classes, and secret exfiltration denial |
| Project context pack | `ur context-pack scan|remember|memory|compress` | Architecture manifest, provenance/hash-chained task memory with verify/quarantine/rollback, and compressed context summaries |

## Design Notes

These additions keep network-facing behavior opt-in, but the local task, PR,
automation, model, and template surfaces are executable commands. UR already has
tasks, custom agents, memory files, browser workflows, evidence commands, A2A
Agent Card export, and local Ollama routing; these surfaces make those
capabilities easier to discover and reuse.

Network-facing behavior, such as the opt-in A2A server or a GitHub bot that can
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
| Self-healing CI loop | `ur ci-loop [--command ...] [--cwd ...] [--commit] [--push]` | run -> on failure summarize -> fix agent -> re-run, bounded by retries; no-test failures stop immediately with cwd guidance; commits/pushes are self-review gated; `--from-log` seeds the first failure |
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
ur ci-loop --command "bun test" --cwd . --max-attempts 3
ur artifacts capture-diff
ur artifacts capture-tests --command "bun test"
ur artifacts approve 1
```
