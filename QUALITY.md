# UR Quality Notes

UR is a local-first terminal coding agent. Development and release verification
use the repository's pinned Bun and documented build tools from a clean checkout.
The standalone application for macOS/Linux ARM64 and x64 includes its runtime and is qualified without
external Node.js, npm, or Bun. Users select a provider separately; Ollama is
required only when using its local/server backend.

## Release Gate

Run these commands before tagging or pushing a release:

```sh
bun run typecheck
bun run lint
bun test
bun run bundle
bun run smoke
bun run secrets:scan
bun run dependencies:audit
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

`bun run dependencies:audit` checks the committed `bun.lock`, including
development dependencies that are compiled into `dist/cli.js`. `bun run
release:check` repeats that audit and is also wired into `prepack`, so unreviewed
dependency advisories, stale bundles, and version drift fail before packaging.
The current `node-forge@1.4.0` RSA advisory has no upstream fixed npm release;
UR verifies a narrowly scoped backport, exact source/patch hashes, seven RSA
behavior checks, and its review deadline. The raw registry advisory remains
visible in the source dependency audit. Source installs need Bun's patch;
the official npm package has no dependencies and launches the verified native
application. Every shipped native CLI must pass the bundled verifier self-test.
See the [reviewed backport record](patches/README.md); this exception does not
permit unrelated advisories or audit network/format failures.
The GitHub workflow must keep production
bundle, release, package, and global-install checks after the Bun test step;
do not tag or publish until that workflow is green.

## Documentation Gate

Public feature releases should update the full documentation set:

- root README
- `CHANGELOG.md`
- `docs/`
- static site files under `documentation/`
- examples
- extension or marketplace docs when affected

## Standalone release gate

The native release includes its runtime and required resources. Qualification
must execute the archived installation with no external Node, npm, Bun, source
checkout, or node_modules available. The four-target macOS/Linux native workflow checks
resource integrity, images, search, compiler libraries, protocol contracts, real
streaming/task/write/read behavior, restart/resume, and timeout cleanup before
publication. Windows native distribution is unavailable in 1.86.2. Native
installer tests cover checksum/path rejection, locking, and failed activation
preserving the old CLI; retained Windows development tests are outside the
public release qualification.

## Runtime Assumptions

- Native and Homebrew UR embed Bun. The official npm package uses Node.js
  `>=22.12` to cache and launch the exact native release, with no dependencies,
  lifecycle scripts, or separate Bun. Source development uses the pinned Bun.
- The Ollama backend defaults to `http://localhost:11434/api` when selected;
  it may expose local models or Ollama Cloud-backed models. A new workspace
  requires an explicit provider/model choice.
- Selecting an API provider (OpenAI, Anthropic, Gemini, OpenRouter) makes UR
  call that provider's API directly, using a key stored via `ur connect`
  (OS keychain) or read from an environment variable. Keys are never written
  to settings files.
- Selecting a subscription CLI provider (Codex CLI, Claude Code, Gemini CLI,
  Antigravity) dispatches turns through the vendor's official CLI. There is no
  silent cross-provider fallback.
- Source and GitHub-source package installs run `dist/cli.js`, so the bundle
  must match the package version. The official npm artifact is assembled from
  the tested native manifest; its first launch verifies and caches that pinned
  payload. GitHub native and Homebrew installs run the same compiled application
  and matching resources. Each package manager retains ownership of updates.

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
  settings files; tracked and untracked non-ignored release-candidate files are
  scanned by `bun run secrets:scan`.

## Known Limits

- `dist/cli.js` is generated and must be rebuilt after source, version, or macro
  changes.
- Model discovery requires a reachable configured endpoint and usable provider
  credentials when authentication is required. A discovery failure does not
  supply a workspace's deliberate model choice.
- MCP servers can access external systems; only enable servers you trust.
- Live model behavior should be validated manually with `docs/VALIDATION.md`
  before major releases.
