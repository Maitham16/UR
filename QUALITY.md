# UR Quality Notes

UR is a local-first terminal coding agent. Production releases should be
verifiable from a clean checkout and should not depend on local machine state
other than Bun and the local Ollama app.

## Release Gate

Run these commands before tagging or pushing a release:

```sh
bun run typecheck
bun test
bun run bundle
bun run smoke
bun run secrets:scan
bun run release:check
npm pack --dry-run
```

`bun run release:check` is also wired into `prepack`, so stale bundles and
version drift fail before packaging.

## Runtime Assumptions

- UR runs through Bun.
- Model requests go to the local Ollama app at `http://localhost:11434/api`.
- The local Ollama app may expose local models or Ollama Cloud-backed models.
- UR does not call model provider APIs directly and does not manage model API
  keys.
- The GitHub install path runs `dist/cli.js`, so the bundle must match the
  package version.

## Safety Boundaries

- Sensitive tool actions go through permission checks.
- Dangerous auto-allow rules for shell, PowerShell, and subagents are blocked
  from classifier-backed auto mode.
- The verifier runs deterministic L1 checks for false completion claims,
  repeated tool loops, empty assistant turns, and project gates.
- Deep verification through the verification subagent is manual by default and
  can be enabled with `UR_VERIFIER_AUTO_SUBAGENT=1`.
- Secrets must stay in environment variables, secure storage, or local ignored
  settings files; tracked files are scanned by `bun run secrets:scan`.

## Known Limits

- `dist/cli.js` is generated and must be rebuilt after source, version, or macro
  changes.
- A failed Ollama model-list lookup falls back to `qwen3-coder:480b-cloud`.
- MCP servers can access external systems; only enable servers you trust.
- Live model behavior should be validated manually with `docs/VALIDATION.md`
  before major releases.
