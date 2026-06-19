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
bun test
bun run smoke
bun run secrets:scan
npm pack --dry-run
```

`bun run typecheck` and `bun run build` are kept as development commands, but this fork still has pre-existing type and bundle issues. The GitHub install path uses the runnable source launcher in `bin/ur.js`.

## Build

```sh
bun run build
```

The build output goes to `dist/`, which is ignored by Git.

## Local Command Link

From the repository root:

```sh
bun link
ur --version
```

## GitHub Install

This package is configured for install without cloning:

```sh
bun add -g github:Maitham16/ur-agent
```

The package exposes the global `ur` command from `bin/ur.js`. That launcher reads `package.json` for version and repository metadata, then runs `src/entrypoints/cli.tsx` with Bun.
