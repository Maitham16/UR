# UR Eval Harness

Replayable agent evals — the terminal-native analogue of SWE-bench / Terminal-Bench.

Each suite is a JSON file with cases: a prompt plus machine-checkable
expectations (contains / notContains / regex / verdict / maxOutputChars),
grouped by category.

Commands:

- `ur eval list` — list suites
- `ur eval validate <suite>` — validate a suite file
- `ur eval run <suite>` — run every case through a headless `ur -p` and grade it
- `ur eval run <suite> --metrics` — persist cost, tokens, model, time, diffs, test results, command failures, and human-edit heuristics
- `ur eval run <suite> --dry-run` — exercise the suite offline (no model calls)
- `ur eval run <suite> --category coding` — run only one category
- `ur eval report <suite>` — re-print the last run's report
- `ur eval dashboard` — render the local task timeline with commands, diffs, tests, model, tokens, time, and cost
- `ur eval bench list` — show supported benchmark adapters
- `ur eval bench swe-bench --file local.jsonl --name local-swe` — import a local benchmark export as a UR suite

Reports are written to `.ur/evals/.results/` (keep them out of Git if you prefer).
