# 14 — Sessions, History & Recovery

Source of truth: `src/history.ts`, `src/utils/fileHistory.ts`, `src/commands/{resume,rewind,branch,export,tag,rename,session,tasks,stats}`,
`src/cli/bg.ts`, `src/services/AgentSummary/`.

## Persistence

Sessions persist automatically under `~/.ur/projects/<project-slug>/` (transcript,
metadata, cost). Disable with `--no-session-persistence` (print mode only).
`cleanupPeriodDays` setting controls transcript retention.

## Resume & continue

```
ur -c                        # continue most recent session in this directory
ur -r                        # interactive picker
ur -r 6f9d…                  # by session id
ur -r "auth refactor"        # picker pre-filtered by search term
ur -c --fork-session         # resume under a new session id
ur --from-pr 123             # resume the session linked to a GitHub PR
/resume [id or search]       # same, in-session
```
Sessions can be named at start (`ur -n "spike"`) or renamed later (`/rename`), and tagged
(`/tag experiments`) for search. `terminalTitleFromRename` mirrors the name into the
terminal title.

## Archive and restore

Archived sessions are moved into a private per-project archive and disappear
from resume and fork discovery until explicitly restored:

```sh
/session list
/session archive                    # archive this session and exit
/session archive <session-id>       # archive another conversation
/session unarchive <session-id>
ur session list
ur session status                    # latest resumable session for this project
ur session status <session-id>       # explicit resumable or archived session
ur session archive <session-id>
ur session unarchive <session-id>
```

The transcript is moved last during restore and first during archive, with
rollback on partial archive failure. Subagent transcripts and session metadata
move with the conversation.

Transcript appends use a single-flight per-file drain. Concurrent appends are
batched without overlapping writes; a disk failure rejects the affected batch
and is surfaced by `flush()` instead of dropping entries or hanging waiters.
Session IDs used in transcript paths reject separators/traversal.

Remote SSE resumes from a strict contiguous sequence checkpoint and advances
only after validated delivery. Malformed, mismatched, gapped, or incomplete
frames reconnect without acknowledging lost data. WebSocket reconnects replay
unacknowledged meaningful frames on both Bun and Node runtimes. Intentional
direct-connect shutdown does not terminate the CLI, and canceling clears remote
permission prompts.

## Checkpoints & rewind

File history snapshots are taken as the agent edits (`src/utils/fileHistory.ts`).
```
/rewind          # (alias /checkpoint) restore code and/or conversation to a prior point
```
Choose: conversation only, code only, or both. Works alongside git — snapshots are
UR-managed and don't require commits.

## Branching & side questions

```
/branch try-other-approach     # fork the conversation at this point (alias /fork)
/btw what's the difference between execa and spawn?   # side question, main thread untouched
```

## Export & inspection

```
/export session.md      # write conversation to file (or clipboard without filename)
/copy                   # copy last response
/trace                  # recent turns: roles, tool calls
/agent-inspect          # per-subagent timeline (doc 09)
/files                  # files currently in context
/cost · /stats · /usage # cost, usage stats, plan limits
/insights               # model-generated report across your sessions
```

## Background sessions (process level)

```
ur --bg -p "run the full test suite and summarize"   # detached run
ur ps                    # list background sessions
ur logs <id> · ur attach <id> · ur kill <id>
```
In-session background work lives in `/tasks` (alias `/bashes`): backgrounded shell
commands, subagents, workflows, and monitors. Each is stoppable with `TaskStop`;
results are delivered by completion notifications and retained in internal task
output storage for session views.

Detached agents persist the session UUID/configuration before launch and use
that same transcript on restart. Completed tool results and acknowledged steering
messages are retained; completed work awaiting publication is not executed again.
Unpaired tool calls are disclosed as unknown outcomes for model reconciliation.
Surviving children prevent duplicate workers. Corrupt or mismatched transcripts
cannot authorize recovery, and interrupted publication requires inspection of
the actual branch/PR rather than an automatic repeat.

Workflow and goal state is distinct from conversation history. Workflow schema-2
checkpoints restore dependency outputs and validate the execution specification.
Goal state persists criteria, model feedback, evidence, consumed budgets and
blockers across resumes. See [multi-agent](09-multi-agent.md) and
[workflows](08-skills-plugins-workflows.md) for their recovery semantics.

HTTP remote sessions use `session/events` cursors for durable event replay and
`session/resume` to reconnect without resubmitting work. Persist both UR config
(including CLI transcripts) and remote-control state across container replacement.
Approvals are authenticated and scoped to one pending request. Device revocation
blocks subsequent access; cancel active work separately when required. See
[ACP](../docs/ACP.md) and the [worker deployment](../deployment/acp/README.md).

## Multi-directory & trust

- `/add-dir ../other-repo` or `ur --add-dir` — extend tool access beyond cwd.
- First use of a directory triggers the workspace trust dialog (skipped in `-p`).
- `/ur-init` scaffolds the `.ur/` asset folder; `/init` generates `UR.md`.
