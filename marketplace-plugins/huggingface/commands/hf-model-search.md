---
description: Find Hugging Face models for a task and rank the strongest candidates.
argument-hint: "<task or capability> (e.g. 'speech-to-text arabic, small')"
---

Find models on the Hub for `$ARGUMENTS`. If empty, ask for a task and stop.

1. Parse the task and any constraints in the request: language, parameter
   budget, license requirement, modality.
2. Search the Hub for matching models.
3. Rank the top 5 by fit to the task, then downloads, likes, and recency. For
   each, give: `id`, task/pipeline, size or parameter count, license, and a
   one-line reason it fits or does not.
4. Note gated or non-commercial models explicitly.

End with a single recommended pick and one sentence on why it beats the runners-up.

Prefer the `huggingface` MCP tools (`model_search`, `model_details`); otherwise
query the Hub search API. Apply the selection criteria in the
`huggingface-workflow` skill.
