# git-summary

Adds `/git-summary` — a one-paragraph factual summary of the working tree
and the last few commits.

## Use

```text
/git-summary
```

Useful before standup, before opening a PR, before clocking out.

## What it does

Runs three git commands in parallel:

- `git status --short`
- `git diff --stat`
- `git log -5 --oneline`

Then asks the model to produce a 3–5 sentence factual summary plus a
one-line branch / clean status footer.

## Install

```text
/plugin install git-summary@ur-plugins-official
```
