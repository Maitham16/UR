# Frontier Agent Workflows

UR 1.48 adds ten production-oriented agent capabilities. They are designed
around explicit trust boundaries: no command in this document silently
publishes, deploys, pushes, opens a pull request, or bypasses permissions.

## Managed cloud workers and steering

Run verified best-of-N worktrees locally, or launch multiple isolated
candidates in a managed UR environment:

```sh
ur cloud environments
ur cloud run "fix the parser race" --runner managed --environment <id> --attempts 3
ur cloud sync
ur cloud show <task-id>
ur cloud logs <task-id> --tail 200
ur cloud steer <task-id> --message "preserve the public API" --request-id review-1
ur cloud cancel <task-id>
```

Managed session IDs, cursors, branches, bounded output, and idempotent steering
receipts survive CLI restarts in the private cloud-task manifest. Managed mode
does not claim comparative quality judging: after every candidate terminates,
UR deterministically ranks candidates that returned PASS with a safe, nonempty
review branch and reports the first eligible branch as the selection. UR never
fetches or merges it automatically. Cancellation remains terminal when a
remote session finishes starting concurrently. Local background agents
support the same bounded steering pattern:

```sh
ur bg steer <task-id> --message "also cover the timeout case" --request-id timeout-1
```

Authenticated A2A compatibility tasks expose owner-isolated mobile steering at
`POST /a2a/tasks/<id>/messages` (or `/steer`) with:

```json
{"message":"run the focused regression test","requestId":"mobile-1"}
```

The task must belong to the authenticated caller and be backed by a running
background agent. Messages are size-bounded, terminal tasks reject new input,
and repeated request IDs are deduplicated.

## Evidence-backed learned playbooks

UR can mine repeated, verified run trajectories into candidates:

```sh
ur learn playbooks mine --min-runs 3
ur learn playbooks list --status candidate
ur learn playbooks show <id>
ur learn playbooks approve <id> --name parser-repair
ur learn playbooks run <id> --max-concurrency 2
ur learn playbooks reject <id> --reason "insufficient coverage"
ur learn playbooks disable <id>
```

Candidates require successful command evidence and a confidence floor. Unsafe,
secret-like, publishing, deployment, or destructive trajectories are excluded.
Promotion is always explicit. Approval materializes a normal validated workflow;
rejected candidates cannot later be approved. Disabling verifies that the
promoted workflow is unchanged, moves it to a private
`.ur/learning/disabled/*.yaml.disabled` archive, and prevents future runs.

## Citation-validated shared memory

Task memory can cite project files, run artifacts, user messages, and web
sources:

```sh
ur context-pack remember --decision "Keep the parser streaming" \
  --cite-file src/parser.ts --lines 20:48
ur context-pack remember --note "Regression passed" \
  --cite-run <run-id>:manifest.json
ur context-pack remember --constraint "Keep the public API" \
  --cite-user <session-id>:<message-id>
ur context-pack remember --note "Protocol requirement" \
  --cite-web https://example.com/spec
ur context-pack memory revalidate
ur context-pack memory search --query "parser streaming"
```

File excerpts and run artifacts carry captured SHA-256 digests. Resolution
excludes rejected, superseded, missing, and stale entries by default and emits
bounded source labels suitable for prompts. User and web citations remain
explicitly unverifiable until their source is reopened; UR does not make a
network request merely because memory was searched.

## Agentic CI and trajectory gates

Create a policy and a pinned, read-only GitHub workflow:

```sh
ur agent-ci init default
ur agent-ci validate default
ur agent-ci workflow default --force
ur agent-ci run default --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" --output-dir "$RUNNER_TEMP/ur-agentic-ci"
```

The agent job checks out a trusted base without persisted credentials, accepts
issue comments only from configured repository associations, consumes event
JSON from a file rather than shell source, scrubs code-subprocess secrets, and
runs in a detached worktree. It emits a bounded, hash-addressed patch, redacted
check tails, and a manifest. Path policy uses exact NUL-delimited Git records,
so control characters cannot alter parsing and rename sources remain visible
as removals. UR hashes staged, unstaged, tracked/untracked, and index-visibility
state before and after checks. Any mutation blocks and suppresses the patch;
otherwise the post-check patch is bound to `verificationStateSha256`.
Publishing belongs in a separate trusted job or a human review step.

Eval cases may declare structured trajectory rules in `expect.trajectory`,
including required, forbidden, ordered, and successfully completed tools;
tool-call, failure, repetition, permission-denial, and turn limits. Captured
events retain control-flow metadata only—never prompts, paths, tool input,
tool output, or assistant text.

```sh
ur eval run starter
ur eval gate starter --min-pass-rate 1 --min-trajectory-score 0.9
```

Eval cases use detached worktrees by default. `--no-isolate` is an explicit
opt-out. A requested gate fails closed when its metric is unavailable.

## Desktop application QA

Desktop QA drives Electron applications through bounded declarative fixtures:

```sh
ur desktop-qa init
ur desktop-qa validate .ur/desktop-qa/fixtures/smoke.json
ur desktop-qa doctor
ur desktop-qa run .ur/desktop-qa/fixtures/smoke.json
```

Fixtures support click, fill, key press, select, checkbox, wait, text/visibility
assertions, and screenshots. Every run closes the application, redacts
secret-like diagnostics, and records bounded evidence with hashes and a JSON
report. Selector redaction is applied to screenshots as an opaque mask. Because
raw video and trace data cannot guarantee that mask, fixtures with
`redactSelectors` must disable both `recording.video` and `recording.trace` or
validation fails closed. A failed assertion exits non-zero, making the command
suitable for CI. Attachment persistence copies only bounded regular
non-symlink files. The loopback viewer serves a small image/video allow-list
inline; every other type becomes an octet-stream download with private/no-store
and sandbox headers.

## Durable side chats

`/btw` now keeps private, hash-chained side-chat history outside the repository:

```text
/btw Why does this parser use a sentinel?
/btw continue <chat-id> What invariant does it protect?
/btw list
/btw show <chat-id>
/btw rename <chat-id> Parser notes
/btw close <chat-id>
```

Each invocation is still a one-turn, tool-free fork, so the main task continues
independently. History, individual turns, chat count, and storage size are
bounded; cancellation reaches the forked request.

## Multi-repository coordination

Define repositories and a dependency DAG, then run one writer per repository
in isolated worktrees:

```sh
ur workspace init checkout
ur workspace add checkout api ../api --base main --verify "bun test"
ur workspace add checkout web ../web --base main --verify "bun test"
ur workspace task checkout api-contract --repo api \
  --prompt "add the checkout response field"
ur workspace task checkout web-client --repo web \
  --prompt "consume the checkout response field" --depends-on api-contract
ur workspace validate checkout
ur workspace run checkout --max-concurrency 4
ur workspace verify checkout
ur workspace pr-plan checkout
ur workspace rollback-plan checkout
```

Enrollment pins each canonical repository root and a hash of its remote
identity. The durable run state refuses resume after the specification changes.
Tasks with dependencies wait; tasks targeting the same repository serialize.
PR and rollback commands are plans only. Every repository retains its own base
branch, while cross-repository dependencies determine review order.

## Verified model-judged best-of-N

Arena candidates are eligible only after a proof-backed `PASS`, a non-empty
bounded diff, safety review, and all configured verification commands:

```sh
ur arena "repair the cache race" --agents 3 \
  --judge hybrid --judge-model <model> \
  --verify "bun run typecheck" --verify "bun test"
```

`deterministic`, `model`, and `hybrid` modes are supported. The model judge sees
bounded, secret-redacted, anonymous candidate material and must return a strict
schema referring only to eligible candidate IDs. A candidate whose full
redacted diff exceeds the judge bound is excluded rather than partially judged.
Invalid judge output yields no winner. `--apply` additionally requires the
original clean worktree and exact base commit to remain unchanged.
