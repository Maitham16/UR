# 09 — Multi-Agent Orchestration

Source of truth: `src/tools/AgentTool/`, `src/services/agents/`, `src/commands/{agents,bg,crew,arena,pattern,task,worktree,route,escalate}`,
`src/coordinator/coordinatorMode.ts`, `src/tools/Team*Tool/`.

## Subagents (the `Agent` tool)

The main agent can spawn subagents. Built-in agent types
(`src/tools/AgentTool/built-in/`):

| Type | Purpose |
|---|---|
| `general-purpose` | catch-all multi-step worker (all tools) |
| `Explore` | read-only fan-out search agent |
| `Plan` | architecture/implementation planning agent |
| `verification` | verifies a change actually works (used by `/verify`) |
| `statusline-setup` | configures the status line |
| `ur-code-guide` | answers UR/SDK/API questions |

Custom agents:
- `/agents` — interactive management UI.
- Definition files loaded from agents directories (project + user), validated by
  `AgentJsonSchema`: `description` (required), `prompt` (required), `tools`,
  `disallowedTools`, `model` (or `inherit`).
- CLI: `ur --agents '{"reviewer":{"description":"…","prompt":"…"}}'` and
  `ur --agent reviewer` to run a whole session as that agent.
- `/agent-templates install <name>` installs reusable templates;
  `/role-mode install architect|code|debug|ask` installs the four classic role modes as
  scoped agents.

Read-only agents (`Explore`/`Plan`) intentionally omit the UR.md hierarchy from
their context (token saving, see `loadAgentsDir.ts`) and run with plan-mode
permissions. From the main session in any permission mode, only the shipped
definitions may be spawned before a visible task exists; their plan permission
mode overrides Accept Edits and Approve All on the parent. The task gate rejects
custom overrides, general-purpose or nested delegation, named/team workers, and
worktree creation until an actionable parent task exists. The final tool input
is checked again after permission hooks, preventing an allowed read-only spawn
from being rewritten into write-capable delegation.

Inspection: `/agent-inspect` reconstructs a per-subagent timeline (spawns, prompts,
results, verdicts, tools, tokens) from the session or a transcript file.

## Fan-out limits (`src/tools/AgentTool/fanOutLimits.ts`)

Agents can spawn agents, and `/crew`, `/arena`, `/bg fanout` and `/exec` each
spawn several at once. Two limits bound the resulting tree; both are checked in
`runAgent` before any work starts, so a refusal is free.

| Limit | Default | Hard ceiling | Setting |
|---|---|---|---|
| Nesting depth | 10 | 64 | `agents.maxDepth` |
| Concurrent agents | 100 | 1000 | `agents.maxConcurrent` |

```json
{ "agents": { "maxConcurrent": 200, "maxDepth": 12 } }
```

Out-of-range, negative and non-numeric values clamp rather than disabling the
governor — a settings file cannot switch it off. Exceeding a limit throws with
a message naming both the limit and the setting that raises it. The
concurrency slot is released in `runAgent`'s `finally`, so an aborted or
crashed agent cannot strand the budget.

Depth is derived from the live registry rather than passed down: a child's
depth is its parent's plus one, and an agent whose parent is unknown counts as
a root. Detached background agents are separate processes with their own
budget.

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

## Task routing

```
/route "why does login 500 intermittently?"      # → recommends subagent + pattern
/model-route "port to Rust" --strategy strong    # → recommends model (doc 05)
/escalate run "hard problem" --oracle gpt-5.5    # fast model + oracle escalation (doc 05)
```
`src/services/agents/intentRouter.ts` does the task classification;
`decomposer.ts` splits goals into tasks; `delegation.ts` hands tasks to workers.

### Prompt decomposition and concurrency policy

Prompt planning produces 2–8 bounded tasks in the normal case and never more
than 12. Deterministic splitting understands numbered/nested lists, semicolons,
and directive-led sentence boundaries. Model-generated decompositions are
accepted only when IDs and goals are non-empty and unique, every dependency
exists, there are no self-edges or cycles, and the size limit is respected;
otherwise `decomposer.ts` falls back to deterministic tasks.

The interactive lifecycle creates tasks before referring to their real IDs.
Task guidance forbids guessed/self/forward IDs, then connects dependencies with
`TaskUpdate` and validates the final graph. This keeps model ordering mistakes
away from the task-store API even though the store remains defensive.

`parallelPolicy.ts` is deliberately conservative. Explicitly read-only work may
overlap. Unknown or mutating work in a shared checkout does not. The same
read/write rule is used by Agent tool concurrency, crew claims, prompt-plan
execution, and the cross-plan execution gate in `ur exec`. A mutation is
parallel-safe only with explicit worktree or remote isolation. Local agent
worktrees are created from the exact current `HEAD`, and creation fails if the
source checkout is dirty so a worker cannot silently lose uncommitted state.

## Background agents (`/bg`, `ur bg`)

Detached local agents managed by `src/services/agents/backgroundRunner.ts`:
```
/bg run "upgrade eslint to v9" --worktree         # isolated local worktree
/bg run "upgrade eslint to v9" --worktree --pr    # explicit opt-in PR creation
/bg fanout "fix all TODO(sec) comments" --agents 4
/bg list · /bg status <id> · /bg logs <id> · /bg attach <id> · /bg kill <id>
```
Also `ur --bg -p "…"` for a one-shot detached run, then `ur ps / logs / attach / kill`.

## Crews (`/crew`) — shared task board

A lead agent decomposes a goal into a task board; worker subagents claim and execute tasks
(`src/services/agents/crew.ts`):
```
/crew create cleanup --goal "remove dead code and fix lints" --workers 3 --worktrees
/crew plan cleanup --decompose        # lead splits the goal into tasks
/crew add cleanup --task "delete unused exports in src/utils"
/crew run cleanup                     # workers claim tasks and run
/crew run cleanup --dynamic --max-workers 8   # scale workers to the board (governor-capped)
/crew show cleanup · /crew reset cleanup · /crew delete cleanup
```

The worker count is a ceiling, not permission for conflicting work. Read-only
claims can fill it; shared-checkout writers are claimed one at a time. Terminal
non-dry-run crew results are recorded in the local learning store.

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

Bundled worktree skills (`/fix-bug`, `/refactor`, `/security-review`,
`/dockerize`, `/paper-implementation`, `/latex-paper`, `/benchmark`, `/batch`)
leave changes local. They run focused checks while working, ask before the final
full verification suite, and never commit, push, or open a PR unless the user
separately requests publishing. `agentSkillRunner.createPr` defaults to false.

## Teams / swarm mode (feature-gated)

- `UR_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or `--agent-teams` (internal): multi-agent team
  solving with `TeamCreate` / `TeamDelete` / `SendMessage` tools and
  `InProcessTeammateTask`s; `TeammateIdle` hook event; team memory sync
  (`src/services/teamMemorySync/`).
- Coordinator mode (`UR_CODE_COORDINATOR_MODE=1`): the main session becomes a lead that
  only coordinates (Task/TaskStop/SendMessage tools) while workers get the execution
  tools (`src/coordinator/coordinatorMode.ts`, `COORDINATOR_MODE_ALLOWED_TOOLS`).
- `/peers` + `ListPeers` tool (UDS_INBOX gate): discover other UR processes on the machine
  via unix-socket inboxes and message them.

## Goals — long-horizon persistence (`/goal`)

```
/goal add v2-launch --objective "ship v2" --workflow release
/goal list · /goal show v2-launch · /goal note v2-launch "auth blocked on infra"
/goal resume v2-launch      # re-enter the goal workflow in a new session
/goal pause|done|abandon|delete v2-launch
```

## Verification layer (`src/services/verifier/`)

Runs alongside all of the above: done-detector (claims of completion are checked),
loop-detector (agent stuck in a repeat cycle), project quality gates
(`projectGates.ts`, installed by `/test-first install --install-gates`), and subagent
nudges. `verifier.askBeforeGates` setting controls prompting. Proofs are recorded by
`verificationProofs.ts` and consumed by `/spec verify` and `/ci-loop` evidence output.
