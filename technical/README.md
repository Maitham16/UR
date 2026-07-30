# UR-Nexus — Technical Specifications

> Audited against the executable source and tests for `ur-agent` v1.68.7.
> Command, tool, flag, provider, and setting claims are checked against the
> implementation rather than copied from product prose. Release validation
> keeps this version synchronized and packages the complete `technical/`
> catalog with the npm artifact.

UR-Nexus is an autonomous engineering workflow engine: a terminal (Ink/React) coding agent
with a plan → execute → test → verify → document → benchmark loop, local/server model support
(Ollama, llama.cpp, and vLLM), cloud API providers (OpenAI, Anthropic, Gemini, OpenRouter,
and any OpenAI-compatible endpoint), a multi-agent orchestration layer, and a large built-in
command/tool surface. An LM Studio adapter remains in the registry but is explicitly disabled
in this release, so it is not advertised as an available backend.

## Document map

| File | Contents |
|---|---|
| [01-architecture.md](01-architecture.md) | Runtime architecture: entrypoints, REPL, query engine, task types, services |
| [02-cli-reference.md](02-cli-reference.md) | The `ur` binary: flags, subcommands, headless mode, background sessions |
| [03-slash-commands.md](03-slash-commands.md) | Every interactive slash command with usage examples |
| [04-tools.md](04-tools.md) | Every model-invocable tool (built-in + conditional) with schemas and examples |
| [05-providers-and-models.md](05-providers-and-models.md) | Provider registry, model selection, routing, escalation, effort/fast modes |
| [06-configuration.md](06-configuration.md) | settings.json schema, scopes, permission rules, env variables, keybindings |
| [07-memory-and-context.md](07-memory-and-context.md) | UR.md, auto-memory, /remember, semantic memory, knowledge base, context pack, compaction |
| [08-skills-plugins-workflows.md](08-skills-plugins-workflows.md) | Skills (SKILL.md), bundled skills, plugins/marketplaces, declarative workflows, patterns, toolsmith |
| [09-multi-agent.md](09-multi-agent.md) | Subagents, crews, arena, background agents, routing, escalation, worktrees per task |
| [10-headless-automation-eval.md](10-headless-automation-eval.md) | `-p` print mode, /exec, SDK, automations, triggers, CI loop, eval harness, benchmarks |
| [11-integrations.md](11-integrations.md) | MCP, IDE/ACP, A2A, Chrome, GitHub, Slack, remote control, desktop, voice |
| [12-security-sandbox-stability.md](12-security-sandbox-stability.md) | Permission system, sandbox, safety policy, guardrails, security toolkit, stability/MAPE-K |
| [13-research.md](13-research.md) | Research notes, papers, citations, research graph, file/media analysis commands |
| [14-sessions.md](14-sessions.md) | Session persistence, resume, rewind/checkpoints, branching, export, tags, insights |

## Quick facts (from code)

- **Package**: `ur-agent`, binary `ur` (`bin/ur.js` → `dist/cli.js`, bundled from `src/entrypoints/cli.tsx`).
- **Runtime**: the npm binary uses a Node ≥ 18.18 launcher and requires Bun ≥ 1.3 for the bundled CLI; the TUI uses React 19 and the vendored Ink fork in `src/ink`.
- **Local-first**: default model backend is the local Ollama runtime (`http://localhost:11434`); `--offline` disables all cloud paths.
- **Registered commands at this release**: 167 platform-neutral bundled registry entries, 160 visible entries, and 235 visible slash invocation tokens. macOS and x64 Windows add `/desktop` (`/app`) for totals of 168, 161, and 237. There are 70 rows in `ur --help`; fast-path lifecycle/server commands are documented separately in doc 02. User/project skills, installed plugins, workflows, and MCP prompts are additive and normalized by source priority.
- **Registered tools**: the built-in pool is assembled per session from `src/tools.ts:getAllBaseTools()` and then filtered by runtime, mode, settings, permissions, and availability. Doc 04 enumerates the public built-ins and every supported gate; connected MCP tools are additive.
- **Feature flags**: compile-time `feature(...)` gates (`bun:bundle`) dead-code-eliminate internal-only surfaces from external builds; `USER_TYPE=ant` gates internal commands.
- **Project state**: lives under `.ur/` in each repo (artifacts, specs, workflows, guardrails, safety policy, knowledge, memory index, devcontainer config, tools, index).
