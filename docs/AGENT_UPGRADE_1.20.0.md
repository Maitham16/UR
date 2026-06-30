# UR Agent 1.20.0 Upgrade Notes

UR 1.20.0 adds IDE integration and a richer tool surface for agent workflows.

## What Changed

- **ACP server** — `ur acp serve|stop|status` exposes an HTTP+JSON-RPC Agent
  Communication Protocol server for VS Code/Cursor/Zed-like editors. It lists
  tools, calls tools, sends tasks, and reports status. Existing A2A and MCP
  support remains unchanged.
- **`ur exec`** — run one or more prompts in non-interactive mode with optional
  concurrency, worktrees, and output capture.
- **New built-in tools** exposed through the agent loop, MCP server, and ACP
  server:
  - `GitHub` — PR/issue/repo operations via the `gh` CLI.
  - `Api` — REST HTTP calls with JSON/text output and path extraction.
  - `Browser` — headless browser automation (fetch/goto/click/type/evaluate/
    screenshot); interactive actions require `UR_BROWSER_TOOL=1`.
  - `Docker` — container and compose operations via the `docker` CLI.
  - `TestRunner` — auto-detect and run project tests.
  - `Database` — SQL queries against SQLite, Postgres, MySQL, and DuckDB.
- File-system and terminal tools (`FileRead`, `FileEdit`, `FileWrite`, `Glob`,
  `Grep`, `Bash`, `PowerShell`) remain built in and are now also reachable via
  ACP/MCP.

## New Commands

```sh
ur acp serve --host 127.0.0.1 --port 8123
ur acp status --json
ur exec "refactor the parser" --concurrency 2 --json
ur exec --file prompts.jsonl --output-dir ./outputs
```

## Validate

```sh
ur acp status
ur exec --dry-run "add tests"
bun run typecheck
bun test
```
