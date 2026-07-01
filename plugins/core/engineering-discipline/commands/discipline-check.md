---
description: "Check whether a change is ready for reproducible release: plan, patch, tests, verifier evidence, docs, benchmark notes, and rollback path."
argument-hint: "[changed area or release target]"
allowed-tools:
  - "Bash(git status:*)"
  - "Bash(git diff:*)"
  - "Bash(bun run typecheck:*)"
  - "Bash(bun run lint:*)"
  - "Bash(bun test:*)"
  - "Bash(bun run release:check:*)"
---

Audit the current change as a reproducible engineering workflow.

Check whether the work has a clear plan, scoped patch, executed tests, verifier
evidence, documentation updates, benchmark or eval notes when relevant, and a
rollback path. Prefer command evidence over claims. Do not mark the change ready
unless the required commands were actually executed and passed.

Return:

1. Status: READY, BLOCKED, or NEEDS-EVIDENCE.
2. Evidence commands observed.
3. Missing evidence.
4. Release or rollback risk.
