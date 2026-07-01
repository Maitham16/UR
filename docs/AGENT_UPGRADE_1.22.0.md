# Upgrading to UR-AGENT v1.22.0

## What's new

v1.22.0 turns `ur eval` into a real agent benchmark tool.

- **Execution metrics** — headless `ur -p` child runs now write a metrics JSON file
  via `UR_EVAL_METRICS_FILE`. The eval runner reads it and also runs
  `git diff --stat` and an optional per-case `expect.testCommand`. Captured
  metrics: cost USD, input/output tokens, model, API duration, files changed,
  insertions/deletions, command failures, human-edit heuristics, and test
  pass/fail.
- **Parallel-safe by design** — each child writes its own metrics file, so
  future parallel eval runs will not corrupt shared cost state.
- **Richer dashboard** — `ur eval dashboard` and
  `ur eval report <suite> --dashboard` generate local HTML dashboards with
  summary cards (pass rate, test pass rate, cost, tokens, files changed, command
  failures, human edits, duration) and a per-case timeline showing model, time,
  cost, tokens, diffs, test result, and output preview.
- **Per-case metrics persistence** — `ur eval run <suite> --metrics` writes
  each case's metrics to `.ur/evals/.runs/<suite>/<case>.json`.
- **Aggregate reporting** — `ur eval report <suite>` now prints totals for cost,
  tokens, files changed, command failures, human edits, duration, and test pass
  rate.

## Quick examples

```sh
# Run the starter suite and print JSON with metrics
ur eval run starter --metrics --json

# Write a single-suite HTML timeline dashboard
ur eval report starter --dashboard

# Generate the combined dashboard across all saved reports
ur eval dashboard

# Import a SWE-bench-style export and run it
ur eval bench swe-bench --file issues.jsonl --name my-bench
ur eval run my-bench --metrics
```

## Upgrade steps

1. Pull the release and run `bun install`.
2. Run `bun run typecheck` and `bun test` to confirm the local state.
3. Rebuild the bundled CLI: `bun run bundle`.
4. No settings or project file migration is required.
