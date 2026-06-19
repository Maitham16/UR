---
description: Diagnose a failing command. Re-runs it, explains the error, suggests next steps.
argument-hint: "<command-to-rerun>"
---

If `$ARGUMENTS` is non-empty, treat it as the command to investigate. Re-run
it via the Bash tool exactly as given and capture stdout, stderr, and the
exit code.

If `$ARGUMENTS` is empty, scan the most recent transcript turns for the last
failing Bash command (non-zero exit) and use that one. If you cannot find a
recent failure, ask the user to paste the failing command and stop.

Then produce a short, structured diagnosis:

### What the error means

One or two sentences in plain English. Decode jargon. If the error message
is generic ("Error: 1"), say so and rely on the stderr context.

### Most likely cause

The single most likely root cause, given the project context (read
`package.json`, `CLAUDE.md`, or relevant config files only if it sharpens
the diagnosis — do not spelunk for the sake of it).

### Next steps

Two concrete next things to try, ordered by likelihood. Each step is a
shell command or a one-line action, not a paragraph of advice.

If the error is genuinely opaque, list commands that would gather more
information (e.g. re-run with a verbosity flag, check a log file, inspect
the relevant file's mode) instead of guessing.

Do not lecture about general debugging methodology. Stay specific to this
error.
