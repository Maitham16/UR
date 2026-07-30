# UR-Nexus Persistent Project Memory

This is the durable handoff for coding agents working in this repository. Read
this file before exploring the tree. It records the architecture, decisions,
invariants, validation state, and release workflow established during the
v1.65.7 audit and maintained through v1.66.1.

Do not start by re-auditing the entire repository. Confirm the current version
and working-tree state, then open only the technical chapter and source paths
relevant to the requested change.

## Fast start for every future session

1. Run `git status --short --branch` and read the version in `package.json`.
   Existing changes belong to the user; preserve them.
2. Read `CHANGELOG.md` for changes after the snapshot recorded below.
3. Use `technical/README.md` as the canonical documentation index. The 14
   chapters map the public product surface to executable source and tests.
4. Search targeted paths with `rg`; do not reread every file unless the task
   explicitly requires another full audit.
5. After a change, run focused tests first, then the proportional release gates
   listed in this file.
6. Update this memory when a material invariant, architecture path, release
   process, version, or validation result changes.

Standing user release preference: every completed code change must receive a
new patch version, a matching newest-first changelog entry, synchronized build
surfaces, release validation, and manual GitHub/npm push commands. Never reuse
a version already present on npm.

## Project identity

- Product: **UR-Nexus**
- npm package: `ur-agent`
- CLI binary: `ur`
- Language/runtime: TypeScript, Bun 1.3+, Node launcher 18.18+
- TUI: React/Ink
- Repository: `https://github.com/Maitham16/UR`
- Main bundled entry: `src/entrypoints/cli.tsx`
- Launcher: `bin/ur.js`
- Built CLI: `dist/cli.js`
- Public SDK export: `ur-agent/sdk`
- Local project state: `.ur/`

UR-Nexus is an autonomous engineering workflow engine with a
plan → execute → test → verify → document → benchmark loop. It supports local
models, cloud providers, interactive and headless operation, tools, tasks,
workflows, multi-agent crews, isolated worktrees, IDE integrations, plugins,
skills, memory, research, and release/evaluation tooling.

## Sources of truth

Use this precedence when documentation and code appear to disagree:

1. Executable source plus passing tests.
2. `technical/` specifications, which are audited against source.
3. `docs/`, `README.md`, and generated website content.
4. Historical changelog prose.

The technical catalog is:

- `technical/01-architecture.md`
- `technical/02-cli-reference.md`
- `technical/03-slash-commands.md`
- `technical/04-tools.md`
- `technical/05-providers-and-models.md`
- `technical/06-configuration.md`
- `technical/07-memory-and-context.md`
- `technical/08-skills-plugins-workflows.md`
- `technical/09-multi-agent.md`
- `technical/10-headless-automation-eval.md`
- `technical/11-integrations.md`
- `technical/12-security-sandbox-stability.md`
- `technical/13-research.md`
- `technical/14-sessions.md`

`test/technicalDocumentationIntegrity.test.ts` and release-hygiene tests enforce
the required catalog and packaging. Update technical documentation whenever a
public command, option, tool, provider, setting, workflow, SDK contract, or
runtime behavior changes.

## Release snapshot: 2026-07-30

- Local package version: **1.66.1**
- npm `latest` at the time of this update: **1.66.0**; that version was
  published externally from the first 1.66.0 dry-run candidate while final
  verification was still in progress. `npm whoami`
  successfully resolves the maintainer account `maitham88`.
- GitHub Actions production run `30515287806` for the v1.65.14 `master`
  commit completed successfully.
- v1.66.1 has not been committed, tagged, pushed, or published.
- Full post-build functional validation:
  - 2,191 tests passed, 0 failed
  - 9,784 assertions across 262 files
  - typecheck and strict-core typecheck passed (133 strict files)
- Release validation, lint, secret scan, CLI version/help smoke tests,
  dependency audit, package smoke test, and npm publish dry-run all passed.
- Dry-run tarball: 156 files, 6.5 MB packed, 32.5 MB unpacked; SHA-1
  `2d894ed6c0ee5159da4fb865ca15160212bb54f6`.
- Release validation:
  - CLI plus ESM/CommonJS/typed SDK builds passed with 86 synchronized version
    occurrences
  - release check and packaged CLI smoke test passed for 1.66.1
  - dependency audit reported no known vulnerabilities; all six runtime
    dependency ranges resolve; the safety matrix is current
  - secret scan and `git diff --check` passed
  - local CLI reports `1.66.1 (UR-Nexus)` and `--help` exits successfully
  - npm publish dry run passed: 156 files, 6.5 MB packed, 32.5 MB unpacked,
    shasum `2d894ed6c0ee5159da4fb865ca15160212bb54f6`
  - v1.66.1 CI remains pending until the local release commit is pushed

This snapshot is evidence, not a permanent guarantee. Rerun relevant gates
after later changes.

## Architecture map

- CLI setup and dispatch: `src/main.tsx`, `src/query.ts`, `src/commands/`
- TUI components: `src/components/`
- Prompt and agent guidance: `src/constants/prompts.ts`,
  `src/tools/AgentTool/`, `src/services/agents/`
- Tool registry and execution: `src/tools.ts`, `src/tools/`,
  `src/services/tools/`
- Task registry and lifecycle: `src/Task.ts`, `src/tasks.ts`, `src/tasks/`
- Providers and transport adapters: `src/services/providers/`,
  `src/services/api/`, `src/utils/model/`
- Planning/execution: `src/services/promptPlanning/`,
  `src/services/agents/executor.ts`
- Crews and worker scheduling: `src/services/agents/crew.ts`,
  `src/services/agents/scheduler.ts`, `src/commands/crew/`
- Workflows: `src/services/agents/runWorkflow.ts`,
  `src/services/agents/workflows.ts`, `src/commands/workflow/`
- Headless parallel execution: `src/commands/exec/`
- Public SDK: `src/sdk/index.ts`, `tsconfig.sdk.json`,
  generated `dist/sdk/`
- Worktrees and filesystem safety: `src/utils/worktree.ts`,
  `src/ur/fileops.ts`, `src/utils/exportPath.ts`
- Session persistence: `src/utils/sessionStorage.ts`
- Release tooling: `scripts/bundle.mjs`, `scripts/package-check.mjs`,
  `scripts/release-check.mjs`, `scripts/release-hygiene.mjs`,
  `scripts/version-bump.mjs`
- Release automation: `.github/workflows/release.yml`

## Non-negotiable agent invariants

### Prompt handling

The model-facing execution rules are intentionally compact. Do not blindly
restore the old verbose block of instructions. Its required semantics are
preserved in the current execution contract and tested in
`test/promptExecutionContract.test.ts`.

The contract requires:

- use the structured tool-call interface instead of printing tool-call JSON,
  XML, or fenced pseudo-calls;
- use file write/edit tools for actual file mutations;
- batch independent tool calls, with at most eight in one turn;
- plan multi-step work before mutations;
- keep the plan/task list synchronized with real progress and dependencies;
- switch strategy after repeated identical failures;
- verify edits and commands with positive evidence;
- never claim an action, test, or write succeeded without a successful result;
- never emit an empty assistant turn;
- remain explicit about blockers and uncertainty.

Unsafe generic recovery advice was intentionally not retained. In particular,
the agent should not recommend broad package-manager bypasses such as
`--break-system-packages` without platform-specific justification and user
authority.

Working-mode guidance lives in
`src/services/agents/workingMode.ts` and covers code, research, debug, browser,
image, video, and data tasks. Keep guidance short and operational so weaker
models receive useful constraints without losing their context window.

No implementation can guarantee flawless behavior from every current or future
model. The correct goal is provider-normalized tool input, deterministic
validation, bounded recovery, and fail-closed behavior where correctness cannot
be established.

### Tasks and plans

- Multi-step mutations require a plan/task list.
- Non-trivial plans use one task per cohesive outcome with an observable done
  check. Split separately completable deliverables, not files, tool calls, or
  tiny mechanical steps; genuinely atomic work remains one task.
- Plan dependencies must reflect execution order. Review/inspect/analyze tasks
  precede corrective work, and verification/report tasks fan in on everything
  they verify.
- Approved-plan handoff is capability-aware: use Task V2 only when both
  `TaskCreate` and `TaskUpdate` exist, otherwise use `TodoWrite`, otherwise use
  the plan's numbered tasks. Never invent a task or worker tool.
- Task lists and plan mode are separate state machines. `ExitPlanMode` follows
  a successful `EnterPlanMode` or `/plan`; creating tasks alone does not enter
  plan mode.
- In active plan mode, only the exact normalized session plan file is exempt
  from the task-list mutation gate. Rewritten paths and out-of-mode writes are
  gated normally.
- The gate must count actual tool calls, not assistant messages. The first valid
  write after creating a plan must not be blocked.
- A compact boundary permanently consumes the short initial free-call
  allowance. Full, partial, and session-memory compaction restore a bounded
  authoritative task snapshot: exact Task V2 IDs/statuses/owners/dependencies
  or legacy TodoWrite order/status. Omitted records require `TaskList` before
  task mutation.
- Permission-time task and path state is rechecked at the final execution
  boundary, including unchanged and in-place rewritten inputs.
- Task tool inputs accept positive safe-integer JSON IDs for model
  interoperability but normalize and persist every ID as a canonical string.
- Task order is numeric, never lexicographic (`2` precedes `10`).
- Dependencies must complete before dependents run.
- A task cannot be marked completed merely because execution stopped.
- Gate recovery distinguishes no tasks from an all-terminal list and requires
  remaining Edit/Bash work to be created or reopened. Only one simple
  loopback-URL `open` preview bypasses the task gate; Bash permission,
  sandbox, plan-worker, and permission-rewrite checks still apply.
- Verification checks the TodoWrite/task state before accepting completion.
- Task V1 and V2 behavior must remain compatible with their respective tests.

Primary paths:

- `src/services/tools/taskListGate.ts`
- `src/services/tools/StreamingToolExecutor.ts`
- `src/tools/TodoWriteTool/`
- `src/tools/TaskUpdateTool/`
- `src/components/TaskListV2.tsx`
- `test/taskListGate.test.ts`
- `test/taskListV2.test.tsx`

### Tool calling and failures

- Normalize streamed/final tool input before execution.
- Reject malformed, duplicate, incomplete, or non-object arguments.
- Preserve real provider tool-call IDs.
- Repeated identical failing calls are bounded and canonicalized; retrying the
  same unchanged call indefinitely is forbidden.
- Exact edit misses fail closed. Recovery may identify a verified current-file
  line and bounded preview, but must require a fresh small contiguous
  `old_string`; never silently apply a fuzzy replacement.
- Successful prose cannot conceal a nonzero process exit, signal termination,
  malformed result, or failed tool.
- CLI commands use exit codes consistently: 0 success, 1 runtime failure,
  2 invalid usage.
- User-visible lifecycle state must represent real runnable tasks, not invented
  placeholders.

Primary paths:

- `src/services/tools/toolExecution.ts`
- `src/services/tools/StreamingToolExecutor.ts`
- `src/services/api/streamingAdapters.ts`
- `test/repeatedFailureGuard.test.ts`
- `test/providerToolInputNormalization.test.ts`
- `test/toolExecutionFinalInput.test.ts`
- `test/localCommandFailureContracts.test.ts`

### Parallel workers and respawning

- Independent work should run in parallel.
- Approved plans launch at most eight ready, non-conflicting worker tasks per
  wave and continue with later waves as slots free. Dependents and conflicting
  shared writes stay sequential.
- Ordinary `Agent` workers do not promise automatic respawn. Crew scheduling
  owns bounded respawn/retry behavior; keep model instructions honest about
  that distinction.
- Built-in Explore and Plan agents are available in standard CLI sessions with
  a structurally read-only tool pool. Only the exact active built-in
  definitions receive the plan-mode delegation exemption; child execution
  rejects mutations again after input or hook rewrites.
- Team creation/deletion is mutating and rechecks live plan mode inside the
  call immediately before changing state.
- Top-level mutating jobs use isolated worktrees; shared-tree mutation is
  serialized or refused.
- Crew workers may respawn, but retries are bounded.
- Retry only work that is safe to replay in an isolated worktree.
- Preserve dependency fan-in and collect every branch result before deciding
  the final verdict.
- Do not replay a shared mutation merely because a worker failed afterward.
- `/exec` uses planned concurrency, one worktree per top-level prompt, unique
  output files, and fail-closed aggregation.

Primary paths:

- `src/services/agents/crew.ts`
- `src/services/agents/scheduler.ts`
- `src/services/agents/executor.ts`
- `src/commands/crew/`
- `src/commands/exec/`
- `test/crewWorkerRecovery.test.ts`
- `test/runAgentFanOutCleanup.test.ts`
- `test/execCommand.test.ts`

### Workflows and durable state

- Obtain required approval before workflow execution.
- Fold parallel branches with `Promise.allSettled` semantics; do not lose a
  sibling failure.
- Verification is fail-closed unless a step is explicitly advisory.
- State writes are private and atomic.
- Persist exact bounded step outputs so resume does not replay completed work.
- Current bounds are 32 KiB per step and 256 KiB per run.
- Missing or oversized required resume output fails closed.
- Historical state may be inspected, but must not be presented as a live task
  when no real runtime/task implementation exists.

Primary paths:

- `src/services/agents/runWorkflow.ts`
- `src/services/agents/workflows.ts`
- `src/commands/workflow/`
- `test/workflowSafety.test.ts`
- `test/runtimeTaskRegistry.test.ts`

### Providers and models

- Ollama tool-result images must survive content splitting.
- Vision capability uses one tri-state resolver rather than multiple
  disagreeing checks.
- A live `/model` session override wins over the persisted model in both
  provider calls and status UI.
- Ollama host resolution must honor the session override at every call site.
- OpenAI-compatible streaming must reject malformed or duplicate tool calls and
  preserve late real IDs.
- OpenAI Responses settings must propagate rather than silently falling back.
- LM Studio exists in the registry but is disabled in v1.65.7 and must not be
  advertised as available.

Primary paths:

- `src/services/api/ollama.ts`
- `src/services/api/openaiCompatible.ts`
- `src/services/providers/providerRegistry.ts`
- `src/utils/model/visionCapability.ts`
- `src/utils/statusBar.ts`
- `test/visionCapability.test.ts`
- `test/providerRegistry.test.ts`
- `test/providerStreaming.test.ts`

Live provider calls require credentials and provider availability. Mocked
protocol tests do not prove an external service will never change.

### UI truthfulness

- The status bar displays the live session model, not merely the persisted
  default.
- Task progress, spinner, and background task displays must reflect actual
  lifecycle state.
- Failed or unknown state is shown as failed/unknown, never silently upgraded
  to success.
- Keep terminal layouts compact, aligned, responsive, and usable without color.

Primary paths:

- `src/components/StatusLine.tsx`
- `src/components/TaskListV2.tsx`
- `src/components/Spinner.tsx`
- `src/components/Spinner/taskProgress.ts`
- `src/components/tasks/BackgroundTasksDialog.tsx`
- `src/components/tasks/backgroundTaskDialogLogic.ts`

### Filesystem, state, and concurrency safety

- Resolve workspace paths and reject traversal/symlink escapes.
- Use atomic private JSON writes for durable state.
- Lock the complete read/modify/write transaction for concurrent shared state.
- The claim ledger uses `withPrivateStateLock`; claim IDs select the first
  unused ID so sparse or externally produced ledgers cannot create duplicates.
- Never replace the user's dirty working tree or delete unrelated files.

Primary paths:

- `src/ur/fileops.ts`
- `src/utils/exportPath.ts`
- `src/utils/sessionStorage.ts`
- `src/commands/claim-ledger/claim-ledger.ts`
- `src/utils/worktree.ts`

## Important fixes included in the v1.65.7 audit

These are already implemented and regression-tested. Preserve them when
refactoring:

- Ollama image content is preserved through tool-result splitting.
- Disagreeing vision checks were unified into a tri-state resolver.
- Ollama host selection honors the live session override at all audited calls.
- Task IDs sort numerically.
- Task-list mutation gates and completion verification are enforced.
- Repeated identical failures are refused and eventually aborted.
- Tips contain real commands and no links to domains UR does not yet serve.
- Version changes use `scripts/version-bump.mjs`; never use broad `sed`
  replacement because it previously corrupted dependency versions.
- Status UI follows the live `/model` selection.
- The task gate counts tool calls rather than messages.
- `cli-highlight` is declared; no ambient `any` shim hides missing packages.
- Highlighter loading failures are logged.
- Dependency-declaration tests scan imported packages.
- Provider API-key entry supplies explicit terminal width, cursor/focus state,
  and a one-line secret viewport so masked keys never render vertically.
- Plan-file writes no longer deadlock behind the task-list gate while plan mode
  is establishing that plan; the exemption is exact-path and mode scoped.
- `ExitPlanMode` post-permission validation no longer mistakes an approved mode
  transition for a new out-of-mode call.
- `ExitPlanMode` is exempt from the implementation task gate, while its own
  live plan-mode validation still rejects stale second exits.
- Task-gate diagnostics distinguish a genuinely absent list from an existing
  all-terminal list and tell the model to create or reopen the cohesive
  remaining task rather than retrying unchanged.
- Approved plans decompose cohesive outcomes into dependency-correct task
  graphs and use only the task and worker capabilities actually present.
- Non-trivial state-changing work restores the v1.65.0 task-first order at
  every model-facing boundary: available Task V2 or TodoWrite setup succeeds,
  the selected task becomes in_progress, then the mutation/worker runs. A
  feature-rich one-file build remains non-trivial, and setup is never batched
  with the mutation it enables.
- Bare/simple, coordinator, custom-agent, and override-prompt modes retain a
  usable planner and task contract. Partial Task V2 exposure falls back to
  TodoWrite; explicitly filtering out every planner fails closed with honest
  configuration recovery. Team bootstrap/teardown, structured shutdown responses, and
  emergency TaskStop are narrow control transitions; skill loading and desktop
  screenshots are reads, while downstream mutations remain gated.
- Standard built-in Explore/Plan workers are structurally read-only, and a
  second child-runtime boundary rejects attempted mutations.
- Positive integer task IDs from models normalize to canonical strings before
  Task V2 lookup, dependency checks, or persistence.
- Exact Edit mismatches return bounded, verified recovery guidance instead of
  applying an unsafe fuzzy replacement, and prefer the most distinctive
  verified current-file anchor over a generic shared delimiter.
- A narrow deletion-only Edit whose desired replacement is already uniquely
  present returns an explicit no-write, already-up-to-date result; general
  stale and ambiguous edits remain errors.
- AskUserQuestion exposes a request-only nested schema, never accepts model
  supplied answers, revalidates every interaction after permission, and
  requires one real answer per question before reporting success.
- A safe overlong Ask header is compacted as a presentation-only UI chip across
  native, bare-JSON, and explicit-choice recovery; question and option content
  is never shortened to make a call pass.
- Ask UI records are prototype-safe, preview questions have a genuine custom
  Other path, and HTML preview mode escapes model content as inert text.
- Write missing-content recovery never infers a file from surrounding prose;
  the error and tool prompt require complete content in the structured call.
- Ollama/Kimi no longer synthesize AskUserQuestion calls from ordinary prose.
  Structured and conservative bare-JSON calls remain supported. A provider-
  neutral end-turn guard may recover only an explicit canonical Ask object from
  reasoning or a complete, rigidly structured decision menu, after live-schema
  validation; casual questions and ambiguous prose remain text.
- The exact live plan-directory bootstrap can bypass only the task-list gate;
  Bash permission, sandbox, plan-child, and permission-rewrite checks still
  apply.
- Strictly parsed Node syntax checks may bypass only the task-list gate after a
  task-free one-shot Write. Generic evaluation and Bash permission/sandbox
  behavior remain unchanged.
- The final actionable task remains in progress after an unchecked file
  mutation, preventing an all-terminal Edit dead end while requiring observable
  verification before completion.
- Kimi K2.7 Ollama Cloud requests receive a 300-second model-aware default;
  explicit request/API timeout overrides and the 120-second remote-session
  ceiling still win.
- Proactive compaction uses one positive model-aware threshold and one live
  estimator. The UI and `/context` show an explicitly approximate percentage
  until that threshold; reactive/collapse modes use their own window and do
  not claim a proactive countdown.
- Full, partial, and session-memory compaction restore bounded authoritative
  task state, and compact boundaries cannot reset the task gate's free-call
  allowance. In-process workers use the normal query-loop compaction policy
  and prune both model and UI transcript mirrors at the boundary.
- Kimi bare task recovery matches the live task schema for dependency fields,
  numeric IDs, and failed/skipped terminal states while invalid or unknown
  input remains fail-closed.
- The v1.65.0–v1.65.5 history audit found no safe missing implementation to
  backport: every concrete technique is still present or superseded by
  stricter tested behavior.
- Command-registry release checks use a Linux/platform-neutral baseline and
  test the supported macOS/x64-Windows `/desktop` delta separately.
- CLI handlers no longer report success after failed underlying work.
- SDK query validation, environment precedence, NDJSON parsing, and nonzero exit
  behavior are tested.
- Workflow outputs are bounded, durable, atomic, and resumable without replay.
- Concurrent claim-ledger writes are lock-serialized and retain all claims.
- Fake Workflow/Monitor task lifecycle entries were removed where no real tool
  or task existed.

## Validation commands

Use focused tests during development. Before a release or after broad runtime
changes, run:

```bash
bun run typecheck
bun run lint
bun test --timeout 120000
bun run build
bun run release:check
bun run secrets:scan
git diff --check
node bin/ur.js --version
node bin/ur.js --help
```

For the exact npm artifact:

```bash
npm publish --dry-run --access public
```

`prepack` rebuilds the CLI/SDK and reruns `release:check`.

## Versioning and release

Never change versions with global text replacement. Use:

```bash
node scripts/version-bump.mjs X.Y.Z
```

Then validate all generated and declared versions.

The release workflow is tag-triggered and verifies that `vX.Y.Z`,
`package.json`, and `CHANGELOG.md` agree. It can publish npm automatically when
`NPM_TOKEN` is configured. If the user wants to publish npm manually, use this
order to avoid a duplicate-publish race:

1. Commit and push the release commit.
2. Run `npm publish --access public`.
3. Verify the published version/integrity.
4. Create and push `vX.Y.Z`.

The workflow detects an already-published npm version, skips duplicate npm
publication, and still creates the GitHub release.

## Maintaining this memory

After material work:

- update the release snapshot and validation totals;
- record new non-negotiable invariants and their source/test paths;
- remove statements made obsolete by code changes;
- keep detailed command/tool catalogs in `technical/`, not duplicated here;
- keep this file concise enough to load at session start.

The goal is fast, evidence-based continuation—not trusting stale prose. When
this memory conflicts with current executable source, fix the implementation or
update this file and the relevant technical chapter together.
