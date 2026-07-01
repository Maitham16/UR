---
description: Review the working diff against a base ref. Returns a structured report.
argument-hint: "[base-ref] (default: main)"
---

Determine the base ref: if `$ARGUMENTS` is non-empty, use it; otherwise use
`main` if it exists, otherwise `master`, otherwise `HEAD~5`.

Run the diff:

```sh
git diff <base>...HEAD
```

If the diff is empty, say "No changes to review against `<base>`." and stop.

Otherwise produce a markdown report with these sections, in order. Skip any
section that has no findings rather than padding it.

### Correctness
Logic errors, missed edge cases, null / empty / boundary handling, off-by-one,
concurrency bugs, error paths that don't propagate. For each, name the file
and line and quote the problematic snippet.

### Style and consistency
Inconsistent naming with the rest of the file, dead or unreachable code,
duplicated logic, abstraction that obscures rather than clarifies, comments
that contradict the code.

### Test coverage
Was test-shaped code touched? Are there tests for the new behaviour? Flag
any change to public surface area with no matching test change.

### Security
Injection risks (SQL, shell, path), secret / token leakage in logs or
errors, unsafe deserialization, missing input validation at trust
boundaries, permissive permission grants.

### TL;DR
End with one line, exactly one of:

- `TL;DR: Looks good.` — no findings or only nits, nothing blocking.
- `TL;DR: Has nits.` — one or more cosmetic findings, nothing blocking.
- `TL;DR: Has blockers.` — at least one correctness or security finding
  that should be fixed before merging.

Do not editorialize about the author. Review the code, not the person.
