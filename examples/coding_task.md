# Coding task

```text
> add a /health route to server.ts and a test for it
```

UR plans, reads files, edits, and can run tests. Safety + stability:

- Edits are diffable: `/diff` shows uncommitted changes; `/rewind` rolls back.
- Every tool call is recorded to `.ur/actions.jsonl` — see `/actions`, `/evidence`.
- `/stability metrics` and `/stability firewall` surface oscillation, repeated
  failures, latency spikes, and blast-radius from the action ledger.
- `/stability why "<error>"` ranks likely root causes of a failure.
- Writes outside the workspace and destructive commands require approval.
