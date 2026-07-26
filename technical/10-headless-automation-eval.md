# 10 — Headless Use, Automation & Evaluation

Source of truth: `src/main.tsx` (print mode);
`src/commands/{exec,sdk,eval,ci-loop,test-first,trigger,automation,cloud,bg,learn,context-pack,agent-ci,desktop-qa,workspace,arena}`;
`src/services/agents/{headlessAgent,ciLoop,testFirstLoop,evals,trajectory,benchmarkSuites,triggerBridge,scheduler,cloudTasks,cloudManagedRunner,agentControl,learnedPlaybooks,agenticCi,workspaceCoordinator,arena}.ts`;
`src/services/{context/memoryCitations,qa,sideChats}/`; `src/sdk/`;
`src/entrypoints/sdk/`; and `scripts/benchmark-*.mjs`.

## Print mode (`-p`)

```
ur -p "summarize the failing tests"
ur -p "…" --output-format json          # structured result
ur -p "…" --output-format stream-json   # streaming events (add --include-partial-messages)
cat prompts.jsonl | ur -p --input-format stream-json --output-format stream-json --replay-user-messages
ur -p "…" --max-turns 5 --fallback-model llama3.3 --no-session-persistence
```
The trust dialog is skipped in `-p` — only run it in directories you trust.
Hook lifecycle events can be included with `--include-hook-events`.

## Batch execution (`/exec`, `ur exec`)

Multiple prompts, optional concurrency and worktree isolation
(`src/commands/exec/index.ts`):
```
ur exec "fix lint errors" "update snapshots" --concurrency 2
ur exec --file prompts.jsonl --max-turns 20 --model qwen2.5-coder:7b \
        --output-dir ./runs --worktree --json
ur exec "risky idea" --dry-run
```

## SDK / programmatic use (`/sdk`, `src/sdk/`)

```
/sdk info      # show headless patterns (spawn `ur -p`, stream-json protocol, MCP serve)
/sdk init      # scaffold TypeScript + Python SDK example projects
```
`src/entrypoints/agentSdkTypes.ts` is an internal type barrel used by the CLI;
it is not a runtime npm SDK. The supported embedding contract is the generated
subprocess example from `/sdk init` using `ur -p` plus stream-json. `ur mcp
serve` exposes UR as an MCP server so other agents/apps can drive it; `ur
server` exposes an HTTP session API (see doc 02).

## CI loop (`/ci-loop`, alias `/heal`)

Run a command, let the agent fix failures, rerun until green — or prove cannot-fix with
command evidence (`src/services/agents/ciLoop.ts`):
```
/ci-loop --command "bun test" --max-attempts 3
/ci-loop --command "bun test" --cwd ./packages/app
/ci-loop --command "npm run build" --commit --push
/ci-loop --from-log ci-output.log        # start from an existing failure log
/ci-loop --dry-run --json
```
Flags `--allow-generated`, `--allow-delete` widen what the fixer may touch.
`--commit` and `--push` are explicit opt-ins; the default run publishes
nothing. The result always prints the actual working directory. Failure
summaries retain nearby assertion and stack context while excluding passing
test names that merely contain words such as "failed". A "No tests found"
failure stops after the first attempt without starting a fix agent; run from
the test root or pass `--cwd <path>`.
Runs inside `/devcontainer` target when configured (doc 12).

## Test-first loop (`/test-first`, aliases `/quality-loop`, `/tf-loop`)

```
/test-first detect            # detect stack: compiler, test runner, linter
/test-first run --max-attempts 3
/test-first install --install-gates   # edit-time verify gates (verifier projectGates)
```

## Webhook triggers (`/trigger`, alias `/mention`)

Parse a GitHub or Slack webhook payload and optionally launch a headless run
(`triggerBridge.ts`):
```
/trigger parse --file payload.json --source github --keyword /ur
/trigger run --file payload.json --dry-run --json
```

## Scheduled automations (`/automation`)

Cron-style project automations with host-scheduler installation (doc 08):
```
/automation create nightly --schedule "0 3 * * *" --prompt "run tests and summarize"
ur automation install --platform systemd --interval 300
ur automation run-due --now 2026-07-09T03:00:00Z
```
In-session recurring runs: `/loop 10m /ci-loop` (bundled skill, cron tools).
Remote scheduled agents: `/schedule` skill + `RemoteTrigger` tool (feature-gated).

## Eval harness (`/eval`, aliases `/evals`)

Public eval harness (`src/services/agents/evals.ts`) with project suites under
`.ur/evals/`:
```
/eval init                     # scaffold a suite
/eval list · /eval validate my-suite
/eval run my-suite --model llama3.3 --repeat 3
/eval report my-suite --dashboard
/eval compare my-suite model-a model-b
/eval route "which strategy for this suite?"
/eval leaderboard
```

Cases run in fresh detached worktrees by default. `--no-isolate` is an
explicit opt-out. A case can add `expect.trajectory` rules for required,
forbidden, ordered, and successfully completed tools, plus tool-call,
failure, repetition, permission-denial, and turn limits. Stream-JSON capture
stores only control-flow metadata: normalized tool names, opaque call IDs,
success flags, counts, and the terminal result. It does not retain prompts,
assistant prose, paths, tool inputs, or tool outputs.

Use a saved report as a CI gate:

```
ur eval run starter
ur eval gate starter \
  --min-pass-rate 1 \
  --min-trajectory-score 0.9 \
  --min-test-pass-rate 1
```

Cost, duration, and baseline-regression ceilings are also supported. A
requested metric that is absent fails closed rather than being silently
skipped.

### Built-in benchmark suites (`benchmarkSuites/`)
`builtin-bug-fix` (off-by-one, null-guard, missing-await),
`builtin-refactor` (extract-function, rename-fields, remove-duplication),
`builtin-test-gen` (calc, string-utils, async),
`builtin-docker-repair` (base-image-typo, missing-cmd, cache-layer-order),
`builtin-ts-migrate` (add-types, null-types, module-types),
`builtin-py-package-repair` (missing-dep, missing-pyproject, entrypoint).
```
/eval builtin bug-fix --json
```

### External benchmark adapters
`/eval bench <adapter>` plus npm scripts:
```
npm run benchmark:smoke | benchmark:local | benchmark:compare | benchmark:report
npm run benchmark:swe-bench-lite | benchmark:terminal-bench | benchmark:aider-polyglot
```
Results are stored under `benchmarks/results/<version>/` against
`benchmarks/result.schema.json`.

## Learning loop

`/learn run --reflect` mines `.ur/artifacts` + CI outcomes into per-category/per-model
success-rate stats and lessons; `/learn apply` biases `escalate`, `arena`, and
`model-route` decisions (doc 05).

## Frontier automation contracts

The following ten capabilities share a fail-closed design: untrusted task text
never becomes policy, publishing remains explicit, and outputs are bounded and
reviewable.

### 1. Managed cloud fan-out

```
ur cloud environments
ur cloud run "repair the parser race" \
  --runner managed --environment <id> --attempts 3
ur cloud sync
ur cloud show <task-id>
ur cloud logs <task-id> --tail 200
ur cloud cancel <task-id>
```

Each candidate has an isolated managed session. UR persists bounded,
secret-redacted lifecycle state, cursors, branches, and logs under
`.ur/cloud/`. Managed selection is eligibility ordering, not comparative
quality judging: a candidate must terminate successfully, explicitly return
`PASS`, and expose a safe non-empty review branch. Eligible candidates are
ordered deterministically. UR does not fetch, merge, or apply a managed branch.
Cancellation is terminal and also cancels a remote session that completes its
start concurrently with the cancel request.

### 2. Live steering

```
ur cloud steer <task-id> \
  --message "preserve the public API" --request-id review-1
ur bg steer <task-id> \
  --message "also cover timeouts" --request-id timeout-1
```

Managed steering is accepted only while at least one candidate session is
active. Messages are bounded to 64 KiB. The request ID is reserved before
network delivery, persisted with a message digest, and deduplicated so retries
cannot deliver the same request twice; reusing an ID for different text is
rejected. Local background agents use a bounded inbox. Authenticated A2A
steering additionally requires task ownership and a running background task.

### 3. Evidence-backed learned playbooks

```
ur learn playbooks mine --min-runs 3
ur learn playbooks list --status candidate
ur learn playbooks show <id>
ur learn playbooks approve <id> --name parser-repair
ur learn playbooks run <id> --max-concurrency 2
ur learn playbooks reject <id> --reason "insufficient evidence"
ur learn playbooks disable <id>
```

Mining groups repeated successful run trajectories and requires command proof
plus a confidence floor. Secret-like, destructive, publishing, deployment,
and unsafe traces are excluded. A candidate cannot execute until explicit
approval materializes a validated normal workflow under `.ur/workflows/`.
Approval revalidates every evidence digest. Rejection is terminal. Disabling
an approved playbook verifies that the materialized workflow was not changed,
moves it to a private `.ur/learning/disabled/*.yaml.disabled` archive, and
prevents future runs.

### 4. Citation-validated task memory

```
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

File excerpts and run artifacts are captured with SHA-256 digests and safe
path/size checks. Resolution excludes rejected, superseded, missing, and stale
entries by default. User-message and web citations remain `unverifiable`
until their source is explicitly reopened; searching memory never performs a
network request. Prompt-facing memory is source-labelled and byte-bounded.

### 5. Patch-only Agentic CI

```
ur agent-ci init default
ur agent-ci validate default
ur agent-ci workflow default --force
ur agent-ci run default \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" \
  --output-dir "$RUNNER_TEMP/ur-agentic-ci"
```

The generated GitHub job has read-only permissions, uses commit-pinned actions,
checks out a trusted base with credentials disabled, and accepts issue-comment
tasks only from configured repository associations. Event JSON is read from a
bounded file and treated as untrusted data. The agent works in a detached
worktree and is instructed not to commit or publish. It receives no platform
write token, and the only deliverable is a reviewable patch artifact.

Path allow/deny rules, deletion policy (including rename sources), generated
files, self-review, guardrails, and the patch-size limit run before repository
verification commands. Changed paths come from exact NUL-delimited,
no-rename Git records, so tabs/newlines are data rather than delimiters;
malformed statuses, unsafe paths, and Git/parser failures block the run.
Checks receive an allow-listed environment, isolated home/temp directories,
and no provider, platform, package-manager, proxy, or user-config credentials.
UR snapshots the staged patch, unstaged diff, tracked/untracked status, and
index visibility flags immediately before and after checks. Any verifier
mutation blocks the run and suppresses the patch. On an unchanged tree, the
emitted hash-addressed patch is recaptured after verification and bound to
`verificationStateSha256`. The manifest and redacted check tails are the only
other outputs. Publishing requires a separate trusted job or human review.

### 6. Trajectory-aware eval gates

Trajectory constraints and the fail-closed `ur eval gate` behavior are
described in [Eval harness](#eval-harness-eval-aliases-evals). Keep trajectory
rules about observable control flow; never encode secrets or expected prompt
text in them.

### 7. Electron desktop QA

```
ur desktop-qa init
ur desktop-qa validate .ur/desktop-qa/fixtures/smoke.json
ur desktop-qa doctor
ur desktop-qa run .ur/desktop-qa/fixtures/smoke.json
```

Fixtures provide bounded click, fill, key, selection, checkbox, wait,
text/visibility assertion, and screenshot steps. The driver closes the
application on every path, redacts secret-like diagnostics, hashes evidence,
and exits non-zero on a failed assertion. Screenshot `redactSelectors` are
rendered as opaque masks. Raw video and trace data cannot guarantee those
masks, so validation refuses `recording.video` or `recording.trace` whenever
selector redaction is configured. To record raw video/trace, remove selector
redaction deliberately and treat the resulting artifact as sensitive.
Evidence persistence copies only bounded regular non-symlink files into the
artifact store and records their hashes. The loopback artifact server resolves
downloads inside that store, sends `private, no-store` and sandbox CSP headers,
serves only a small image/video MIME allow-list inline, and forces every other
declared type to `application/octet-stream` attachment delivery.

### 8. Durable side chats

```
/btw Why does this parser use a sentinel?
/btw continue <chat-id> What invariant does it protect?
/btw list
/btw show <chat-id>
/btw rename <chat-id> Parser notes
/btw close <chat-id>
```

Each question remains a one-turn, tool-free fork, so it does not block or alter
the main task. Exchanges are persisted atomically in private per-project
session storage, linked to the parent session/message, and protected by a
per-turn SHA-256 chain. Chats survive CLI restarts and support continuation,
rename, inspection, and close. Chat count, turn count, individual content, and
store size are bounded; closed chats cannot accept new turns, and cancellation
aborts the forked request.

### 9. Multi-repository workspace coordination

```
ur workspace init checkout
ur workspace add checkout api ../api --base main --verify "bun test"
ur workspace add checkout web ../web --base main --verify "bun test"
ur workspace task checkout api-contract --repo api \
  --prompt "add the response field"
ur workspace task checkout web-client --repo web \
  --prompt "consume the response field" --depends-on api-contract
ur workspace validate checkout
ur workspace run checkout --max-concurrency 4
ur workspace verify checkout
ur workspace pr-plan checkout
ur workspace rollback-plan checkout
```

Enrollment records the canonical repository root and a digest of its remote
identity. A validated dependency DAG controls execution order; dependencies
wait, while tasks that target the same repository serialize behind one writer.
Repositories keep independent base refs and isolated worktrees. Durable state
under `.ur/workspaces/` refuses resume after the spec changes. Verification
uses each repository's declared commands. PR and rollback operations only
print dependency-ordered plans; they execute no GitHub or destructive command.

### 10. Verified model-judged arena

```
ur arena "repair the cache race" --agents 3 \
  --judge hybrid --judge-model <model> \
  --verify "bun run typecheck" --verify "bun test"
```

Candidates run in detached worktrees and are eligible only with an explicit
`PASS`, a non-empty bounded patch, no blocking safety finding, and successful
verification. `deterministic`, `model`, and `hybrid` judging are available.
The one-turn model judge has no tools or session persistence and sees only
bounded, secret-redacted, anonymous eligible candidates. Oversized diffs and
invalid or out-of-set schema results produce no winner. `--apply` writes a
hash-addressed patch only after confirming that the original worktree is
still clean and at the exact base commit.
