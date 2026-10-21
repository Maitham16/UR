# Benchmarks

This directory stores reproducible benchmark report structure, not claimed
leaderboard numbers. Reports under `benchmarks/results/<version>/` must come
from real local eval or test runs.

## Report Schema

Each result follows `benchmarks/result.schema.json` and records:

- agent version, git commit, dirty source state and source digest when available
- date
- model and provider
- benchmark name and category
- task count and pass rate
- failed tasks and failure categories
- wall time
- token usage and known cost; missing billing stays null
- local environment
- exact command used to reproduce the run
- per-case executable, candidate patch and independent verifier hashes
- explicit completion claims, independently detected false completion, tool calls and budgets
- unknown human-intervention/recovery metrics remain unknown, rather than being inferred from prose

Supported categories:

- `internal-regression`
- `terminal-coding`
- `provider-routing`
- `tool-use`
- `sandbox-safety`
- `swe-bench-lite`
- `terminal-bench`
- `aider-polyglot`
- `custom`

## Generate a Real Report

Run the local regression smoke benchmark:

```sh
bun run benchmark:smoke
```

This writes `benchmarks/results/<version>/local-smoke.json`. It is a real local
regression result over deterministic repository tests for file editing, failing
test repair flow, provider routing, sandbox denial, tool-call parsing, and
multi-step coding support. It is not an external SWE-bench, Terminal-Bench, or
Aider Polyglot leaderboard result.

Run the larger deterministic local regression benchmark:

```sh
bun run benchmark:local
```

This writes `benchmarks/results/<version>/local-regression.json` with at least
20 focused local tasks covering file edits, test repair, refactors, provider
routing, tool-call parsing, sandbox denial, release hygiene, benchmark schema
validation, and multi-step code modification.

Compare two local reports:

```sh
bun run benchmark:compare -- \
  benchmarks/results/$(node -p "require('./package.json').version")/local-smoke.json \
  benchmarks/results/$(node -p "require('./package.json').version")/local-regression.json
```

Only results for the current package version belong in the active checkout.
Published historical results remain available through their immutable Git
tags and releases instead of accumulating as stale workspace snapshots.

Run a UR eval suite and save the report:

```sh
ur eval init
ur eval run starter --metrics --json
```

Convert the saved eval report into a versioned benchmark result:

```sh
bun run benchmark:report -- \
  --input .ur/evals/.results/starter.json \
  --category internal-regression \
  --provider "$UR_PROVIDER" \
  --model "$UR_MODEL" \
  --command "ur eval run starter --metrics --json"
```

For terminal/coding benchmark suites:

```sh
ur eval builtin bug-fix
ur eval run builtin-bug-fix --metrics --json
bun run benchmark:report -- \
  --input .ur/evals/.results/builtin-bug-fix.json \
  --category terminal-coding \
  --provider "$UR_PROVIDER" \
  --model "$UR_MODEL" \
  --command "ur eval run builtin-bug-fix --metrics --json"
```

For local benchmark exports:

```sh
ur eval bench terminal-bench --file ./terminal-bench-export.jsonl --name local-terminal --force
ur eval run local-terminal --metrics --json
bun run benchmark:report -- \
  --input .ur/evals/.results/local-terminal.json \
  --category terminal-bench \
  --provider "$UR_PROVIDER" \
  --model "$UR_MODEL" \
  --command "ur eval run local-terminal --metrics --json"
```

Provider routing, tool-use, and sandbox safety reports should use the matching
category when the eval suite or test harness is intentionally exercising that
surface. Every checked-in result must come from a real run; placeholder reports
do not belong in `benchmarks/results/`.

## Functional suites and independent verification

The six canonical suites in `src/services/agents/benchmarkSuites/*.json` contain
18 original tasks with deterministic starting files. Installing and loading a
suite preserves those files. Every grader runs after the UR process exits:

| Suite | Independent check |
| --- | --- |
| bug-fix | Function calls for boundaries, null/blank inputs, and rejected promises |
| refactor | Public helper/renamed-field behavior and shared validation |
| test-gen | Generated tests pass original code and fail two distinct mutations |
| docker-repair | Actual image build and stdout/HTTP execution; dependency layer ordering |
| ts-migrate | Strict pinned TypeScript compiler, invalid-use rejection and runtime behavior |
| py-package-repair | Fresh virtual environment, package installation, import and console entry point |

Node.js must support `--experimental-strip-types` for the TypeScript tasks.
Docker tasks need a working daemon and registry access. Python tasks require
Python 3.11+, venv/pip and package-index access. Missing prerequisites fail the
check; file existence does not substitute for execution. Verify the graders
against both broken inputs and known repairs:

```sh
UR_REQUIRE_FULL_BENCHMARK_FIXTURES=1 bun test test/builtinVerification.test.ts
```

`expect.testFiles` holds trusted verifier code, written to a private temporary
directory only after the candidate exits. `expect.testCommand` receives its path
through `UR_EVAL_VERIFY_DIR`. Candidate worktrees are outside UR's reserved state
directory. This prevents ordinary candidate edits from replacing a verifier;
it is not isolation against hostile processes running as the same OS user.
Use a container/VM runner when evaluating adversarial tasks.

`--max-turns`, `--timeout-ms` and `--max-budget-usd` bound each native-loop case.
A requested dollar budget stops when pricing becomes unknown. Ollama Cloud
billing is unknown; a zero legacy SDK estimate is not a free-price claim.
`cost_status` tells SDK consumers whether the estimate has known pricing.
`native-agent` means UR's own agent loop, including development execution;
`executableSha256` binds the executable and development bundle where applicable.
`offline-replay` is harness exercise only and must not be presented as model
performance. False completion counts explicit `VERDICT: PASS` claims contradicted
by independently executed checks; it does not classify all possible prose claims.

## External benchmark runners

These entrypoints execute real external programs and retain redacted stdout,
stderr and invocation metadata under `.ur/evals/.external/<run-id>/`:

```sh
bun run benchmark:swe-bench-lite -- --predictions_path ./predictions.jsonl --run_id ur-evaluation
bun run benchmark:terminal-bench -- --ak version=<published-version> -d <dataset> -m <model>
bun run benchmark:aider-polyglot --config ./aider-runner.json
```

The SWE-bench default is the official
`python3 -m swebench.harness.run_evaluation` with the Lite dataset; it evaluates
prepared UR patch predictions and does not generate patches for you. The
Terminal-Bench default is Harbor with `benchmarks.harbor.ur_agent:UrAgent`, which
installs a pinned native UR release. See the [Harbor adapter](harbor/README.md)
for a complete task qualification and environment configuration.

Aider Polyglot requires an explicitly configured runner that invokes UR.
Running Aider itself does not measure UR. A runner configuration is JSON:

```json
{
  "benchmark": "aider-polyglot",
  "command": "/absolute/path/to/your-ur-polyglot-runner",
  "args": ["--tasks", "./polyglot-tasks"],
  "cwd": ".",
  "env": ["OPENAI_API_KEY"]
}
```

`env` lists required existing variable names; credentials stay in the environment.
Arguments are passed directly, without shell interpolation. `--` passes remaining
arguments unchanged to the runner, including its own `--config`. `--dry-run`
prints the plan. Missing programs fail by default; explicit `--allow-missing`
marks the invocation skipped. A completed process has `measured: false` until
independent per-task scores are examined; it is not automatically a leaderboard
result.

`ur eval bench` imports task descriptions for local use. Imported tasks require
an explicit `test_command` (and optionally `test_files`) or a configured
`expect.testCommand` after import. Plausible prose cannot pass an unconfigured
benchmark task. These local imports do not recreate official dataset environments
and must not be reported as official benchmark scores. Official scoring belongs
to the corresponding dataset harness.

Primary runner contracts: [Harbor custom agents](https://docs.harborframework.com/agents/custom-agents),
[Harbor jobs](https://docs.harborframework.com/jobs/run-a-job), and
[SWE-bench evaluation](https://www.swebench.com/SWE-bench/guides/evaluation/).

### Native candidate measurement

[`native-minimax-bug-fix.json`](https://github.com/Maitham16/UR/blob/v1.87.0/benchmarks/results/1.87.0/native-minimax-bug-fix.json) records
three built-in bug-fix tasks against the actual macOS ARM64 native candidate with
MiniMax through Ollama Cloud: 3/3 passed, zero observed false completions, 168,017 ms,
1,003,121 input and 14,139 output tokens. Billing is unknown (`null`), not free.
The report retains its dirty source fingerprint and exact executable SHA-256;
it is candidate evidence, not a measurement of the later immutable release tag.
The source checkout path is redacted. The reproduction command uses the same
public suite and limits; configure Ollama with the named model first. These three
internal tasks do not establish frontier-agent parity or an external leaderboard
score. SDK-reported turns count usage units and may differ from loop-limit units.
