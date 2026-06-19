---
description: Find Hugging Face datasets for a topic and assess their fitness.
argument-hint: "<topic or task> (e.g. 'arabic sentiment classification')"
---

Find datasets on the Hub for `$ARGUMENTS`. If empty, ask for a topic and stop.

1. Search the Hub for matching datasets.
2. Present the top 5 with: `id`, size (rows or bytes), available splits,
   modality, and license.
3. Flag fitness concerns the user must check before training: restrictive or
   unclear license, possible PII, language or domain mismatch, tiny or
   imbalanced splits.

End with a single recommended dataset and one sentence on its main caveat.

Prefer the `huggingface` MCP tools (`dataset_search`, `dataset_details`);
otherwise query the Hub search API. Apply the dataset due-diligence checklist in
the `huggingface-workflow` skill.
