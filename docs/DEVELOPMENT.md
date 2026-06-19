# Development Guide

## Repository Layout

- `bin/ur.js` launches the TypeScript CLI through Bun.
- `src/entrypoints/cli.tsx` handles fast startup paths before loading the full CLI.
- `src/main.tsx` defines top-level CLI flags and subcommands.
- `src/commands.ts` registers slash commands and command modules.
- `src/tools/` contains tool implementations.
- `src/services/` contains API, MCP, analytics, sync, and runtime services.
- `src/components/` and `src/ink/` implement the terminal UI.
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
bun test
bun run bundle
bun run smoke
bun run secrets:scan
bun run release:check
npm pack --dry-run
```

The GitHub install path uses the bundled launcher in `dist/cli.js`, so `bun run bundle` must be run before packaging or pushing a release. `bun run release:check` verifies that `package.json`, `bunfig.toml`, the bundle, docs, and `node ./bin/ur.js --version` agree.

## Build

```sh
bun run bundle
```

The build output goes to `dist/cli.js`. The directory is ignored by default, but `dist/cli.js` is intentionally tracked because GitHub installs run the bundled CLI.

## Local Command Link

From the repository root:

```sh
bun link
ur --version
```

## GitHub Install

This package is configured for install without cloning:

```sh
bun add -g github:Maitham16/UR-mapek
```

The package exposes the global `ur` command from `bin/ur.js`. That launcher reads `package.json` for version and repository metadata, then runs `src/entrypoints/cli.tsx` with Bun.
