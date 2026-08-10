# Coding task

```text
> add a /health route to server.ts and a test for it
```

UR plans, reads files, edits, and can run tests. Safety + stability:

- Repo-wide identifier refactors can use `ur repo-edit`: build an index,
  map compiler/graph change impact, preview the AST-aware patch, then apply
  with a check command that rolls back touched files on failure.
- Stack-aware quality loops can use `ur test-first`: detect compile/test/lint
  commands, store failed command traces, and install the same commands as
  after-edit verifier gates.
- Risky commands can be previewed with `ur safety`: classify read/write/execute
  and network permission, require approval for destructive operations, and
  block common secret exfiltration paths.
- Architecture context can be preserved with `ur context-pack`: scan manifests,
  record decisions/constraints/commands/diffs, and compress old context.
- Edits are diffable: `/diff` shows uncommitted changes; `/rewind` rolls back.
- Every tool call is recorded to `.ur/actions.jsonl` — see `/actions`, `/evidence`.
- `/stability metrics` and `/stability firewall` surface oscillation, repeated
  failures, latency spikes, and blast-radius from the action ledger.
- `/stability why "<error>"` ranks likely root causes of a failure.
- Writes outside the workspace and destructive commands require approval.

```sh
ur repo-edit index
ur repo-edit impact healthHandler --depth 5
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
ur test-first detect
ur test-first --dry-run
ur test-first install
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --diff "Added the health route and tests"
ur context-pack compress
```
