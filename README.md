# UR Agent

UR is a Bun/TypeScript terminal coding agent. It starts an interactive session by default, can run once in print mode for scripts, and supports project context, slash commands, MCP servers, plugins, skills, and custom agents.

The package installs a global `ur` command from npm or this GitHub repository. The launcher requires Bun and sends all model requests to the local Ollama app.

## Requirements

- Bun. This workspace was verified with Bun 1.3.14.
- Node.js-compatible shell environment
- A local Ollama app/server for model requests (default http://localhost:11434/api; LAN hosts supported via `--discover-ollama` or `--ollama-host`)
- Optional: GitHub CLI, tmux, and IDE integrations for workflows that use them

## Install

### IMPORTANT
If you have previous version remove it with:

```sh
npm uninstall -g ur-agent
bun remove -g ur-agent
```

### Then, install:

```sh
npm install -g ur-agent
ur --version
ur
```

If you prefer installing directly from GitHub, Bun is still required at runtime:

```sh
npm install -g github:Maitham16/UR-mapek
ur --version
```

UR auto-routes to an installed Ollama model when possible. If you want a specific model, choose it explicitly:

```sh
UR_MODEL=qwen3-coder:480b-cloud ur
```

The launch wrapper reads `OLLAMA_MODEL` first, then `UR_MODEL`. If neither is set, UR lets its Ollama router choose from the models exposed by your local Ollama app, including Ollama Cloud-backed models. If routing cannot discover a model list, the built-in fallback is `qwen3-coder:480b-cloud`.

## Development From Source

```sh
bun install
bun run start
```

To make the `ur` command available from this checkout during development:

```sh
bun link
ur
```

## Common Usage

Start an interactive session:

```sh
ur
```

Ask one question and print the answer:

```sh
ur -p "summarize this repository"
```

Use JSON output for automation:

```sh
ur -p --output-format json "list the main commands"
```

Resume a recent session:

```sh
ur --continue
ur --resume
```

Run with a specific model:

```sh
ur --model qwen3-coder:480b-cloud
```

See all CLI options and subcommands:

```sh
ur --help
ur mcp --help
ur plugin --help
```

Agent platform examples:

```sh
ur spec init demo --goal "1. add a utils.add function 2. add a test"
ur spec run demo --all --dry-run
ur arena "implement a debounce helper" --agents 2 --dry-run
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur ci-loop --command "bun test" --dry-run
ur artifacts capture-diff
ur bg run "fix the flaky parser test" --worktree --dry-run
ur ide diff capture --title "Working tree review"
ur eval bench list
ur --discover-ollama
```

## Documentation

- [Usage Guide](docs/USAGE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Agent Trend Coverage](docs/AGENT_TRENDS.md)
- [1.16.0 Upgrade Notes](docs/AGENT_UPGRADE_1.16.0.md)
- [Agent Feature Expansion](docs/AGENT_FEATURES.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Static Documentation Site](documentation/index.html)

The `examples/` directory also contains prompt examples for coding, research, browser, image, video, MCP, memory, agent-trend, and agent-feature workflows.

## License And Responsibility

UR Agent is released under the [UR Agent Non-Commercial Self-Responsibility License](LICENSE). Commercial use is not allowed without written permission from Maitham Al-rubaye.

The software is provided as-is. Users are responsible for reviewing how they run it, what tools it can access, and any outputs or actions it creates.

## Security

Do not commit secrets, passwords, API keys, OAuth tokens, private keys, `.env` files, local UR memory, generated indexes, logs, or local settings. The package `files` list ships the launcher, bundled CLI, docs, examples, changelog, quality notes, README, and license.

## Project Context

UR reads project instructions from `UR.md` files and can load project assets from `.ur/`. Shared project configuration may be committed, but local files such as `.ur/settings.local.json`, `.ur/memory/`, `.ur/index/`, and `UR.local.md` are ignored by Git.

## Development

```sh
bun run dev
bun run typecheck
bun test
bun run bundle
bun run smoke
bun run secrets:scan
bun run release:check
npm pack --dry-run
```

The package is published on npm as `ur-agent` and can also be installed directly from GitHub with `github:Maitham16/UR-mapek`.

## Designed By

Maitham Al-rubaye
