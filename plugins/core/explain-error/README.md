# explain-error

Adds `/explain-error` — diagnose a failing command, in plain English, with
two concrete next steps to try.

## Use

```text
/explain-error bun test
/explain-error
```

With a command argument, re-runs that command and analyzes the failure.
Without an argument, looks back through the transcript for the most recent
failing Bash call.

## What it returns

Three short sections:

- **What the error means** — plain-English decoding of the message.
- **Most likely cause** — the single most plausible root cause given the
  project context.
- **Next steps** — two concrete things to try, ordered by likelihood.

Stays specific to the error in front of it. Does not lecture about debugging.

## Install

```text
/plugin install explain-error@ur-plugins-official
```
