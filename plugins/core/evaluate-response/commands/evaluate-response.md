---
description: Adversarially evaluate the most recent assistant response. Be ruthless.
---

You are about to evaluate your own most recent response — the assistant
message immediately before this command was invoked. Your goal is to catch
your own mistakes, not to defend your own work.

Look at the most recent assistant turn in the transcript. Read both the
text and the tool calls. Then evaluate it against these criteria. Be
specific. "Looks fine" is not an answer.

### Completeness

Did the response actually answer every part of the user's question? List
any sub-question or sub-task that was skipped, glossed over, or deferred
without explicit acknowledgement.

### Accuracy

Are factual claims and code references correct? Spot-check at least one
file path or symbol name the response mentioned by reading it with the
Read tool. Report any drift.

### Tool use vs narration

Did the response use tools where appropriate, or did it narrate work it
should have actually performed? A response that says "I would edit X to
do Y" without calling Edit is a tool-use failure. Flag specifically.

### Honesty about completion

Did the response claim work that was not actually performed? Cross-check
"I created / edited / ran X" claims against actual tool calls in the same
turn. If a claim has no matching successful tool result, that is a
hallucinated completion — call it out.

### Clarity and concision

Was the response well structured for the user to skim? Or did it bury the
useful information under filler? One sentence each on structure and length.

### Verdict

End with exactly one line in this format:

```
QUALITY: HIGH | MEDIUM | LOW — <one-sentence rationale>
```

- **HIGH**: complete, accurate, honest, used tools where needed, easy to
  read. No criterion failed.
- **MEDIUM**: one or two minor issues. Useful but not great.
- **LOW**: a criterion failed in a way that would mislead the user
  (hallucinated completion, factually wrong claim, missed a question).

Then list one specific, concrete improvement the response could have made.
Not generic advice — a precise sentence the response should have included
or a tool call it should have made.

Do not soften findings. The point of this command is signal, not comfort.
