# Research task

```text
> summarize the MAPE-K paper and extract its claims and metrics
```

- `ur research init|source|finding|question|verify|report` builds a durable,
  source-backed evidence map with independent corroboration checks. Free text
  still appends a legacy note.
- `/research-pro <question>` runs the primary-source research workflow.
- `/paper <title|path>` and `/cite <ref>` to record papers and citations.
- `/graph` is the Research Graph (sources, papers, claims, methods, datasets,
  metrics, limitations, citations, concepts, notes, experiments, open_questions,
  links). e.g. `/graph claims local actions reduce oscillation`.
- `/read <file>`, `/summarize <file>`, `/search <query>`, `/index` for files.
- Web fetch degrades gracefully (built-in HTML→text if `turndown` is absent).

```sh
ur research init mapek --question "What does MAPE-K claim and measure?"
ur research source mapek --url https://example.com/paper --title "MAPE-K paper"
ur research finding mapek --text "Atomic finding" --cite S1
ur research verify mapek
ur research report mapek --out docs/research/mapek.md
```
