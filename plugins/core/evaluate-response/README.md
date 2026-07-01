# evaluate-response

Adds `/evaluate-response` — adversarial self-evaluation of the most recent
assistant response.

## Use

```text
/evaluate-response
```

Invoke right after the agent finishes a task to catch hallucinated
completions, missed sub-questions, factual drift, or narrated-but-not-done
work.

## What it returns

A markdown report against five criteria — Completeness, Accuracy, Tool
use vs narration, Honesty about completion, Clarity — plus a mandatory
one-line verdict:

```
QUALITY: HIGH | MEDIUM | LOW — <rationale>
```

And one concrete, specific improvement (not generic advice).

## How it pairs with the verifier

The verifier subsystem catches structural problems automatically (no Write
call but claimed "created the file", same Bash call 3 times in a row, the
build doesn't compile). `/evaluate-response` is for the harder cases the
verifier can't see: did the response actually answer the question, were the
facts right, was the tone honest.

Useful as a manual cross-check before committing what the agent produced.

## Install

```text
/plugin install evaluate-response@ur-plugins-official
```
