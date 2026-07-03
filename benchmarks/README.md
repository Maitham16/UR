# Benchmarks

This directory stores reproducible benchmark report structure, not claimed
leaderboard numbers. Reports under `benchmarks/results/<version>/` must come
from real local eval or test runs.

## Report Schema

Each result follows `benchmarks/result.schema.json` and records:

- agent version and git commit when available
- date
- model and provider
- benchmark name and category
- task count and pass rate
- failed tasks and failure categories
- wall time
- token usage and cost when available
- local environment
- exact command used to reproduce the run

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
  benchmarks/results/1.37.2/local-smoke.json \
  benchmarks/results/1.37.2/local-regression.json
```

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
surface. Do not copy `TEMPLATE.json` as a result without replacing placeholders
with output from a real run.

## Optional External Integrations

These commands are integration stubs. They skip safely when the external
benchmark tool is not installed or configured, and they do not create checked-in
results unless a developer runs the real benchmark and converts its output.

```sh
bun run benchmark:swe-bench-lite
bun run benchmark:terminal-bench
bun run benchmark:aider-polyglot
```

Set `SWEBENCH_LITE_COMMAND`, `TERMINAL_BENCH_COMMAND`, or
`AIDER_POLYGLOT_COMMAND` to point at a local benchmark runner when the default
command name is not on `PATH`. Convert real outputs with
`bun run benchmark:report`; do not check in placeholder scores.
