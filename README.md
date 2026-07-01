# UR-AGENT

<p align="center">
  <strong>Autonomous engineering workflow engine for reproducible software work.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ur-agent"><img alt="npm package" src="https://img.shields.io/npm/v/ur-agent.svg"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-non--commercial-blue.svg"></a>
  <a href="./QUALITY.md"><img alt="quality gate" src="https://img.shields.io/badge/quality-release%20gated-brightgreen.svg"></a>
</p>

UR-AGENT is a Bun and TypeScript autonomous engineering workflow engine: a
reproducible autonomous software engineering agent built for disciplined local
and CI-driven work. It is not only chat, autocomplete, or code edits: UR is
built to plan, execute, test, verify, document, benchmark, and reproduce
software work. It opens a stateful interactive terminal session by default, can
run one-shot prompts for scripts, and includes workflow commands for
specification-driven development,
multi-agent execution, test-first quality loops, CI repair loops, background
agents, MCP servers, plugins, skills, memory, permission safety policy,
project context packing, verification, and local model routing.

UR-AGENT integrates official model access paths only: subscription CLIs,
explicit API-key mode, and local OpenAI-compatible runtimes. It never scrapes
browser sessions, extracts OAuth tokens, or bypasses provider restrictions.

## Why UR

UR is built around the work that happens after a prompt: reading a repository,
editing files, running commands, validating the result, preserving context, and
handing work off to other tools or agents when needed.

- **Reproducible engineering loop.** Substantial tasks should move through
  `spec -> plan -> patch -> test -> report -> rollback`, with command evidence
  captured before success is claimed.
- **Terminal-native agent loop.** Run `ur` for an interactive coding session or
  `ur -p` for automation-friendly output.
- **Local model runtime.** Use any model exposed by Ollama, set a specific host
  with `--ollama-host`, or discover LAN Ollama servers with `--discover-ollama`.
- **Legal provider routing.** Use `ur provider`, `ur auth chatgpt`,
  `ur auth claude`, `ur auth gemini`, `ur auth antigravity`, and safe
  `ur config set ...` commands to select official subscription, API, or local
  providers without storing secrets in UR settings.
- **Agent workflows.** Use `ur spec`, `ur arena`, `ur test-first`,
  `ur ci-loop`, `ur bg`, `ur workflow`, `ur crew`, and `ur automation` for
  structured work beyond a single chat turn.
- **Reliable repo editing.** Use `ur repo-edit` for indexed search,
  AST-aware rename plans, patch previews, and rollback-safe multi-file apply.
- **Permission and context control.** Use `ur safety` and `ur context-pack` to
  inspect command risk, initialize project safety policy, summarize repository
  architecture, and preserve task decisions, constraints, commands, diffs,
  architecture decisions, preferred commands, failed attempts, accepted patterns,
  and rejected approaches.
- **Lifecycle hooks.** Configure `BeforeEdit`, `AfterEdit`, `BeforeCommand`,
  `AfterCommand`, `BeforeCommit`, and `OnFailure` hooks in `.ur/hooks.json` or
  `UR.md` to run custom commands when the agent edits files, runs shell commands,
  commits, or hits a failure.
- **Verification and provenance.** Use `ur test-first`, the built-in verifier,
  `/verify`, `.ur/verify.json`, `ur artifacts`, `ur claim-ledger`, and `/trace`
  to make results easier to inspect.
- **Extensible tool surface.** Add MCP tools, plugin marketplace entries,
  executable skills, reusable templates, deterministic validators, language
  adapters, LSP servers, role modes, custom agents, IDE diff bundles, A2A
  endpoints, and local knowledge indexes.

## Quick Start

### Requirements

- Bun. This repository is configured with `bun@1.3.14`.
- A Node.js-compatible shell environment.
- A running Ollama app or server. UR defaults to `http://localhost:11434/api`.
- Optional tools for specific workflows: GitHub CLI, tmux, and supported IDE
  integrations.

### Install

Remove old global installs first if needed:

```sh
npm uninstall -g ur-agent
bun remove -g ur-agent
```

Install the global `ur` command:

```sh
npm install -g ur-agent
ur --version
ur --help
```

Install directly from GitHub when you want this repository build:

```sh
bun add -g github:Maitham16/UR
ur --version
```

### Start A Session

```sh
ur
```

Run one prompt and exit:

```sh
ur -p "summarize this repository"
```

Return structured output for scripts:

```sh
ur -p --output-format json "list the main services in this codebase"
```

Resume previous work:

```sh
ur --continue
ur --resume
```

Check for npm updates:

```sh
ur upgrade
```

Source checkouts report:

```text
Development build detected. To update, pull latest source or install from npm.
```

Choose a model or Ollama host:

```sh
ur --model qwen3-coder:480b-cloud
ur --ollama-host http://192.168.1.50:11434
ur --discover-ollama
```

Model selection precedence is `OLLAMA_MODEL`, then `UR_MODEL`, then the model
router over the configured Ollama host. If model discovery fails, the built-in
fallback is `qwen3-coder:480b-cloud`.

### Legal Provider Auth

UR-AGENT stores only safe provider preferences: provider name, model name,
base URL, command path, fallback preference, and non-secret settings. API keys
must stay in environment variables and subscription providers must authenticate
through their official CLIs.

```sh
ur provider list
ur provider status
ur provider doctor
ur auth chatgpt
ur auth claude
ur auth gemini
ur auth antigravity
ur config set provider codex-cli
ur config set provider claude
ur config set provider "Claude Code"
ur config set provider antigravity
ur config set model qwen3-coder:480b-cloud
ur config set base_url http://localhost:11434
ur config set provider.fallback ollama
```

Provider config accepts canonical IDs and common aliases. Examples:
`codex-cli`, `chatgpt`, `codex`, `claude-code-cli`, `claude`,
`Claude Code`, `gemini-cli`, `gemini`, `antigravity-cli`, `antigravity`,
`agy`, `ollama`, `lmstudio`, `LM Studio`, `llama.cpp`, and `vllm`.
Use quotes for shell values with spaces.

| Provider | Access type | Legal path |
| --- | --- | --- |
| Codex CLI | subscription | official Codex CLI login |
| Claude Code | subscription | official Claude Code login |
| Gemini CLI | subscription | official Gemini Code Assist login |
| Antigravity | subscription | official Antigravity login, where supported |
| OpenAI API | API key | `OPENAI_API_KEY` |
| Claude API | API key | `ANTHROPIC_API_KEY` |
| Gemini API | API key | `GEMINI_API_KEY` |
| OpenRouter | API/router | `OPENROUTER_API_KEY` |
| Ollama | local | localhost Ollama runtime |
| LM Studio | local/server | local OpenAI-compatible server |
| llama.cpp | local/server | local OpenAI-compatible server |
| vLLM | local/server | OpenAI-compatible server |

In the interactive app, `/model` shows providers first and then shows only the
selected provider's models. OpenAI API and Codex CLI, Claude API and Claude
Code, and Gemini API and Gemini CLI are separate access paths; subscription
logins and API keys are not interchangeable.

Security policy: UR-AGENT never scrapes browser sessions, extracts OAuth
tokens, bypasses subscription/quota/region/organization restrictions, proxies a
consumer web session as an API, or claims support for a provider unless the
official CLI/API path works. See [Provider Guide](docs/providers.md).

## Command Surface

Run `ur --help` for the complete CLI reference. These commands are implemented
as first-class subcommands in the shipped CLI.

| Command | Purpose |
| --- | --- |
| `ur` | Start an interactive terminal agent session in the current workspace. |
| `ur -p` | Run a non-interactive prompt with text, JSON, or stream-JSON output. |
| `ur spec` | Default spec-first workflow: create requirements, design, and task documents under `.ur/specs/`, run the task list, and verify with strict proof gates. |
| `ur escalate` | Plan or run work with fast and oracle model tiers selected from local model capabilities. |
| `ur arena` | Run multiple agents on the same task in isolated worktrees and surface the winning diff. |
| `ur ci-loop` | Run a build or test command, hand failures to a fix agent, and retry with a bounded budget. |
| `ur test-first` | Detect the project stack, run compile/test/lint commands, store failure traces, and install edit-time verify gates. |
| `ur safety` | Inspect or initialize project shell safety policy and evaluate command risk before execution. |
| `ur context-pack` | Write project architecture context, task memory, and compressed context under `.ur/`. Supports memory kinds `decision`, `constraint`, `command`, `diff`, `note`, `architecture`, `preference`, `attempt`, `accepted`, and `rejected`. |
| `/hooks` | Inspect lifecycle hooks (`BeforeEdit`, `AfterEdit`, `BeforeCommand`, `AfterCommand`, `BeforeCommit`, `OnFailure`) configured via settings files. |
| `ur bg` | Run and manage detached local background agents with optional worktrees and PR creation. |
| `ur worktree` | List, inspect, and clean up UR agent worktrees. |
| `ur automation` | Store and run project-local scheduled automation specs under `.ur/automations/`. |
| `ur workflow` | Define, validate, graph, run, and resume declarative agent workflows. |
| `ur crew` | Run a lead and worker subagent crew over a shared task board; `--decompose` auto-splits tasks with risk/tests/rollback metadata. |
| `ur pattern` | Run multi-agent collaboration patterns (PEER, DOE, concurrent, handoff, debate, parallel); `--execute` runs them as a workflow. |
| `ur goal` | Track long-horizon objectives that persist across sessions. |
| `ur repo-edit` | Build a repo edit index, plan AST-aware renames, preview patches, and apply with rollback. |
| `ur code-index` | Build, query, or watch a local semantic code index using Ollama embeddings; `ur code-index repo` adds files/symbols/calls/tests/docs/configs. |
| `ur semantic-memory` | Build and search a project-local memory index. |
| `ur knowledge` | Manage a curated project knowledge base with provenance. |
| `ur artifacts` | Capture diffs, test runs, notes, and review feedback under `.ur/artifacts/`. |
| `ur claim-ledger` | Map generated claims to file, web, MCP, tool, or user sources. |
| `ur browser-qa` | Validate and smoke-run browser QA replay fixtures. |
| `ur eval run` | Run an eval suite and grade outputs; optionally capture cost/tokens/files/test metrics. |
| `ur eval report` | Show a saved eval report; `--dashboard` writes a single-suite HTML timeline. |
| `ur eval dashboard` | Generate the local-first HTML dashboard across all saved reports. |
| `ur eval bench` | Import local SWE-bench, Terminal-Bench, or Aider Polyglot exports. |
| `ur model-doctor` | Inspect Ollama models and report likely agent capabilities. |
| `ur model-route` | Recommend a local model for a task by capability fit. |
| `ur provider` | List, check, and diagnose legal model provider adapters. |
| `ur auth chatgpt` | Launch the official Codex CLI login for ChatGPT subscription access. |
| `ur auth claude` | Launch the official Claude Code login flow. |
| `ur auth gemini` | Use the official Gemini CLI login flow where supported. |
| `ur auth antigravity` | Use the official Antigravity CLI login flow where supported. |
| `ur config set` | Persist safe non-secret provider settings such as provider, model, base URL, command path, and fallback. |
| `ur mcp` | Configure and manage Model Context Protocol servers. |
| `ur plugin` | Install, update, enable, disable, and validate UR plugins that can add MCP tools, skills, templates, validators, language adapters, LSP servers, agents, hooks, output styles, and commands. |
| `ur role-mode` | Install built-in Architect, Code, Debug, and Ask role modes. |
| `ur acp` | Start/stop/status the Agent Communication Protocol server for IDE extensions. |
| `ur exec` | Run one or more prompts in non-interactive mode with optional concurrency. |
| `ur ide diff` | Capture editor-readable inline diff bundles. |
| `ur a2a card` | Print UR-AGENT Card metadata for agent interoperability. |
| `ur a2a serve` | Start an opt-in local A2A task server with bearer or delegation auth. |
| `ur sdk` | Show programmatic headless usage and scaffold SDK examples. |

### Status Bar

Interactive sessions show a compact bottom status bar when the terminal supports
it. It is hidden in CI, dumb terminals, non-interactive mode, and assistant
viewer mode.

Example:

```text
UR-AGENT v1.25.3 | Provider: Ollama | Auth: local | model: qwen3-coder:480b-cloud | mode: ask | branch: main | tasks: idle | Update: 1.25.2 -> 1.25.3 available
```

If a custom status-line hook is configured, UR-AGENT uses that hook output
instead of the built-in bar.

### IDE Integration

`ur ide diff` captures review bundles under `.ur/ide/diffs/` so editors can
show agent diffs without scraping terminal output. The shipped VS Code inline
diff extension is bundled inside this repository and packaged as a local VSIX
when installed from UR-AGENT; the public install path does not depend on an
unpublished marketplace extension ID.

```sh
ur ide diff capture --title "Parser fix"
ur ide diff list
ur ide diff show <id>
```

The extension is local-only. It reads and writes diff metadata inside the
current workspace and does not call model providers or network services.

New slash skills run agentic work in isolated git worktrees with clean commits and PR output:
`/debug-v2`, `/refactor`, `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, `/latex-paper`.
Install matching agent templates with `ur agent-templates install`.

New built-in tools (exposed through MCP and the ACP server): GitHub, API, Browser, Docker, TestRunner, Database. File-system and terminal tools are already built in (FileRead, FileEdit, FileWrite, Glob, Grep, Bash, PowerShell).

### Plugin Marketplace

UR plugins are trusted local extension bundles. A marketplace entry can install
commands, MCP tools, executable skills, reusable templates, deterministic
validators, language adapters, LSP server metadata, agents, hooks, and output
styles. The bundled `engineering-discipline` reference plugin demonstrates the
full extension contract with a `/discipline-check` command, a
`reproducible-release` skill, a release-verifier template, a release-gate
validator, and Markdown language-adapter metadata.

```sh
ur plugin list
ur plugin install engineering-discipline@ur-plugins-official
ur plugin install hello@ur-plugins-official
ur plugin update <plugin>
ur plugin disable <plugin>
```

The npm package includes `README.md`, `QUALITY.md`, `docs/`, `documentation/`,
and `plugins/`, so the npm package page and installed artifact both carry the
marketplace documentation, core plugins, community staging directory, and
example plugin template. See [Plugin Guide](docs/plugins.md).

UR also documents the core Cursor-style agent primitives as first-class,
project-backed features: Agent surfaces (`ur`, `ur agents`, `ur crew`, `ur bg`),
Rules (`AGENTS.md`, `UR.md`, `.cursor/rules/*.mdc`, `.cursorrules`, safety and
guardrail config), MCP (`ur mcp`, `.mcp.json`, plugin MCP servers), Skills
(`/skills`, bundled, project, user, and plugin skills), CLI (`ur --help`, `ur -p`,
`ur exec`, `ur acp`), and Models (`ur model`, `ur model-doctor`, Ollama routing
and discovery).

Examples:

```sh
ur spec init checkout --goal "1. add cart 2. add payment 3. add receipt"
ur spec run checkout --all --dry-run
ur spec run checkout --all --kernel
ur spec verify checkout --kernel
ur crew create parser-crew --goal "fix the flaky parser test" --decompose --dry-run
ur crew plan parser-crew --goal "fix the flaky parser test" --decompose
ur crew run parser-crew --workers 3 --decompose --dry-run
ur pattern parallel "refactor login without changing behavior" --execute --dry-run
ur arena "implement a debounce helper" --agents 2 --dry-run
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first detect
ur test-first --dry-run
ur test-first install
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack remember --architecture "Repository pattern for data access" --status accepted --rationale "Testability"
ur context-pack remember --preference "Use bun test over jest"
ur context-pack remember --accepted "Use p-map for bounded concurrency" --scope project
ur context-pack remember --rejected "Switch to esbuild" --alternative-to "Keep bun bundle"
ur context-pack remember --attempt "Tried Deno runtime" --status superseded
ur context-pack compress
ur ci-loop --command "bun test" --max-attempts 3 --dry-run
ur bg run "fix the flaky parser test" --worktree --dry-run
ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
ur code-index search "where is the rate limiter configured"
ur code-index repo build
ur code-index repo search "rate limiter"
ur skill init security-review
ur skill run security-review "src/auth.ts"
ur artifacts capture-tests --command "bun test"
ur agent-task pr --create --dry-run
ur acp serve --port 8123
ur exec "add tests for the parser" --concurrency 4 --json
ur eval run starter --metrics --json
ur eval report starter --dashboard
ur eval dashboard
```

## Project Context

UR reads repository instructions and local runtime state from project files:

- `AGENTS.md` and `UR.md` provide shared project instructions.
- `UR.local.md` is for private local instructions.
- `.ur/skills/` stores project skills.
- `.ur/agents/` stores custom agents and role modes.
- `.ur/safety-policy.json` configures project shell safety rules for read,
  write, execute, and network command classes.
- `.ur/project-manifest.json` and `.ur/context/` hold architecture summaries,
  task memory, compressed context, and project memory including architecture
  decisions, preferred commands, failed attempts, accepted patterns, and rejected
  approaches.
- `.ur/specs/`, `.ur/artifacts/`, `.ur/automations/`, `.ur/test-first/`,
  `.ur/memory/`, and `.ur/index/` hold workflow state, review artifacts,
  scheduled jobs, failure traces, memory, and indexes.

Commit only shared project assets that are safe for teammates. Keep local
settings, generated indexes, memory, logs, and secrets out of Git.

## Architecture

- `bin/ur.js` is the global launcher. It reads package metadata, uses the
  bundled `dist/cli.js` when available, and otherwise starts the TypeScript CLI
  through Bun.
- `src/entrypoints/cli.tsx` handles fast startup paths such as `--version`,
  A2A serving, background sessions, bridge mode, and daemon paths before loading
  the full CLI.
- `src/main.tsx` defines the top-level flags and subcommands.
- `src/commands.ts` and `src/commands/` register slash commands and local CLI
  command modules.
- `src/tools/` contains tool implementations for file editing, shell execution,
  MCP resources, task management, and agent delegation.
- `src/services/` contains runtime services for MCP, verification, memory,
  code indexing, safety policy, context manifests, model routing, background
  agents, A2A, analytics, sync, and API integration.
- `extensions/vscode-ur-inline-diffs/` contains the VS Code inline diff review
  extension.
- `plugins/core/` contains first-party marketplace plugins.
- `plugins/community/` stages contributed plugins.
- `plugins/examples/` contains plugin templates users can copy.

## Safety Model

UR can read files, edit code, execute commands, and call configured tools, so
the permission boundary matters.

- Sensitive tool actions go through permission checks by default.
- `--allowed-tools` and `--disallowed-tools` can scope tool access for
  automation.
- `--dangerously-skip-permissions` should only be used inside disposable
  sandboxes.
- The verifier checks for false completion claims, repeated tool-call loops,
  empty assistant turns, and project gates.
- Project gates can be configured in `.ur/verify.json`.
- `ur test-first install` writes detected compile/test/lint commands into
  `.ur/verify.json` so mutating turns have command evidence before completion.
- `ur safety check --command "<cmd>"` classifies read, write, execute, and
  network permissions, asks before destructive commands, recommends sandboxing
  for risky operations, and blocks common secret exfiltration paths.
- `ur safety init` writes `.ur/safety-policy.json` for project-specific safety
  rules.
- `ur context-pack scan` writes a repo architecture manifest from package
  scripts, instruction files, `.ur/verify.json`, and safety config.
- The deep verification subagent is available through `/verify` and can be
  auto-enabled with `UR_VERIFIER_AUTO_SUBAGENT=1`.
- OS-level sandbox support is available on macOS and Linux through UR's
  sandbox settings.
- MCP servers can access external services; only enable servers you trust.

See [Configuration](docs/CONFIGURATION.md), [Validation](docs/VALIDATION.md),
and [Quality Notes](QUALITY.md) for operational guidance.

## Development

Install dependencies:

```sh
bun install
```

Run from source:

```sh
bun run start
bun run dev
```

Build and verify a release:

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

`dist/cli.js` is intentionally tracked because GitHub installs use the bundled
CLI. Rebuild it after source, version, or macro changes.

The GitHub workflow runs production bundle, smoke, release, package, and global
install checks only after the Bun test step succeeds. Do not publish or tag a
release until that GitHub run is green.

## Documentation

- [Usage Guide](docs/USAGE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Provider Guide](docs/providers.md)
- [Agent Feature Expansion](docs/AGENT_FEATURES.md)
- [Agent Trend Coverage](docs/AGENT_TRENDS.md)
- [1.22.0 Upgrade Notes](docs/AGENT_UPGRADE_1.22.0.md)
- [1.20.0 Upgrade Notes](docs/AGENT_UPGRADE_1.20.0.md)
- [1.19.0 Upgrade Notes](docs/AGENT_UPGRADE_1.19.0.md)
- [1.18.0 Upgrade Notes](docs/AGENT_UPGRADE_1.18.0.md)
- [1.17.0 Upgrade Notes](docs/AGENT_UPGRADE_1.17.0.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Plugin Guide](docs/plugins.md)
- [Validation Runbook](docs/VALIDATION.md)
- [Release Runbook](RELEASE.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Static Documentation Site](documentation/index.html)

The `examples/` directory includes prompt and workflow examples for coding,
research, browser, image, video, MCP, memory, and agent-platform tasks.

## License

UR-AGENT is released under the
[UR-AGENT Non-Commercial Self-Responsibility License](LICENSE).

Personal, educational, research, evaluation, and other non-commercial use is
permitted. Commercial use requires prior written permission from Maitham
Al-rubaye.

The software is provided as-is. Users are responsible for how they configure
UR, what tools it can access, and any outputs, commands, files, network
requests, integrations, or decisions created with it.

Designed by Maitham Al-rubaye.
