# Changelog

## 1.24.0

### Added
- Plugin marketplace capability metadata for MCP tools, executable skills,
  templates, validators, language adapters, LSP servers, hooks, agents, and
  commands.
- Bundled `engineering-discipline` reference plugin with `/discipline-check`,
  `reproducible-release`, release-verifier template, release-gate validator,
  and Markdown language-adapter metadata.
- Release readiness test that keeps production bundle, release, package, and
  global-install GitHub checks behind successful Bun tests.

### Changed
- npm package now includes `plugins/` and documents the
  marketplace surfaces in the npm README.
- UR product positioning is documented as an autonomous engineering workflow
  engine for plan, execute, test, verify, document, benchmark, and reproduce.

## 1.23.3

### Fixed
- `repoIndex` tests failing in CI because `listIndexableFiles` silently returned `[]` when ripgrep (`rg`) was unavailable. Added a Node.js recursive file walker fallback that applies the same extension and skip-segment filters.

## 1.23.2

### Added
- **CI failure diagnostics** in `.github/workflows/test.yml`: environment-info step, verbose test reporter, captured `test-output.log`, and artifact upload on failure so the production test runner exposes which test fails without requiring admin log access.

### Fixed
- 

## 1.23.1

### Added
- **CI agent (`ur ci-loop`)** with agent constitution: hard rules against hiding failures, deleting without approval, editing generated/vendor files, claiming tests passed without execution, and changing public API without warning.
- **Plugin marketplace extensibility** for `templates`, `validators`, and `languageAdapters` alongside existing MCP tools and skills.

### Changed
- UR identity updated to "autonomous engineering workflow engine (plan, execute, test, verify, document, benchmark, reproduce)".

## 1.22.8

### Added
- 

### Changed
- 

### Fixed
- 

## 1.22.7

### Added
- **Benchmark mode (`ur eval`).**
  - `ur eval run <suite> [--model <m>] [--metrics]` runs eval suites with explicit model overrides and per-case metrics files.
  - `ur eval report <suite>` now surfaces rollbacks, test pass rate, files changed, command failures, human edits, cost, time, and tokens.
  - `ur eval compare <suite> <label1> <label2>...` runs the same suite against multiple model/runner labels and prints a comparison matrix.
  - `ur eval route "<task>" [--strategy auto|cheap|strong|default]` recommends a model using the capability router.
- **Public leaderboard and built-in benchmark suites.**
  - `ur eval builtin list` shows six small built-in suites: `bug-fix`, `refactor`, `test-gen`, `docker-repair`, `ts-migrate`, `py-package-repair`.
  - `ur eval builtin <id>` installs a suite under `.ur/evals/`.
  - `ur eval leaderboard [--format html|json|md] [<suite>]` writes a public leaderboard from saved reports.
- **Model routing integration.**
  - Added `RouteStrategy`, `ModelPool`, and `resolveModelForTask` in `src/services/agents/modelRouter.ts` with `src/services/agents/modelPool.ts` config.
  - `makeCliEvalRunner` accepts a per-run `model` override.
  - Background tasks (`startBackgroundTask`) support `routeStrategy` and resolve the model from the local pool before spawning.
  - Bundled skills (`debug-v2`, `security-review`, `refactor`, `benchmark`, `dockerize`) now prompt the agent to use `route: strong/auto` hints.

### Changed
- `ur eval` CLI now accepts `[action] [name] [rest...]` and `--model` / `--strategy` flags to support compare and route subcommands.
- `EvalRunMetrics` gained `rollbacks`; `EvalReport` gained `totalRollbacks`; report and dashboard now display them.
- `startBackgroundTask` and `fanoutBackgroundTasks` are now async so they can resolve model routing from local capabilities.

### Fixed
- Fixed `ur task run <id>` so it starts the queued worktree task created by
  `ur task start` instead of creating a second background task whose prompt is
  the id.
- Added explicit sandbox approval levels for `read-only`, `edit project`,
  `run safe commands`, `run network commands`, and `destructive commands`.
- Made task PR summaries PR-shaped and evidence-safe: they now include a
  labeled summary, changed files, tests run, detected verification commands,
  risks, rollback command, and remaining TODOs without claiming tests ran when
  UR has no recorded evidence.
- Extended CI-loop failure memory so failed commands record attempted fixes and
  eventual resolutions, allowing future similar failures to surface the fix
  history.

### Verified
- Added focused coverage for approval-level mapping, `ur task start` to
  `ur task run`, PR-quality output sections, and CI-loop failure memory.
- Added `test/evalCompare.test.ts` and `test/evalBenchmarkSuites.test.ts` for compare matrices, built-in suites, and leaderboard rendering.
- Updated `test/execCommand.test.ts` for the async `runExecPool` signature.
- Verified source and production bundle release checks for the `1.22.7` build.

## 1.22.6

### Fixed
- Fixed Bash tool runtime execution failing every command with
  `timeoutMs is not defined` by keeping the command hook timeout value in scope
  before lifecycle hooks run.
- Fixed Edit/Update tool runtime execution failing with
  `toolUseContext is not defined` by preserving the full tool context inside
  file edit calls.

### Verified
- Added lifecycle runtime regressions for both `BashTool.call` and
  `FileEditTool.call`.
- Verified source and production bundle release checks for the `1.22.6` build.

## 1.22.3

### Added
- **Executable skill directories.** A `.ur/skills/<name>/` directory containing
  `skill.yaml` is now an executable skill that compiles into a `WorkflowSpec`.
  Supports `instructions.md`, `scripts/`, `templates/`, and `checklists/`.
  `src/skills/skillSpec.ts` parses, validates, and compiles skills; step prompts
  support `$ARGUMENTS`, `$0..$N`, and `$ARGUMENTS[N]` substitution.
- **`ur skill` CLI.** New command surface: `ur skill list`, `ur skill show <name>`,
  `ur skill run <name> [args]`, and `ur skill init <name>`. Registered in
  `src/commands.ts` and `src/main.tsx`.
- **Semantic repo index.** `src/utils/codeIndex/repoIndex.ts` builds offline,
  dependency-free indexes under `.ur/code-index/`: `repo.json` (file
  classification + imports/importedBy), `symbols.json`, `calls.json`,
  `tests.json`, `docs.json`, and `configs.json`. `ur code-index repo` exposes
  `build|status|search|symbols|callers|tests|docs|configs` subcommands.
- **`--repo` flag for code-index build/watch.** `ur code-index build --repo`
  builds both the embedding index and the repo index; `watch --repo` refreshes
  the repo index on file changes.

### Changed
- Reused the existing workflow engine for executable skills and extended the
  existing `ur code-index` surface for the repo index, keeping changes additive.

### Verified
- Added `test/skillSpec.test.ts`, `test/skillCommand.test.ts`, and
  `test/repoIndex.test.ts` covering skill parsing, compilation, CLI scaffolding,
  repo file classification, symbol/call/test/doc/config extraction, and index
  round-trips.

## 1.22.5

### Added
- **Real sandbox core architecture (`ur sandbox`).** New first-class command to inspect sandbox status, run dependency checks, initialize `.ur/safety-policy.json`, and evaluate shell-command approval levels.
- **Worktree-per-task (`ur task`).** New command surface to start, run, list, and hand off agent tasks in isolated git branches/worktrees: `task start <name> [--worktree]`, `task run <id>`, `task pr <id> [--create]`, `task list`, `task status <id>`.
- **PR-quality output formatter (`src/services/agents/prSummary.ts`).** Every task/PR result includes summary, changed files, tests to run, risks, rollback command, and remaining TODOs.
- **Failure memory (`src/services/agents/failureMemory.ts`).** Failed shell commands are recorded in project memory via `BashTool.tsx`, and similar previous failures are surfaced as hints in subsequent errors.

### Changed
- Registered `sandbox` and `task` commands in `src/commands.ts` and `src/main.tsx`.
- Failure path in `src/tools/BashTool/BashTool.tsx` now records failures and prepends historical hints.

### Verified
- `bun run typecheck`, `bun run lint`, `bun run test` (500 pass), `bun run bundle`, and `bun run smoke` all pass.

## 1.22.4

### Added
- **AST-aware `ur repo-edit` (P7).** Added
  `src/services/repoEditing/ast/types.ts`,
  `src/services/repoEditing/ast/workspaceEdit.ts`,
  `src/services/repoEditing/ast/diagnostics.ts`,
  `src/services/repoEditing/ast/typescriptEngine.ts`,
  `src/services/repoEditing/ast/lspEditEngine.ts`,
  `src/services/repoEditing/ast/engineRouter.ts`,
  `src/services/repoEditing/ast/treeSitterEngine.ts`, and
  `src/services/repoEditing/ast/repoEditAst.ts`.
- **`rename`.** Binding-aware rename for TS/JS via `ts.createProgram` + type
  checker; LSP rename via `textDocument/prepareRename` + `textDocument/rename`
  for Python/Rust/Go and TS/JS opt-in; Tree-sitter best-effort identifier fallback.
- **`move`.** Move a TS function/class to another file with source removal and
  target insertion.
- **`organize-imports`.** Sort import blocks alphabetically for TS/JS files.
- **`unused`.** List unused local variables via TypeScript reference analysis.
- **`callers`.** Map direct callers of a TS function.
- **Diagnostics before/after edits with rollback.** Each apply path collects a
  `DiagnosticSnapshot`, applies edits, then re-collects. New errors or a failing
  `--check` command roll back all changed files.
- **LSP editing support.** `LSPServerInstance.ts` advertises `textDocument.rename`
  and `workspace.applyEdit`; `LSPServerManager.ts` handles reverse
  `workspace/applyEdit` requests.

### Changed
- `src/commands/repo-edit/repo-edit.ts` dispatches the new `rename`, `move`,
  `organize-imports`, `unused`, and `callers` subcommands while keeping legacy
  `plan/preview/apply rename` paths working.

### Verified
- Added `test/repoEditAst.test.ts`, `test/typescriptEngine.test.ts`,
  `test/repoEditMove.test.ts`, `test/repoEditImports.test.ts`, and
  `test/repoEditReadOps.test.ts` covering binding-aware rename, cross-file
  import updates, rollback on check failure, move, organize imports, unused
  detection, and caller mapping.

## 1.22.2

### Added
- **Lifecycle hooks.** Added six new hook events in `src/entrypoints/sdk/coreTypes.ts`
  and `src/entrypoints/sdk/coreSchemas.ts`: `BeforeEdit`, `AfterEdit`,
  `BeforeCommand`, `AfterCommand`, `BeforeCommit`, and `OnFailure`. Dispatchers
  in `src/utils/hooks.ts` run them around file edits, shell commands, git commits,
  and failure paths. Call sites are wired in `FileEditTool`, `BashTool`,
  `PowerShellTool`, `toolExecution.ts`, and `query.ts`. Hooks are advisory by
  default and can block actions or append project memory.
- **Persistent project memory.** Extended `TaskMemoryKind` in
  `src/services/context/projectContextManifest.ts` with `architecture`,
  `preference`, `attempt`, `accepted`, and `rejected`. Entries now support
  `status`, `rationale`, `alternativeTo`, `supersedesId`, `scope`, and `source`
  metadata. `ur context-pack remember` accepts the new kinds and metadata flags.

### Changed
- **Compressed context** now includes sections for all memory kinds, including the
  new project-memory categories.

### Verified
- Added `test/lifecycleHooks.test.ts` covering the new `HOOK_EVENTS` literals and
  Zod schema validation.
- Added `test/projectMemory.test.ts` covering append/read/compress/summarize for
  the new memory categories and metadata.

## 1.22.1

### Added
- **Rich task decomposition.** `src/services/agents/decomposer.ts` splits large
  goals into atomic subtasks with `goal`, `filesTouched`, `risk` (low/medium/high),
  `testsRequired`, and `rollbackPoint`. `ur crew create|run|plan ... --decompose`
  uses it; a deterministic fallback keeps the command offline and fast, while a
  headless subagent path produces structured JSON.
- **Parallel specialized subagents.** New `parallel` multi-agent pattern in
  `src/services/agents/patterns.ts`: bug finder, patch writer, test writer,
  security auditor, and style reviewer run concurrently, then a synthesizer
  merges their outputs. Run it with
  `ur pattern parallel "<task>" --execute [--dry-run]`.
- **AgentKernel abstraction.** `src/services/agents/kernel.ts` is a pure
  orchestrator with seven roles: planner, executor, verifier, critic, memory,
  router, and guard. `ur spec run|verify <name> --kernel` routes through kernel
  stages while the legacy path stays the default.
- **Spec verification / verifier kernel role.** `ur spec verify <name>` runs
  deterministic `.ur/verify.json` project gates, then a read-only deep
  verification subagent that must prove compile/test/lint/diff/runtime before
  `VERDICT: PASS`. Persists `.ur/specs/<name>/verification.md` and records the
  result in `spec.json`.

### Changed
- **Version bump.** Updated from 1.22.0 to 1.22.1 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added `test/decomposition.test.ts`, `test/parallelPattern.test.ts`, and
  `test/kernel.test.ts` covering decomposition metadata, parallel pattern
  workflow execution, and all seven kernel roles.

## 1.22.0

### Added
- **Agent execution metrics in `ur eval`.** `ur eval run` now captures
  cost, input/output tokens, model used, API duration, files changed,
  insertions/deletions, command failures, human-edit heuristics, and optional
  per-case `testCommand` results. Metrics are written by the headless child
  via `UR_EVAL_METRICS_FILE`, so future parallel eval runs stay safe.
- **Richer eval dashboard.** `ur eval dashboard` and
  `ur eval report <suite> --dashboard` generate local HTML dashboards with
  summary cards (pass rate, test pass rate, cost, tokens, files changed, command
  failures, human edits, duration) and a per-case timeline showing model, time,
  cost, tokens, diffs, test result, and output preview.
- **Per-case run metrics persistence.** `ur eval run <suite> --metrics` writes
  each case's metrics to `.ur/evals/.runs/<suite>/<case>.json` for downstream
  analysis.
- **Benchmark-style reporting.** `formatEvalReport` prints aggregate cost,
  tokens, files changed, command failures, human edits, duration, and test pass
  rate alongside the pass-rate summary.
- **Spec verification / verifier kernel role.** `ur spec verify <name>` runs
  deterministic project gates from `.ur/verify.json`, then invokes a read-only
  deep verification subagent that must demonstrate compile/test/lint/diff/runtime
  proof before emitting `VERDICT: PASS`. Results are persisted to
  `.ur/specs/<name>/verification.md` and recorded in `spec.json` so `ur spec status`
  shows the latest verdict.
- **AgentKernel abstraction.** Added `src/services/agents/kernel.ts`, a pure
  orchestrator with seven roles: planner, executor, verifier, critic, memory,
  router, and guard. `ur spec run <name> --kernel` and
  `ur spec verify <name> --kernel` route through kernel stages while the legacy
  loop remains the default. `src/services/agents/kernelSpec.ts` provides
  spec-to-stage adapters.
- **Rich task decomposition.** Added `src/services/agents/decomposer.ts`. `ur crew
  create|run|plan ... --decompose` splits a goal into atomic subtasks with
  `goal`, `filesTouched`, `risk` (low/medium/high), `testsRequired`, and
  `rollbackPoint` metadata. A deterministic fallback keeps it offline and fast;
  the model path asks a headless subagent for structured JSON.
- **Parallel specialized subagents.** Added `parallel` multi-agent pattern in
  `src/services/agents/patterns.ts`. Bug finder, patch writer, test writer,
  security auditor, and style reviewer run in parallel, then a synthesizer merges
  the results. `ur pattern parallel "<task>" --execute` runs it via the workflow
  executor with concurrency matching the number of parallel agents.

### Changed
- **`makeCliEvalRunner` resets cost state per case**, reads child metrics,
  gathers `git diff --stat` totals, runs `expect.testCommand` when present, and
  returns an `EvalRunMetrics` object with best-effort command-failure and
  human-edit counts.
- **Version bump.** Updated from 1.21.0 to 1.22.0 across `package.json`,
  `bunfig.toml`, and the VS Code extension manifest.

### Verified
- Added `test/evalMetrics.test.ts` and `test/evalDashboard.test.ts` covering
  child metrics serialization, report aggregation, dashboard HTML rendering,
  HTML escaping, and run-metrics persistence.
- Added `test/specVerify.test.ts` covering dry-run verification, gate fast-fail,
  verification record persistence, and verifier prompt construction.
- Added `test/kernel.test.ts` covering all seven kernel roles and the spec
  run/verify kernel adapters.
- Added `test/decomposition.test.ts` covering deterministic decomposition, risk
  heuristics, LLM-driven dry-run decomposition, and crew metadata persistence.
- Added `test/parallelPattern.test.ts` covering the `parallel` pattern stages,
  workflow compilation, and dry-run execution through the workflow executor.

## 1.21.0

### Added
- **Agent skill runner (`agentSkillRunner.ts`).** Reusable helper that wraps
  `startBackgroundTask({ worktree: true, pr: true })`, polls the background
  manifest to completion, and returns a PR-style summary with branch, commits,
  PR URL, and diff summary.
- **New slash skills for agent worktrees.** Added `/debug-v2`, `/refactor`,
  `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, and
  `/latex-paper` bundled slash skills. Each expands into a prompt that instructs
  the model to work in an isolated git worktree and produce a clean branch,
  commits, and PR.
- **Matching agent templates.** Added `debug-v2`, `refactor`, `paper-implementation`,
  `benchmark`, `security-review`, `dockerize`, and `latex-paper` templates to
  `AGENT_TEMPLATES`; install them with `ur agent-templates install`.
- **`ur worktree` command.** Added `ur worktree list|status|clean` to inspect
  and clean up UR agent worktrees created by background runs.

### Changed
- **Background runner exports.** Exported `commitIfNeeded` and `createPullRequest`
  from `backgroundRunner.ts` so the agent skill runner can inspect and finalize
  PR state.
- **Version bump.** Updated from 1.20.0 to 1.21.0 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added tests for the agent skill runner, each new bundled skill, and the new
  `ur worktree` command.

## 1.20.0

### Added
- **ACP server (`ur acp`).** Added an HTTP+JSON-RPC Agent Communication
  Protocol server for IDE extensions. Supports `initialize`, `tools/list`,
  `tools/call`, `tasks/send`, `tasks/get`, `tasks/cancel`, and `shutdown`.
  Runs on `127.0.0.1:8123` by default with optional bearer-token auth.
- **`ur exec` pool execution.** Added a non-interactive pool command that runs
  one or more prompts with optional concurrency, worktrees, output capture,
  and dry-run mode.
- **GitHub tool.** Added `GitHubTool` for PR/issue/repo operations via the
  `gh` CLI.
- **API tool.** Added `ApiTool` for REST HTTP calls with JSON/text output.
- **Browser tool.** Added `BrowserTool` for headless browser automation
  (fetch/goto/click/type/evaluate/screenshot). Disabled by default; enable
  with `UR_BROWSER_TOOL=1`.
- **Docker tool.** Added `DockerTool` wrapping the `docker` CLI for container
  and compose operations.
- **Test-runner tool.** Added `TestRunnerTool` that auto-detects the project
  test command from `package.json` scripts, `Makefile`, `Cargo.toml`,
  `pyproject.toml`, or `go.mod`.
- **Database tool.** Added `DatabaseTool` for SQL queries against SQLite,
  Postgres, MySQL, and DuckDB.

### Changed
- **Tool surface.** File-system and terminal tools (`FileRead`, `FileEdit`,
  `FileWrite`, `Glob`, `Grep`, `Bash`, `PowerShell`) are now automatically
  exposed through the existing MCP server and the new ACP server.
- **Version bump.** Updated from 1.19.0 to 1.20.0 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added focused tests for the ACP server/client, `ur exec`, GitHub tool,
  API tool, browser tool, Docker tool, test-runner tool, and database tool.

## 1.19.0

### Added
- **Permission and safety policy (`ur safety`).** Added a project shell safety
  evaluator that separates read, write, execute, and network command classes;
  asks before destructive commands; recommends sandboxing for risky operations;
  and denies common secret-file and secret-like environment exfiltration paths.
- **Bash permission integration.** The project safety policy now runs before
  broad Bash allow paths and sandbox auto-allow, so destructive commands still
  require approval and secret exfiltration is blocked even when permissive
  command rules exist.
- **Project context pack (`ur context-pack`).** Added repo architecture
  scanning from manifests, instruction files, Project DNA, verify gates, and
  safety config. Task memory records decisions, constraints, commands, diffs,
  and notes under `.ur/context/`, with compression into a durable summary.

### Changed
- **Chrome/Desktop links.** Replaced deprecated Chrome and desktop documentation
  links in source with current `ur.ai` URLs.
- **Version bump.** Updated from 1.18.0 to 1.19.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI metadata.

### Verified
- Added focused tests for safety policy decisions, policy file creation,
  context manifest generation, task memory compression, CLI command parsing,
  and updated agent feature/trend inventories.

## 1.18.0

### Added
- **Test-first execution loop (`ur test-first`).** Added a P0 quality loop that
  detects the project stack, orders compile/test/lint commands, runs them as
  command evidence, invokes a bounded fix agent on failure, and refuses a
  passing status unless the detected commands exit 0.
- **Failure trace store.** Failed commands write inspectable logs under
  `.ur/test-first/traces/` with timestamp, phase, command, exit code, stdout,
  and stderr.
- **Edit-time gate installer.** `ur test-first install` and
  `ur test-first --install-gates` merge detected commands into
  `.ur/verify.json` so the existing verifier can run them after file edits.

### Changed
- **Typecheck classification.** Project DNA now classifies Node/TypeScript
  `typecheck` scripts as compile evidence instead of test evidence.
- **Version bump.** Updated from 1.17.0 to 1.18.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI metadata.

### Verified
- Added focused tests for stack detection, verify-gate installation, failure
  trace persistence, retry-through-fix behavior, and CLI argument parsing.

## 1.17.0

### Added
- **Reliable repo editing (`ur repo-edit`).** Added a P0 repo-editing workflow
  with dependency-free file/symbol indexing, indexed search, AST-aware
  JavaScript/TypeScript identifier rename planning, explicit patch preview, and
  transactional multi-file apply.
- **Rollback-safe refactors.** `ur repo-edit apply rename ...` writes all
  planned files as one operation, validates syntax, optionally runs
  `--check <cmd>`, and restores every touched file if validation fails.

### Verified
- Added focused tests for repo edit indexing/search, AST rename planning that
  leaves strings and comments untouched, patch preview without writes, and
  rollback after failed checks.

## 1.16.0

### Added
- **Network Ollama discovery.** `ur --discover-ollama` scans active local subnets
  for Ollama servers on port 11434, verifies each via `/api/tags`, and shows an
  interactive host picker. The chosen host is used for that session only; plain
  `ur` continues to default to `localhost:11434` unless `ollama.host` is set
  explicitly.
- **`--ollama-host <url>` CLI flag.** Point UR at a specific Ollama server for a
  single session without writing settings.
- **`ollama` settings block** in `~/.ur/settings.json` with `host` and
  `lanDiscovery` keys.

### Changed
- **Version bump.** Updated from 1.15.0 to 1.16.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI.

### Verified
- Added `test/ollamaDiscovery.test.ts` and updated `test/ollamaModels.test.ts`.
- Rebuilt `dist/cli.js` and verified typecheck, full test suite, bundle,
  package check, and version output.

## 1.15.0

### Changed
- **Version bump.** Updated from 1.14.0 to 1.15.0 across `package.json`, `bunfig.toml`, and bundled CLI.

### Verified
- Rebuilt `dist/cli.js` at 1.15.0 and verified release check, package check, and version output.

## 1.14.1

### Changed
- Removed the `desktop-app` startup tip pointing to the legacy desktop URL.

### Changed
- **Version bump.** Updated from 1.14.0 to 1.14.1 across `package.json`, `bunfig.toml`, and bundled CLI.

## 1.14.0

### Changed
- **Version bump.** Updated from 1.13.9 to 1.14.0 across `package.json`, `bunfig.toml`, and bundled CLI.

### Verified
- Rebuilt `dist/cli.js` at 1.14.0 and verified release check, package check, and version output.

## 1.13.9

### Added
- **Spec-driven development (`ur spec`).** Scaffolds `requirements.md ->
  design.md -> tasks.md` plus a phase/approval `spec.json` under `.ur/specs/`,
  then drives execution task-by-task through a headless agent, checking off each
  task on a PASS verdict. Tasks use the GitHub Spec Kit / Kiro `- [ ] T1: ...`
  checkbox format, so lists are drop-in portable. `generate` can model-fill a
  phase; scaffolding and task parsing stay pure and offline.
- **In-loop model escalation / local Oracle (`ur escalate`).** Picks a fast tier
  and a strong "oracle" tier from `ur model-doctor`, starts routine work on the
  fast model, and auto-escalates hard reasoning/debug/review (or a failed cheap
  attempt) to the oracle. `escalate oracle` gets a one-shot second opinion;
  `escalate policy` pins tiers. Tier selection and difficulty scoring are
  deterministic and testable.
- **Multi-agent best-of-N judging (`ur arena`).** Runs N agents on the same task
  in isolated git worktrees, judges the resulting diffs with the deterministic
  self-review gate plus verdict/diff-shape heuristics, surfaces the winner, and
  can `--apply` it. Local-first take on parallel-agent judging.
- **Self-healing CI loop (`ur ci-loop`).** Runs a build/test command and, on
  failure, summarizes the error, hands it to a fix agent, and re-runs with a
  bounded retry budget; `--commit`/`--push` are gated by the self-review check so
  a fix can never push secrets. `--from-log` seeds the first failure from a log.
- **Verifiable artifacts surface (`ur artifacts`).** Records reviewable
  deliverables (plans, diffs, test runs, screenshots) under `.ur/artifacts/`
  with pending/approved/rejected status and threaded feedback; `capture-diff`
  and `capture-tests` snapshot the working tree and test output for audit.

### Verified
- Added focused unit suites for escalation, arena judging, the spec workflow,
  the CI loop, and artifacts (26 tests); rebuilt `dist/cli.js` and verified
  typecheck, the full test suite, release check, package check, secret scan,
  version output, npm publish dry-run, and direct CLI smoke tests for
  `ur spec`, `ur arena`, and `ur escalate`.

## 1.13.8

### Fixed
- **Image paste resize fallback.** Clipboard image paste now falls back to
  macOS `sips` when the normal Sharp/native resize path cannot process an
  oversized pasted image.
- **Under-limit image passthrough.** Images whose base64 payload is already
  within the API limit now pass through even if local dimension downsampling
  fails, avoiding unnecessary `Unable to resize image` paste failures.

### Verified
- Rebuilt `dist/cli.js` at 1.13.8 and verified focused image resize tests,
  typecheck, full test suite, release check, package check, secret scan, and
  npm publish dry-run.

## 1.13.7

### Added
- **Explicit update notice.** Interactive sessions now show
  `Update available: <current> -> <latest>` when a newer published package is
  detected, before auto-update starts or when manual action is needed.

### Changed
- Normalized `ur update` output across npm, Homebrew, winget, and apk paths so
  all update notices use the same current-to-latest version wording.

### Verified
- Rebuilt `dist/cli.js` at 1.13.7 and verified the update notice helper tests,
  typecheck, full test suite, release check, package check, secret scan, and npm
  publish dry-run.

## 1.13.6

### Added
- **Professional static documentation site.** Added `documentation/` with a
  full HTML/CSS/JS documentation project covering installation, architecture,
  feature map, tutorials, command reference, slash command families,
  configuration, project files, examples, and troubleshooting.
- **Packaged documentation asset.** Added `documentation` to the npm package
  files list and linked the static site from the root README.

### Verified
- Rebuilt `dist/cli.js` at 1.13.6 and verified the documentation site scripts,
  release check, package check, secret scan, and npm publish dry-run.

## 1.13.5

### Added
- **Headless agent crews.** Added `ur crew` for lead/worker task boards that
  split a goal into subtasks, let worker subagents claim work, and support
  parallel dry-runs or live execution.
- **Long-horizon goals.** Added `ur goal` for persistent objectives with
  progress notes, workflow or pattern links, and resumable execution.
- **Model routing.** Added `ur model-route` to recommend the best local Ollama
  model for a task by capability fit.
- **Trigger bridge.** Added `ur trigger` for parsing GitHub, Slack, and generic
  webhook payloads and optionally launching a headless UR run.
- **Embeddable SDK surface.** Added `ur sdk` plus `src/sdk` helpers so projects
  can drive UR programmatically and scaffold TypeScript/Python examples.

### Changed
- **Automation and model diagnostics.** Expanded automation scheduling support,
  model-doctor reporting, agent feature scaffolds, and trend coverage for the
  new crew, goal, trigger, model-route, and SDK surfaces.

### Verified
- Rebuilt `dist/cli.js` at 1.13.5 and prepared npm package metadata for
  `ur-agent@1.13.5`.

## 1.13.4

### Added
- **Parallel workflow execution.** The declarative workflow executor now runs
  independent ready steps concurrently. `ur workflow run --concurrency <n>`
  caps fan-out width (`1` forces sequential); approval gates and the
  verification/review loop still run sequentially so existing semantics are
  preserved exactly.
- **Live multi-agent dashboard.** `ur workflow run --live` streams a real-time
  execution board (per-step state, verdicts, and parallel-wave grouping) driven
  straight from executor events — the live counterpart to the post-hoc
  `ur agent-inspect` timeline.
- **More orchestration patterns.** Added `concurrent` (parallel fan-out/fan-in),
  `handoff` (triage → specialist), and `debate` (propose → critique → moderate
  loop) alongside PEER and DOE, completing the
  sequential/concurrent/handoff/group-chat/manager-loop taxonomy. Patterns can
  now compile into true DAGs (stage `dependsOn`), and `ur route` recommends the
  new patterns.
- **Public eval harness.** New `ur eval init|list|validate|run|report` runs
  replayable, gradeable cases (contains / notContains / regex / verdict / length
  checks) grouped by category, with deterministic offline grading and a
  `--dry-run` mode. Seeds a starter suite under `.ur/evals/`.
- **A2A delegation tokens.** Signed (HMAC-SHA256), attenuated, expiring
  capability tokens scoped to specific skills and bound to one audience.
  `ur a2a token mint|verify`, enforced by the A2A task server (static bearer
  still works), advertised in the Agent Card `securitySchemes`.

### Verified
- Full test suite green (workflow parallelism, patterns, live board, eval
  grading, and delegation each covered); `tsc --noEmit` clean; `dist/cli.js`
  rebuilt and smoke-tested through the CLI.

## 1.13.3

### Added
- **Checkpointed agent workflows.** Added `ur workflow` for declaring,
  validating, graphing, planning, resuming, and dry-running multi-step agent
  workflows with checkpoints and gates.
- **Multi-agent collaboration patterns.** Added `ur pattern` for PEER and DOE
  workflows, including install, save, dry-run, and live execution paths.
- **Agent routing and inspection.** Added `ur route` for task-to-subagent
  recommendations and `ur agent-inspect` for reconstructing per-subagent
  timelines from session transcripts.
- **Curated project knowledge base.** Added `ur knowledge` for registering
  file, directory, and note sources, building lexical or local-Ollama embedding
  indexes, searching, pruning, and reporting status.

### Changed
- **Agent feature roadmap coverage.** Expanded `ur agent-features` and
  `ur agent-trends` to include collaboration patterns, workflows, inspection,
  routing, and knowledge-base surfaces.

### Verified
- Rebuilt `dist/cli.js` at 1.13.3 and prepared npm package metadata for
  `ur-agent@1.13.3`.

## 1.13.2

### Added
- **Top-level code-index and role-mode commands.** `ur code-index` and
  `ur role-mode` are now registered in the main CLI, matching the shipped
  command modules and help output.
- **Agent-task review controls.** `ur agent-task` now exposes `--force` and
  `--no-review` so PR creation can either override or skip the self-review gate
  intentionally.

### Fixed
- **Self-review PR diff coverage.** The pre-PR self-review now resolves a real
  base ref across local and remote branch names, includes committed branch
  changes, tracked working-tree changes, and untracked files.
- **macOS image paste reliability.** Clipboard image detection now recognizes
  TIFF-only pasteboard images, converts TIFF/BMP payloads to PNG before upload,
  and surfaces real image-read failures instead of reporting "no image found."

### Verified
- Rebuilt `dist/cli.js` at 1.13.2 and verified npm package metadata resolves
  to `ur-agent@1.13.2`.

## 1.13.1

### Added
- **AGENTS.md as runtime context.** UR now loads `AGENTS.md` (the cross-tool
  standard) from project roots at runtime, alongside `UR.md` and `.ur/rules/`.
  It is loaded *before* `UR.md` so a repo's native `UR.md` keeps higher
  priority when both exist — drop-in compatibility with repos already using
  the standard, with zero setup.
- **Semantic code index + CodeSearch.** New local, embedding-based code search.
  `ur code-index build|search|status` builds an incremental vector index of the
  repository using the local Ollama app (embedding model configurable via
  `UR_CODE_INDEX_EMBED_MODEL`, default `nomic-embed-text`). When `UR_CODE_INDEX`
  is set, an opt-in read-only `CodeSearch` tool lets the agent find code by
  meaning alongside Grep/Glob. Fully local-first; no extra provider config.
- **OS-level execution sandbox.** UR's sandbox now actually enforces on macOS
  (Seatbelt via `sandbox-exec`) and Linux/WSL (bubblewrap), confining writes to
  the workspace + temp dirs. Enable with `sandbox.enabled: true`; block network
  egress with `UR_SANDBOX_BLOCK_NETWORK`. Reads remain unrestricted.
- **Self-review gate before PRs.** `ur agent-task pr --create` now runs a
  deterministic self-review of the diff first and blocks PR creation on
  high-severity findings (merge-conflict markers, hardcoded secrets, focused
  tests). Override with `--force`, or skip with `--no-review`.
- **Named role modes.** `ur role-mode list|show|install` ships Architect, Code,
  Debug, and Ask roles with scoped toolsets and role prompts, installable as
  `.ur/agents/*.md` so they work with the existing Agent tool and `/agents`.

### Fixed
- **Image paste hint.** When the clipboard holds no image, the image paste
  shortcut (`ctrl+v`, `alt+v` on Windows) no longer shows a circular "use
  ctrl+v to paste images" message — the very key that was just pressed. It now
  tells you to copy an image (e.g. a screenshot) first, then press the shortcut
  to paste it. SSH sessions keep the existing `scp` hint.

## 1.12.3

### Added
- **Agent feature expansion commands.** Added `ur agent-features`,
  `ur agent-templates`, `ur automation`, `ur agent-task`, `ur model-doctor`,
  `ur semantic-memory`, `ur claim-ledger`, and `ur browser-qa` so the agent
  platform roadmap is visible and executable from both CLI and slash command
  surfaces.
- **Opt-in A2A task server.** `ur a2a serve` now exposes loopback Agent Card,
  health, and dry-run task endpoints from the launcher, with off-loopback binds
  requiring a bearer token.
- **Project scaffolds and examples.** `ur agent-features init` creates reusable
  project assets for agents, automations, GitHub workflow entrypoints, A2A,
  memory, provenance, and browser QA, with `examples/agent_features.md`
  documenting the workflow.

### Fixed
- **Agent template typo safety.** `ur agent-templates install <name>` now
  rejects unknown template names instead of interpreting a misspelling as
  "install all templates."
- **Ollama model inspection request.** `ur model-doctor` now uses the preferred
  `/api/show` request body key (`model`) when inspecting local Ollama models.

### Verified
- Added focused Bun tests for feature scaffolds, template installation,
  automations, PR dry-run generation, local memory/provenance/browser QA
  commands, and the model-doctor Ollama request body.

## 1.12.2

### Changed
- **Ziggurat of Ur spinner.** Replaced the canoe spinner with the Ziggurat of
  Ur catching light: an up-pyramid whose lit face sweeps across (`△ ◭ ▲ ◮`)
  with a gold glint at the fully-lit peak.
- **Lapis & gold prompt.** The prompt input rules are now dashed lapis-lazuli
  (Standard of Ur), with a Standard-of-Ur gold chevron and a soft navy
  drop-shadow beneath the box so the prompt reads as a card floating above the
  surface.

## 1.12.1

### Changed
- **Mashoof spinner.** The activity spinner is now a Mashoof (مشحوف) — the
  marsh canoe — bobbing on the water. It cycles boat-hull arcs (`⌣ ⏝ ‿`) into
  a gentle up-down bob loop instead of the old dot→blocks→house growth, and
  the brightness "breathe" was dropped so it reads as a clean bob.

## 1.12.0

### Added
- **Agent trend coverage.** New `ur agent-trends` CLI command and
  `/agent-trends` slash command report how UR maps to current agent trends:
  local-first model runtime, MCP, A2A, durable workflows, multi-agent
  orchestration, memory, browser automation, provenance, evals, security,
  agent identity, and multimodal workflows. The report includes source
  references for each trend.
- **A2A Agent Card export.** New `ur a2a card` CLI command and `/a2a-card`
  slash command print UR-AGENT Card metadata for discovery by A2A-aware tools.
- **Professional trend docs.** `docs/AGENT_TRENDS.md` documents the coverage
  matrix, source/trust policy, and prioritized roadmap.

### Changed
- **Web-source trust guidance.** WebSearch and WebFetch prompts now explicitly
  treat search results and fetched pages as untrusted evidence, not instruction
  channels, while preserving source citation requirements.

## 1.11.3

### Changed
- **Read-only web browsing.** `WebSearch` and `WebFetch` now run without
  prompting by default, while still respecting explicit deny or ask rules.
- **Source visibility.** `WebFetch` tool results now include the fetched URL so
  final answers can mention where the result came from.

## 1.11.2

### Fixed
- **Clarification dialogs.** `AskUserQuestion` is now loaded without a
  `ToolSearch` round trip and accepts common question text aliases such as
  `prompt` and `text`, preventing malformed clarification attempts from
  surfacing as validation errors.

## 1.11.1

### Changed
- **Npm publication docs.** README installation guidance now reflects that
  `ur-agent` is published on npm, while keeping the GitHub install path for
  source-based installs.

## 1.11.0

### Changed
- **Ollama model selection now lets routing work by default.** The launcher no
  longer forces `OLLAMA_MODEL` when neither `OLLAMA_MODEL` nor `UR_MODEL` is
  set, so UR's Ollama router can choose from the models exposed by the local
  Ollama app. The built-in fallback is `qwen3-coder:480b-cloud` when model-list
  discovery is unavailable.
- **Repository metadata now matches production.** Package metadata, docs, bundled
  issue links, marketplace defaults, and GitHub workflow templates now point to
  `Maitham16/UR`.

### Added
- **Release consistency gate.** `bun run release:check` verifies package,
  `bunfig.toml`, bundled CLI, docs, and launcher version output agree. It also
  runs automatically from `prepack`.
- **Quality notes.** `QUALITY.md` documents the release gate, runtime
  assumptions, safety boundaries, and known limits.
- **Stronger production CI.** The GitHub workflow now runs typecheck, tests,
  bundle, smoke, secret scan, release check, package dry-run, and global install
  verification.

### Fixed
- **Stale bundle/version drift.** The release process now prevents publishing a
  package where `package.json`, `dist/cli.js`, `bunfig.toml`, and `ur --version`
  disagree.
- **Ollama Cloud wording.** Docs now clarify that UR talks only to the local
  Ollama app, while models exposed by that app may be local or Ollama
  Cloud-backed.

## 1.10.2

### Fixed
- **Clipboard image paste — the fix that actually ships.** The 1.10.1 change edited the native NSPasteboard branch, which is dead-code-eliminated from the bundle (its feature gate compiles out), so it never ran. The live path is osascript, whose `saveImage` reused a fixed temp file (`ur_cli_latest_screenshot.png`) opened `with write permission` but never truncated — so a smaller image pasted over a previously larger one kept the old trailing bytes, producing a corrupt PNG ("found in clipboard but not attached"). Added `set eof fp to 0` to truncate before writing.

## 1.10.1

### Fixed
- **Clipboard image paste.** An image the clipboard reported as present but the native reader couldn't decode was silently dropped — "found in clipboard but not attached." `getImageFromClipboard` now falls back to the osascript path instead of treating a native `null` as authoritative.
- **Token truncation on Ollama Cloud models.** Cloud models (the `-cloud` / `:cloud` suffix) now default to a 128K-token context floor for both `num_ctx` and auto-compaction, instead of the small or missing value `/api/show` reports for them — so prompts are no longer silently truncated, with no env vars required. The reported value is still used when it is larger, and `UR_OLLAMA_NUM_CTX` (no longer capped to the detected value) / `OLLAMA_CONTEXT_TOKENS` still override.

### Changed
- **Default model** is now `qwen3-coder:480b-cloud` instead of `llama3.2`, so a session started without an explicit model no longer falls back to a 3B model.
- **Comment discipline now applies to all sessions.** UR's "default to writing no comments / don't explain WHAT the code does / verify it actually works before reporting complete" guidance was gated to internal builds; it is now enabled for everyone (the upstream `@[MODEL LAUNCH]` TODO had it marked for external release).

## 1.10.0

### Added
- **`skill-forge` plugin** in the `ur-plugins-official` marketplace — have the agent author skills for you. `/forge-skill <description>` runs on the active session model: it designs the skill (name, `when_to_use` triggers, arguments, minimal `allowed-tools`, inline vs fork, and steps that each carry a success criterion), shows the `SKILL.md` for a single confirmation, then saves it to `~/.ur/skills/<name>/` (or `./.ur/skills/` with `--project`) without clobbering an existing one. `/skill-refine <name> : <change>` improves an existing skill, and a bundled `skill-authoring` skill encodes the conventions. Complements the built-in `/create-skill`, which only scaffolds an empty template.

### Verified
- The plugin manifest plus its two command and one skill frontmatter blocks parse as strict YAML; the marketplace entry resolves; and there are no slash-command name collisions across the marketplace.

## 1.9.0

### Added
- **Seven first-party integration plugins** in the `ur-plugins-official` marketplace. Each bundles an official MCP server, curated slash commands, and a methodology skill, and falls back to a CLI or local library so the commands still work before any token is configured:
  - **`obsidian`** — operate a vault as a second brain: `/second-brain`, `/daily-note`, `/moc`, `/backlinks`, `/vault-search`. Direct vault file edits or the Obsidian Local REST API MCP server, plus a Zettelkasten/PARA/MOC skill.
  - **`github`** — `/gh-pr-review`, `/gh-pr-create`, `/gh-issues`, `/gh-repo-health` via GitHub's official remote MCP server (`api.githubcopilot.com/mcp/`) or the `gh` CLI.
  - **`gitlab`** — `/gl-mr-review`, `/gl-mr-create`, `/gl-issues`, `/gl-pipeline` via GitLab's official MCP server (OAuth) or the `glab` CLI.
  - **`huggingface`** — `/hf-model-search`, `/hf-dataset-search`, `/hf-model-card`, `/hf-download` via the official Hugging Face MCP server or the `hf` CLI.
  - **`word`** — `/docx-new`, `/docx-from-md`, `/docx-review`, `/docx-edit` via the Office Word MCP server (`uvx`) or a pandoc / python-docx fallback.
  - **`powerpoint`** — `/pptx-new`, `/pptx-from-md`, `/pptx-review`, `/pptx-theme` via the Office PowerPoint MCP server (`uvx`) or a python-pptx fallback.
  - **`miro`** — `/miro-board`, `/miro-diagram`, `/miro-stickies`, `/miro-export` via Miro's official MCP server (OAuth) or the REST API.
- Each manifest wires its MCP server through `userConfig`, so tokens are prompted at enable time and stored in secure storage (keychain / credentials file) — never in plaintext settings or prompt content.

### Verified
- All seven manifests validate against the plugin schema (mcpServers transport, `userConfig` identifiers, `${user_config}` resolution); 36 command/skill frontmatter blocks parse as strict YAML; no secret keys are referenced in prompt content; and there are no slash-command name collisions across the marketplace.

## 1.8.0

### Added
- **`/create-skill` command.** Scaffold a new skill without leaving the REPL: `/create-skill <name> [: <description>] [--project]` writes a ready-to-edit `SKILL.md` (with frontmatter) to `~/.ur/skills/<name>/` — or `.ur/skills/` with `--project` — refuses to clobber an existing skill, and clears caches so it shows up immediately (alias `/new-skill`).
- **Game Designer mode.** A new built-in output style (`/output-style`) that makes UR reason like a game designer — core loops, player fantasy, game feel, and tunable balance constants — while it writes working code.
- **Thinking toggle in the model picker.** `/model` now lets you toggle extended thinking with `t` (alongside `← →` effort cycling) for models that support it. The choice applies to the session and persists via `alwaysThinkingEnabled`.

### Fixed
- **`/update-config` no longer crashes** with `Undefined cannot be represented in JSON Schema`. The settings-schema generator now tolerates Zod types with no JSON Schema equivalent (e.g. the `enabledPlugins` union) instead of throwing.

## 1.7.0

### Added
- **Adaptive model routing (Ollama).** The agent auto-selects the best installed model per tier — the strongest coder model for the main loop, the smallest fast model for light internal work (titles, classification, session search, hooks). Honors `OLLAMA_MODEL` / `OLLAMA_SMALL_FAST_MODEL`; gated by `UR_OLLAMA_AUTO_ROUTE`.
- **Per-model context auto-tuning.** Each request sets `num_ctx` from the model's real context window and the prompt size (floored at 32K for agent work, bucketed so the KV cache stays warm), fixing silent truncation at Ollama's 4096 default. Override with `UR_OLLAMA_NUM_CTX`.
- **Keep-alive for faster responses.** Requests set `keep_alive` (default 30m) to keep the active model warm between turns and cut first-token latency. Override with `UR_OLLAMA_KEEP_ALIVE`.
- **Smarter model listing.** `/model` shows each model's tier (coder/fast) and context window; `/ur-doctor` reports the routing picks and recommends pulling a coder model when none is installed.

### Verified
- New unit tests for routing, context tuning, and keep-alive (including an end-to-end request-body assertion); full suite green.

## 1.6.0

### Added
- **Proactive clarification & planning prompts.** The agent now uses the `AskUserQuestion` multiple-choice popup before significant or ambiguous work and at key planning decisions. Options are navigated with arrow keys and submitted; the last "Other" entry always lets you type a custom answer.
- **Smarter prompt handling.** New always-on guidance makes the agent resolve ambiguity before acting, work in verifiable steps and check each step's output against the request before continuing, verify work actually runs before reporting done, report outcomes faithfully, and keep changes precisely scoped and professional.

### Changed
- **Fewer permission prompts (Balanced default).** When no permission mode is explicitly configured, sessions now start in `acceptEdits`: in-project file edits and safe filesystem/read-only commands are auto-approved, while risky or out-of-project actions still prompt. Override anytime with `permissions.defaultMode` or `--permission-mode`.
- **Elegant breathing spinner.** The house glyph (`⌂`) and bar now pulse smoothly between dim and bright instead of hard-blinking.
