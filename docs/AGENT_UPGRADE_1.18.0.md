# UR-AGENT 1.18.0 Upgrade Notes

UR 1.18.0 adds the P0 test-first execution loop.

## New Command

```sh
ur test-first detect
ur test-first --dry-run
ur test-first --max-attempts 3
ur test-first install
```

`test-first` is designed for command-evidence-driven repo work:

- Detects project languages, package managers, and quality commands from the
  existing project files.
- Orders detected commands as compile, test, then lint.
- Runs the command set and reports `passed` only when the commands exit 0.
- On failure, stores a trace under `.ur/test-first/traces/` with the command,
  phase, exit code, stdout, and stderr.
- Invokes a bounded fix agent between failed attempts.
- Installs detected commands into `.ur/verify.json` with `ur test-first install`
  so the existing verifier can run them after future edits.

Aliases:

```sh
ur quality-loop --dry-run
ur tf-loop detect
```

## Verification

```sh
bun run typecheck
bun run lint
bun test test/testFirstLoop.test.ts
node ./bin/ur.js test-first --help
node ./bin/ur.js test-first detect
```

If an external project has no lint script, `test-first` reports lint as a
missing phase instead of inventing a command. UR itself now exposes
`bun run lint`, so local quality detection includes compile, test, and lint.
