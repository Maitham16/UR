# UR Quality Notes

UR is a local-first terminal coding agent. Production releases should be
verifiable from a clean checkout and should not depend on local machine state
other than Bun and the local Ollama app.

## Release Gate

Run these commands before tagging or pushing a release:

```sh
bun run typecheck
bun run lint
bun test
bun run bundle
bun run smoke
bun run secrets:scan
bun run release:check
bun run package:check
npm publish --dry-run
```

For project-specific feature work, `ur test-first detect` shows the detected
compile/test/lint command set. `ur test-first install` can persist that command
set into `.ur/verify.json` so future mutating turns run the same gates.

For safety-sensitive changes, `ur safety check --command "<cmd>"` previews
read/write/execute/network permission classes, destructive-command approval,
sandbox posture, and secret exfiltration denial. `ur context-pack scan` records
the repo architecture and manifest-derived command set; `ur context-pack
compress` preserves task decisions, constraints, commands, and diffs.

`bun run release:check` is also wired into `prepack`, so stale bundles and
version drift fail before packaging. The GitHub workflow must keep production
bundle, release, package, and global-install checks after the Bun test step;
do not tag or publish until that workflow is green.

## Documentation Gate

Public feature releases should update the full documentation set:

- root README
- changelog and upgrade notes
- `docs/`
- static site files under `documentation/`
- examples
- extension or marketplace docs when affected

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
- `ur test-first` stores failing compile/test/lint traces under
  `.ur/test-first/traces/` and reports success only from zero-exit command
  evidence.
- `ur safety` asks before destructive commands, recommends sandboxing for risky
  operations, and blocks common secret exfiltration paths before broad shell
  allow rules.
- `ur context-pack` keeps durable architecture summaries and task memory under
  `.ur/context/` so decisions, constraints, commands, and diffs survive context
  compression.
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
