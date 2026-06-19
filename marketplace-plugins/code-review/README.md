# code-review

Adds `/code-review` — a structured review of the working diff against a
base ref.

## Use

```text
/code-review
/code-review main
/code-review v1.2.0
```

If no base ref is given, the plugin tries `main`, then `master`, then
`HEAD~5`.

## What it does

Runs `git diff <base>...HEAD`, then asks the model for a markdown report
with four sections (Correctness, Style, Test coverage, Security) and a
mandatory one-line TL;DR (`Looks good` / `Has nits` / `Has blockers`).

Sections with no findings are omitted, not padded.

## Install

```text
/plugin install code-review@ur-plugins-official
```

## Pair with the verifier

`/code-review` is a *static* read of the diff. The verifier subagent
(`/verify` or auto on every "done") is a *dynamic* check — it actually
runs builds, tests, and lints. They're complementary: code-review catches
things the verifier can't (style, subtle logic), and the verifier catches
things code-review can't (does it actually compile and pass tests).
