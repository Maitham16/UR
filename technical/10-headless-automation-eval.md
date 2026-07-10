# 10 — Headless Use, Automation & Evaluation

Source of truth: `src/main.tsx` (print mode), `src/commands/{exec,sdk,eval,ci-loop,test-first,trigger,automation}`,
`src/services/agents/{headlessAgent,ciLoop,testFirstLoop,evals,benchmarkSuites,triggerBridge,scheduler}.ts`,
`src/sdk/`, `src/entrypoints/sdk/`, `scripts/benchmark-*.mjs`.

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
/ci-loop --command "npm run build" --commit --push
/ci-loop --from-log ci-output.log        # start from an existing failure log
/ci-loop --dry-run --json
```
Flags `--allow-generated`, `--allow-delete` widen what the fixer may touch.
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
/eval run my-suite --model llama3.3 --strategy auto --repeat 3
/eval report my-suite --format html --dashboard
/eval compare run-a run-b
/eval route "which strategy for this suite?"
/eval leaderboard
```

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
