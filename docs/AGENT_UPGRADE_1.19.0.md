# UR-AGENT 1.19.0 Upgrade Notes

UR 1.19.0 adds two P0 agent reliability surfaces: project safety policy and
project context packing.

## What Changed

- `ur safety status|init|check` evaluates shell command risk before execution.
- Bash permission checks consult the project safety policy before broad allow
  rules and sandbox auto-allow.
- The safety policy separates read, write, execute, and network permission
  classes.
- Destructive commands require approval.
- Write, execute, and network operations receive sandbox guidance.
- Common secret-file and secret-like environment exfiltration paths are denied.
- `ur context-pack scan|remember|compress` writes a manifest-backed repository
  architecture summary and durable task memory.

## New Project Files

- `.ur/safety-policy.json` from `ur safety init`
- `.ur/project-manifest.json` from `ur context-pack scan`
- `.ur/context/architecture.md`
- `.ur/context/task-memory.jsonl`
- `.ur/context/compressed.md`

Commit only shared policy and architecture files that are safe for teammates.
Keep local task memory private when it contains local decisions, file paths, or
operational notes that should not be shared.

## Validate

```sh
ur safety status
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --decision "Use manifest commands first"
ur context-pack compress
bun run typecheck
bun test
```
