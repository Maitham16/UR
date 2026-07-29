# 14 — Sessions, History & Recovery

Source of truth: `src/utils/{sessionStorage,sessionStoragePortable,fileHistory}.ts`,
`src/cost-tracker.ts`, `src/commands/{resume,rewind,branch,export,tag,rename,session,tasks,stats,cost,usage,files}/`,
`src/commands/bg/bg.ts`, `src/services/agents/backgroundRunner.ts`,
`src/cli/transports/{SSETransport,WebSocketTransport}.ts`, `src/tasks.ts`, and
`src/Task.ts`.

## Transcript persistence

Interactive sessions persist JSONL transcripts under
`~/.ur/projects/<sanitized-project-path>/<session-id>.jsonl`. Session name,
tag, mode, agent, worktree, and PR-link metadata are entries in that transcript.
`cleanupPeriodDays: 0`, `--no-session-persistence` in print mode, test mode, or
`UR_CODE_SKIP_PROMPT_HISTORY` suppresses transcript writes.

Cost is **not** stored independently in every transcript. The cost tracker saves
one “last session” cost/usage snapshot in the project entry of `~/.ur.json`; a
resume restores it only when that stored `lastSessionId` matches. Older
sessions can therefore have transcripts without a restorable cost snapshot.

## Continue and resume

```text
ur -c
ur -r
ur -r 6f9d…
ur -r "auth refactor"
ur -c --fork-session
ur --from-pr 123
/resume [id or search]
```

- `-c` continues the most recent session for the project.
- `-r` opens the picker; its optional value is an ID or search term.
- `--fork-session` creates a new session ID while loading the prior
  conversation.
- `--from-pr` resolves a transcript linked to a GitHub PR.
- `-n "name"` sets a startup title; `/rename` changes it later.

`/tag <name>` stores exactly one searchable tag on the current session.
Applying a different value replaces the prior tag; running the same value again
opens the removal confirmation. This is not a many-tags-per-session system.

Transcript appends use a single active drain with per-file FIFO queues. Failed
entries are restored ahead of later arrivals, the failure is retained until
`flush()` observes it, and a later `flush()` can retry after the underlying
filesystem problem is repaired. Session IDs used to construct transcript paths
must match the bounded alphanumeric/dash form.

## Transport recovery

For CCR-v2 remote sessions, `SSETransport` validates numeric sequence IDs,
requires contiguous delivery, advances its checkpoint only after delivering a
valid frame, and reconnects on malformed, mismatched, gapped, or incomplete
frames.

`WebSocketTransport` keeps a maximum of 1,000 meaningful outbound frames for
replay. On overflow it drops the oldest buffered frame and logs a diagnostic.
Reconnection replays buffered UUID messages and control frames that use
`request_id`. Frames remain buffered until a reconnect reports a last-received
UUID; confirming that UUID evicts it and every earlier buffered frame. A buffer
containing only control frames has no per-control acknowledgement key, so those
frames can replay again on later reconnects.

These are transport-level guarantees. They do not make an unavailable remote
service durable, and the direct-connect/remote-control launch commands are
source-only in the normal external bundle as described in chapter 11.

## Checkpoints, rewind, branches, and side chats

File-history snapshots are captured as agent edits occur.

```text
/rewind
/checkpoint
/branch try-other-approach
/fork try-other-approach
/btw what's the difference between execa and spawn?
```

`/rewind`/`/checkpoint` can restore conversation state, UR-managed file
snapshots, or both. These snapshots are separate from git commits.

`/branch`/`/fork` copies the persisted main-chain conversation into a new
session ID and switches to it; the optional argument is the branch session
title. `/btw` manages a durable side chat without replacing the main chain.

## Export and inspection

```text
/export session.txt
/copy
/trace
/agent-inspect
/cost
/stats
/usage
/insights
```

`/export [filename]` renders the same plain-text transcript for both supported
filename suffixes. Explicit `.txt` and `.md` suffixes are preserved, so
`/export session.md` writes `session.md`; `.md` does not select a separate
Markdown renderer. A missing suffix or any other suffix is normalized to
`.txt`. Without a filename, the interactive export dialog offers a generated
`.txt` name or clipboard behavior. File targets must be relative to the
workspace, their parent directory must already exist, and traversal or symlink
escapes are rejected.

`/cost` reports the in-memory current-session cost/duration for API-key/local
usage. For ordinary UR subscription users it reports subscription/overage state
instead of an exact dollar breakdown and is hidden from the slash menu.
`/stats` is an interactive activity view; `/usage` opens the Usage settings tab
for plan limits. They are not aliases for the same data.

`/files` lists the paths in the current read-file cache, but its command is
enabled only for `USER_TYPE=ant`; it is not available in the normal external
build. `/trace` and `/agent-inspect` expose recent/tool and subagent execution
views respectively.

## Detached background agents — shipped

The supported external command family is `ur bg`, not the source-only legacy
`--bg`, `ur ps`, `ur logs`, `ur attach`, and `ur kill` fast paths.

```text
ur bg run "run the full test suite and summarize"
ur bg fanout "audit each package" --agents 3 --worktree
ur bg list
ur bg status <id>
ur bg logs <id> --tail 120
ur bg attach <id>
ur bg steer <id> --message "focus on the failing integration test"
ur bg kill <id>
```

`run` starts one detached child; `fanout` starts the requested bounded number.
`--worktree` is opt-in. `--pr` is also opt-in and is rejected without
`--worktree`; when supplied, it authorizes the background PR/push handoff
configured by the remaining PR flags. `--dry-run` records/plans the task without
spawning its worker.

State, logs, outputs, and idempotent steering inboxes live under the git/project
root's `.ur/background/`. The manifest is lock-protected and atomically
replaced. Steering applies only to queued/running tasks and is bounded to
64 KiB per message and 8 MiB per inbox.

The legacy `--bg` and process-level `ps|logs|attach|kill` fast paths are behind
the `BG_SESSIONS` build feature, which the normal external bundle does not
enable. They must not be documented as the supported npm command syntax.

## In-session tasks

`/tasks` (alias `/bashes`) opens the task dialog for the current process.
`TaskOutput` reads task output and `TaskStop` stops a supported running task.
The five creatable lifecycle implementations in the external runtime are:

- local shell;
- local agent;
- remote agent;
- in-process teammate; and
- dream.

`local_workflow` and `monitor_mcp` remain parseable/renderable historical task
types, but have no constructor or stop lifecycle in this distribution. A stop
request for them returns an explicit unsupported-type error.

## Multi-directory access and trust

- `/add-dir ../other-repo` or `--add-dir` extends the allowed working
  directories; normal path/permission checks still apply.
- Interactive startup asks whether the workspace is trusted. Print mode skips
  that dialog and therefore must be used only in a directory the caller already
  trusts.
- `/ur-init` scaffolds UR project assets under `.ur/`; `/init` generates the
  agent-instruction file (`UR.md`).
