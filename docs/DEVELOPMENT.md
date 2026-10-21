# Development Guide

## Repository Layout

- `bin/ur.js` launches the bundled CLI through Bun, with a source fallback for development.
- `src/entrypoints/cli.tsx` handles fast startup paths before loading the full CLI.
- `src/main.tsx` defines top-level CLI flags and subcommands.
- `src/commands.ts` registers slash commands and command modules.
- `src/tools/` contains tool implementations.
- `src/services/` contains API, MCP, analytics, sync, safety, context, and
  runtime services.
- `src/components/` and `src/ink/` implement the terminal UI.
- `plugins/core/`, `plugins/community/`, and `plugins/examples/` contain
  shipped plugins, contributed plugin staging, and copyable plugin templates.
- `examples/` contains example prompts and workflows.
- `test/` contains Bun tests for local UR utility modules.

## Install

Windows native and public npm installation are unavailable in 1.87.1. Windows
developers can optionally use this Bun-based source workflow. Windows native
build and test code remains experimental and is outside the public release.
The official macOS/Linux npm package uses a Node launcher and cached native
application without Bun; it is assembled separately from the source package.

```sh
bun install
```

## Run

```sh
bun run start
bun run dev
```

`bun run start` uses `bin/ur.js`. `bun run dev` runs `src/entrypoints/cli.tsx` directly with watch mode and the Bun bundle preload.

## Verify

```sh
bun run typecheck
bun run lint
bun run dependencies:audit
bun test
bun run build
bun run smoke
bun run secrets:scan
bun run release:check
bun run package:check
npm pack --dry-run
npm publish --dry-run
```

Use `ur test-first detect` when adding a feature to inspect the repository's
detected compile/test/lint command set before choosing the final verification
commands for the change.

Use `ur safety check --command "<cmd>"` before documenting or automating risky
shell commands. Use `ur context-pack scan` when a change adds new manifests,
command surfaces, or architecture rules that should be captured as project
context.

The source and GitHub-source package paths use the bundled launcher in `dist/cli.js`, so `bun run bundle` must be run before packaging or pushing a release. `bun run release:check` verifies that `package.json`, `bunfig.toml`, the bundle, docs, and `node ./bin/ur.js --version` agree. The GitHub workflow keeps production bundle, release, package, and global-install checks behind the Bun test step; do not publish, tag, or push release artifacts until that workflow is green.

For a patch release, keep the version synchronized in `package.json`,
`bunfig.toml`, the VS Code extension manifest, the JetBrains Gradle build,
`documentation/index.html`, `technical/README.md`, and `CHANGELOG.md`. Rebuild
`dist/cli.js` after changing the version.

## Native release builds

Public native releases target macOS and Linux on ARM64 and x64. Build on the
target OS/CPU so native addons and shared libraries match:

```sh
bun ci
npm --prefix extensions/vscode-ur-inline-diffs ci
npm --prefix extensions/vscode-ur-inline-diffs run build
bun run native:build
bun run native:pack
bun run native:smoke -- --artifact-dir dist-release/native
```

Use the repository's pinned Bun version (`1.4.3`). The extension build is
required before native packaging because the release includes its local VSIX.
Experimental Windows native development builds need Visual Studio 2022 with
the x64 C++ build tools; the build discovers them with `vswhere` and compiles
the launcher with a static C runtime. No Windows native artifact is published
for 1.87.1. Installed macOS/Linux users do not need a compiler.
The native archive contains the executable and its versioned `resources/` tree.
The release workflow qualifies this exact archive without Node/Bun on PATH.
See [Native installation and recovery](NATIVE_INSTALL.md) and [Release runbook](../RELEASE.md).

## Build

```sh
bun run bundle
```

The build output goes to `dist/cli.js`. The directory is ignored by default, but `dist/cli.js` is intentionally tracked because source and GitHub-source package installs run the bundled CLI. The official npm release is assembled by `scripts/npm-native-package.mjs` from the tested native manifest and archives; a source `npm pack` is a developer input, not the production npm artifact.

## Documentation Maintenance

Public feature patches should update every affected documentation surface, not
only the root README. Check:

- `README.md`
- `CHANGELOG.md`
- `docs/`
- `documentation/`
- `technical/`
- `examples/`
- extension and plugin README files when the feature affects them

For top-level commands, also update the static documentation site command data
in `documentation/app.js` and any relevant tutorial section in
`documentation/index.html`.

For slash-command changes, update `technical/03-slash-commands.md` and run
`bun test test/commandRegistryIntegrity.test.ts`. That test verifies unique
canonical names and aliases, non-empty descriptions, loadable implementations,
and coverage of every visible shipped command in the technical reference.

For command surfaces that write `.ur/` state, update configuration and
validation docs with the generated files and cleanup expectations.

## Local Command Link

From the repository root:

```sh
bun link
ur --version
```

## GitHub Install

This package is configured for install without cloning:

```sh
bun add -g github:Maitham16/UR
```

The package exposes the global `ur` command from `bin/ur.js`. That launcher reads `package.json` for version and repository metadata, then runs `dist/cli.js` with Bun when available; the TypeScript entrypoint is a development fallback. Native releases execute the compiled application directly.
