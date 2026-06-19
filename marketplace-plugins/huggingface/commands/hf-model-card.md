---
description: Summarize a Hugging Face model card — capabilities, license, limits, footprint.
argument-hint: "<model-id> (e.g. 'meta-llama/Llama-3.1-8B-Instruct')"
---

Summarize the model card for `$ARGUMENTS`. If empty, ask for a model id and stop.

Report, each in one or two lines:
- **Intended use** and the tasks it is actually good at.
- **Training data** and any domain or language scope.
- **License** and commercial terms; whether the repo is gated.
- **Footprint**: parameters, disk size, and available quantizations or formats.
- **Evaluation**: the headline benchmark numbers the card claims.
- **Limitations and bias** the authors disclose.

End with a deployment verdict, exactly one of:
- `GO — fit for production for the stated task.`
- `CAUTION — usable with the noted caveat.`
- `NO-GO — license or capability blocks production use.`
followed by the single deciding reason.

Prefer the `huggingface` MCP tools (`model_details`, `hf_doc_search`); otherwise
read the card from the Hub.
