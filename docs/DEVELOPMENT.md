# Development Guide

## Repository Layout

- `bin/ur.js` launches the TypeScript CLI through Bun.
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

The GitHub install path uses the bundled launcher in `dist/cli.js`, so `bun run bundle` must be run before packaging or pushing a release. `bun run release:check` verifies that `package.json`, `bunfig.toml`, the bundle, docs, and `node ./bin/ur.js --version` agree. The GitHub workflow keeps production bundle, release, package, and global-install checks behind the Bun test step; do not publish, tag, or push release artifacts until that workflow is green.

## Build

```sh
bun run bundle
```

The build output goes to `dist/cli.js`. The directory is ignored by default, but `dist/cli.js` is intentionally tracked because GitHub installs run the bundled CLI.

## Documentation Maintenance

Public feature patches should update every affected documentation surface, not
only the root README. Check:

- `README.md`
- `CHANGELOG.md`
- `docs/`
- `documentation/`
- `examples/`
- extension and plugin README files when the feature affects them

For top-level commands, also update the static documentation site command data
in `documentation/app.js` and any relevant tutorial section in
`documentation/index.html`.

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

The package exposes the global `ur` command from `bin/ur.js`. That launcher reads `package.json` for version and repository metadata, then runs `src/entrypoints/cli.tsx` with Bun.
