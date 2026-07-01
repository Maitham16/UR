# Upgrading to UR-AGENT v1.21.0

## What's new

v1.21.0 adds a set of worktree-first agent skills and a command to manage the worktrees they create.

- **Agent skill runner** — `src/services/agents/agentSkillRunner.ts` wraps
  `startBackgroundTask({ worktree: true, pr: true })`, polls the background run to
  completion, and returns a PR-style summary with branch, commits, PR URL, and
  diff summary.
- **New bundled slash skills** — each skill expands into a prompt that instructs
  the model to work in an isolated git worktree and produce a clean branch,
  commits, and PR:
  - `/debug-v2` — reproduce, root-cause, and fix a bug with a regression test
  - `/refactor` — safe, test-backed refactoring
  - `/paper-implementation` — implement an algorithm or system from a paper/URL
  - `/benchmark` — add or run benchmarks and commit results
  - `/security-review` — audit code for security issues, fix low-risk items
  - `/dockerize` — add Dockerfile, compose file, health checks, `.dockerignore`
  - `/latex-paper` — generate or compile a LaTeX paper/report
- **Matching agent templates** — `debug-v2`, `refactor`, `paper-implementation`,
  `benchmark`, `security-review`, `dockerize`, and `latex-paper` are now part of
  `AGENT_TEMPLATES`. Install them with `ur agent-templates install`.
- **`ur worktree`** — `ur worktree list|status|clean` inspects and cleans up UR
  agent worktrees.

## Quick examples

```sh
# Run a bug-fix agent in an isolated worktree
ur -p /debug-v2 "parser crashes on empty input"

# Same through the CLI
ur bg run "reproduce and fix parser crash on empty input" --worktree --pr

# List active worktrees and clean up finished ones
ur worktree list
ur worktree clean --dry-run
ur worktree clean

# Install the new agent templates
ur agent-templates install debug-v2 refactor benchmark security-review dockerize latex-paper paper-implementation
```

## For users of `/debug`

The existing `/debug` skill still reads the session debug log. `/debug-v2` is a
separate skill for bug-fix work in a worktree. You can keep using `/debug` for
diagnosing the current session and use `/debug-v2` (or `ur bg run ... --worktree
--pr`) when you want a branch + PR.

## Upgrade steps

1. Pull the release and run `bun install`.
2. Run `bun run typecheck` and `bun test` to confirm the local state.
3. Install agent templates if you want the new `.ur/agents/*.md` files:
   `ur agent-templates install`.
4. No settings or project file migration is required.
