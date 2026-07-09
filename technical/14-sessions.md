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
commands, subagents, workflows, monitors — each stoppable (TaskStop tool) and inspectable
(TaskOutput tool).

## Multi-directory & trust

- `/add-dir ../other-repo` or `ur --add-dir` — extend tool access beyond cwd.
- First use of a directory triggers the workspace trust dialog (skipped in `-p`).
- `/ur-init` scaffolds the `.ur/` asset folder; `/init` generates `UR.md`.
