# 09 — Multi-Agent Orchestration

Source of truth: `src/tools/AgentTool/`, `src/services/agents/`, `src/commands/{agents,bg,crew,arena,pattern,task,worktree,route,escalate}`,
`src/coordinator/coordinatorMode.ts`, `src/tools/Team*Tool/`.

## Subagents (the `Agent` tool)

The main agent can spawn subagents. Built-in agent types
(`src/tools/AgentTool/built-in/`):

| Type | Purpose |
|---|---|
| `general-purpose` | catch-all multi-step worker (all tools) |
| `worker` | stable workflow/crew alias for `general-purpose`; a project-defined `worker` overrides it |
| `verification` | verifies a change actually works (used by `/verify`) |
| `statusline-setup` | configures the status line |
| `ur-code-guide` | answers UR/SDK/API questions |
| `Explore`, `Plan` | built-in read-only search and planning agents; registered in the standard npm bundle so plan-mode instructions never advertise missing worker types |

Ordinary `Agent` subagents do not require experimental Teams/swarm mode.
Approved-plan handoff checks the actual tool pool, agent-type allowlist, live
`Agent(type)` deny rules, and active built-in definitions. It can fan out
independent ready tasks only when a selectable implementation worker remains.
The Teams gate applies only to named teammates, team files/mailboxes, and
`TeamCreate`/`TeamDelete`.

While the parent is in plan mode, only the exact active built-in `Explore` and
`Plan` definitions may pass the task-list gate as read-only delegations.
Plan prompts apply the same type allowlist and live deny rules as the eventual
`Agent` call, so they do not advertise a planning worker that policy will
reject.
Custom agents reusing those names, generic agents, teammates, background
launches, custom working directories, and worktree launches remain mutating and
task-gated. `TeamCreate` and `TeamDelete` also reject plan mode explicitly;
team lifecycle state starts only after the plan is approved.

In the standard bundle, `Explore` and `Plan` receive only `Glob`, `Grep`, and
`Read`, use `dontAsk` permission mode, and have a second runtime boundary that
rejects any operation classified as mutating even if an actionable task or
inherited allow rule exists. Ant-native embedded-search builds substitute
read-only Bash `find`/`grep` access for the dedicated search tools; the same
runtime mutation boundary remains in force.

Custom agents:
- `/agents` — interactive management UI.
- Definition files loaded from agents directories (project + user), validated by
  `AgentJsonSchema`: `description` (required), `prompt` (required), `tools`,
  `disallowedTools`, `model` (or `inherit`), `effort`, `permissionMode`,
  `mcpServers`, `hooks`, `maxTurns`, `skills`, `initialPrompt`, `memory`,
  `background`, and worktree `isolation`.
- CLI: `ur --agents '{"reviewer":{"description":"…","prompt":"…"}}'` and
  `ur --agent reviewer` to run a whole session as that agent.
- `/agent-templates install <name>` installs reusable templates;
  `/role-mode install architect|code|debug|ask` installs the four classic role modes as
  scoped agents.

Read-only `Explore`/`Plan` agents omit the UR.md hierarchy only
when the default-on `tengu_slim_subagent_agentmd` gate remains enabled and the
caller did not explicitly provide user context (token saving; see
`loadAgentsDir.ts`).

Inspection: `/agent-inspect` reconstructs a per-subagent timeline (spawns, prompts,
results, verdicts, tools, tokens) from the session or a transcript file.

## Fan-out limits (`src/tools/AgentTool/fanOutLimits.ts`)

These limits apply specifically to nested, in-process launches through the
`Agent` tool. Both are checked in `runAgent` before that child starts, so a
refusal is free.

| Limit | Default | Hard ceiling | Setting |
|---|---|---|---|
| Nesting depth | 3 | 10 | `agents.maxDepth` |
| Concurrent agents | 20 | 100 | `agents.maxConcurrent` |

```json
{ "agents": { "maxConcurrent": 40, "maxDepth": 4 } }
```

Out-of-range, negative and non-numeric values clamp rather than disabling the
governor — a settings file cannot switch it off. Exceeding a limit throws with
a message naming both the limit and the setting that raises it. Slot ownership
enters a single `try/finally` immediately after registration. Failures during
context loading, hooks, skill or MCP setup, cache callbacks, query execution,
cancellation, and normal completion all release it exactly once; partial setup
resources are cleaned conditionally.

Depth is derived from the live registry rather than passed down: a child's
depth is its parent's plus one, and an agent whose parent is unknown counts as
a root.

`/crew`, `/arena`, `/bg fanout`, and `/exec` launch subprocess/worktree
orchestrators and do **not** register in this `Agent`-tool governor. They have
their own concurrency limits (`crew` clamps fixed and dynamic pools to 1–32;
`bg fanout` and `exec` also clamp their public counts) and their own model/token
cost. Detached background agents are separate processes with separate
in-process registries.

## Running several workers at once

Four ways to parallelise, differing mainly in whether workers share your
checkout:

| Command | Shape | Isolation flag |
|---|---|---|
| `ur exec "a" "b" --concurrency 3` | different prompts in parallel | `--worktree` |
| `ur crew run <name> --workers 4` | one goal split across a task board | `--worktrees` |
| `ur arena "<task>" --agents 3` | same task, N attempts, judge picks | isolated by default |
| `ur bg fanout "<task>" --agents 4` | detached, survives the session | `--worktree` |

Pass the isolation flag whenever workers might touch the same files. Without
it every worker edits the same checkout concurrently and they overwrite each
other. Agents are much heavier than test workers — each is a full model session
with its own token spend — so 4–6 is usually the practical ceiling on a laptop
regardless of the configured limit.

Isolation does not imply integration. `/crew --worktrees` creates a fresh
worktree for every task attempt and leaves a passing attempt at its recorded
path for lead/human review; it does not merge, cherry-pick, or apply those
changes to the starting checkout. A dependent crew task receives its
prerequisite's text result, but its fresh worktree does not inherit the
prerequisite worktree's unmerged file changes. Design dependent code edits
accordingly. `/exec --worktree` instead gives all steps of one top-level prompt
the same plan worktree (doc 10).

## Shared task-list correctness

Interactive sessions use the canonical Task V2 tools. Print/headless sessions
use legacy `TodoWrite` by default, or Task V2 when
`UR_CODE_ENABLE_TASKS=1`. Both feed the same mutation gate:

- Approved non-trivial plans are translated into a complete task graph before
  workspace changes: one task record per cohesive outcome with its own
  observable completion check. Separate deliverables are not hidden in one
  umbrella item, while files, tool calls, and tiny mechanical steps are not
  artificial task boundaries.
- Independent Task V2 records are created together (up to the eight-call
  prompt batch limit), then real dependency edges are added once task IDs are
  known. Default headless sessions instead write the complete outcome list
  through `TodoWrite`; approval handoff detects this capability rather than
  naming unavailable Task V2 tools. When an actual built-in implementation
  worker is active, ready tasks without conflicting shared mutations launch in
  waves of up to eight with bounded scope, acceptance checks, and dependency
  inputs. Dependent or conflicting writes stay sequential, and the lead
  verifies worker evidence before completion. An exposed `Agent` tool with no
  selectable implementation worker is not advertised as delegation support.
- Task IDs are ordered numerically (`1, 2, 10`), with non-numeric external IDs
  sorted stably after numeric IDs.
- Dependencies block transition or claim until prerequisites are complete.
- Actionable `pending` or `in_progress` entries open the gate; completed and
  internal entries do not.
- The last actionable `in_progress` task cannot be terminalized immediately
  after a recorded file mutation with no later successful observable check.
  `TaskUpdate` soft-defers that completion and keeps the same task actionable;
  it does not infer or auto-create a replacement task. A later successful
  inspection/runtime/test/delegated check allows the explicit completion retry.
- Reads remain unrestricted. Ordinary mutations have a default allowance of
  three preceding tool calls, counted by tool call rather than message.
  Delegation and child mutations always require an actionable parent task.
  The sole delegation exception is a foreground built-in `Explore` or `Plan`
  call during live plan mode; those agents omit workspace-editing and nested
  delegation tools and remain subject to their child permission checks.
- An unreadable task store fails closed. Task create/update/list/get tools stay
  exempt so the agent can repair the plan.
- Creating or updating the exact current-session plan-mode Markdown file is
  also exempt: that file is the planning artifact, not an ordinary workspace
  change. A bounded Bash bootstrap may only create/check that file's exact
  parent (`mkdir -p`, optionally guarded by the known `ls` pattern); this
  compatibility path remains subject to Bash permission and sandbox checks.
  The exemption and live actionable-task state are re-evaluated at the final
  execution boundary after permission-hook input rewrites. Sibling paths,
  general plans-directory commands, added shell operations, and the filename
  alone outside live plan mode are not exempt.
- Configure the behavior at
  `tasks.requireBeforeChanges.{enabled,freeReads}`.

The prompt contract, plan-file structure, plan-agent output, approval handoff,
task-tool result, and gate recovery text all reinforce the same decomposition
and worker rules. Runtime dependencies and mutation gating enforce ordering and
plan presence; they cannot prove that an arbitrary natural-language task is
semantically complete, so the gate deliberately does not require a fake
minimum task count. Workflows and crews add stricter verdict rules where a
machine-checkable execution boundary exists.

## Task routing

```
/route "why does login 500 intermittently?"      # → recommends subagent + pattern
/model-route "port to Rust" --strategy strong    # → recommends model (doc 05)
/escalate run "hard problem" --oracle gpt-5.5    # fast model + oracle escalation (doc 05)
```
`src/services/agents/intentRouter.ts` does the task classification;
`decomposer.ts` splits goals into tasks; `delegation.ts` hands tasks to workers.

## Background agents (`/bg`, `ur bg`)

Detached local agents managed by `src/services/agents/backgroundRunner.ts`:
```
/bg run "upgrade eslint to v9" --worktree         # isolated local worktree
/bg run "upgrade eslint to v9" --worktree --pr    # explicit opt-in PR creation
/bg fanout "fix all TODO(sec) comments" --agents 4
/bg list · /bg status <id> · /bg logs <id> · /bg attach <id> · /bg kill <id>
```
The standard CLI exposes the same operations through `ur bg ...`. The separate
process-session fast path (`ur --bg -p`, then top-level `ur ps|logs|attach|kill`)
requires the `BG_SESSIONS` build feature and is not present in the normal npm
bundle.

## Crews (`/crew`) — shared task board

A lead agent decomposes a goal into a task board; worker subagents claim and execute tasks
(`src/services/agents/crew.ts`):
```
/crew create cleanup --goal "remove dead code and fix lints" --decompose
/crew plan cleanup --goal "remove dead code and fix lints" --decompose
/crew add cleanup --task "delete unused exports in src/utils"
/crew run cleanup --workers 3 --worktrees
/crew run cleanup --dynamic --max-workers 8   # scale workers to the board (own 1–32 cap)
/crew show cleanup · /crew reset cleanup --max-attempts 2 · /crew delete cleanup
```

A task succeeds only when the worker process is non-error and returns exactly
one standalone `VERDICT: PASS` line; inline, missing, or multiple verdicts,
`PARTIAL`, and `FAIL` are failures. Automatic
retries are bounded (hard cap five), cancellation-aware, and allowed only for
dry runs or fresh worktree attempts. Shared-checkout failures are not replayed
because their mutations are ambiguous. `--resume` and `reset` reopen only safe
isolated attempts that still have budget; ambiguous claimed tasks are marked
failed. Dynamic mode exits rather than spinning when claimed tasks prevent
further progress. Fixed `--workers` and dynamic `--max-workers` are clamped to
1–32 independently of the in-process `Agent`-tool governor. A board that is
not completely done returns nonzero.

## Arena (`/arena`) — best-of-N with a judge

N agents attempt the same task in isolated worktrees, a deterministic judge compares the
diffs, and a passing winner can be applied (`src/services/agents/arena.ts`). Worktree
creation failure fails that candidate; it never falls back to concurrent writes in cwd.
Only non-error `PASS` candidates with a non-empty, non-blocking diff can win:
```
/arena "make the image pipeline 2x faster" --agents 3 --max-turns 30
/arena "…" --apply          # apply the winning diff
/arena "…" --keep           # keep losing worktrees for inspection
```

## Worktree-per-task sessions

```
ur -w feature-x             # session in a fresh git worktree (+ --tmux for panes)
/task start rate-limiter --worktree --base main
/task run <id> · /task status <id> · /task list
/task pr <id> --create --draft --base main
/worktree list · /worktree status · /worktree clean
```
`EnterWorktree` / `ExitWorktree` tools let the model move itself into isolation mid-turn
(worktree mode). Worktree settings: `worktree.symlinkDirectories`, `worktree.sparsePaths`.
`task start --worktree` creates only local isolated state; it never pushes or
opens a PR. Publishing begins only with the explicit `task pr --create`
command.

Bundled worktree skills (`/debug-v2`, `/refactor`, `/security-review`,
`/dockerize`, `/paper-implementation`, `/latex-paper`, `/benchmark`, `/batch`)
carry instructions to leave changes local, run focused checks while working,
ask before the final full verification suite, and avoid commit/push/PR actions
unless the user separately requests publishing. These are model instructions,
not a separate OS enforcement boundary. `agentSkillRunner.createPr` defaults
to false.

## Teams / swarm mode (feature-gated)

- The standard external build can opt into in-process teams with
  `UR_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, subject to the
  `tengu_amber_flint` runtime kill switch. This enables `TeamCreate`,
  `TeamDelete`, `SendMessage`, `InProcessTeammateTask`, and the
  `TeammateIdle` hook. `--agent-teams` is registered only in ant builds, so it
  is not a supported external CLI flag.
- Team creation and deletion are unavailable while plan mode is active. Use the
  standard read-only `Explore`/`Plan` subagents for parallel planning, then
  create an implementation team after approval.
- Coordinator mode (`UR_CODE_COORDINATOR_MODE=1`) is additionally behind the
  compile-time `COORDINATOR_MODE` feature. The standard npm bundle does not
  include it; setting the environment variable there has no effect.
- `/peers` and `ListPeers` are behind the compile-time `UDS_INBOX` feature and
  are likewise absent from the standard npm bundle.
- Team-memory synchronization is separately behind the compile-time `TEAMMEM`
  feature; enabling teams does not make that source-only memory service appear.

## Goals — long-horizon persistence (`/goal`)

```
/goal add v2-launch --objective "ship v2" --workflow release
/goal list · /goal show v2-launch · /goal note v2-launch "auth blocked on infra"
/goal resume v2-launch      # run the linked workflow now from its saved checkpoint
/goal pause|done|abandon|delete v2-launch
```
`resume` executes the linked workflow through child sessions from the current
command; it does not open a new main interactive session. A stored `--pattern`
is descriptive metadata today and is not executed by `goal resume`, which
requires a linked workflow.

## Verification layer (`src/services/verifier/`)

The main query loop has a verifier with done detection, loop detection, project
quality gates (`projectGates.ts`, installed by
`/test-first install --install-gates`), and optional subagent nudges.
`verifier.askBeforeGates` controls prompting. Workflow verification gates,
crew verdicts, arena judging, and exec evidence checks are separate
orchestrator-specific mechanisms; they should not be conflated with this query
verifier. Proof helpers in `verificationProofs.ts` are consumed by the
spec/kernel verification paths and related evidence reporting.
