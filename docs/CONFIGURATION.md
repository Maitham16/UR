# Configuration

UR reads configuration from CLI flags, environment variables, and project or user settings files.

## Model Provider

UR runs models strictly through a local Ollama instance. The request endpoint is fixed and cannot be reconfigured:

```text
http://localhost:11434/api
```

Ollama Cloud, remote model endpoints, and model API keys are not supported.

Model selection environment variables:

```sh
OLLAMA_MODEL=qwen2.5-coder:latest
UR_MODEL=qwen2.5-coder:latest
```

`OLLAMA_MODEL` selects the model name and takes precedence over `UR_MODEL`. Neither variable can change the endpoint.

## CLI Flags

Frequently used flags:

```sh
ur --model <model>
ur --settings <file-or-json>
ur --add-dir <path>
ur --mcp-config <file-or-json>
ur --permission-mode <mode>
ur --plugin-dir <path>
ur --agents '<json>'
```

Use `ur --help` for the complete list.

## Settings Files

UR supports user, project, and local settings. Project-shared settings can live under `.ur/`, while local files should remain private.

Recommended Git behavior:

- Commit shared docs, skills, agents, and project settings that are safe for teammates.
- Do not commit `.ur/settings.local.json`.
- Do not commit generated `.ur/index/`, `.ur/memory/`, `.ur/cache/`, `.ur/tmp/`, or `.ur/logs/`.
- Do not commit `CLAUDE.local.md`.

## Verifier

UR runs a lightweight verifier in the agent loop to catch false "task done"
claims, infinite tool-call loops, empty assistant turns, and project gate
failures. After the deterministic checks pass on a mutating turn, the verifier
also nudges the model to spawn the independent `verification` subagent for a
second opinion.

Behaviour is controlled by two environment variables:

```sh
# Overall mode (default: strict)
UR_VERIFIER_MODE=strict   # all gates on: done-claim, loops, empty turn,
                          # project gates, L2 nudge
UR_VERIFIER_MODE=loose    # only empty-turn check + loop detector + L2 nudge
UR_VERIFIER_MODE=off      # disable verifier entirely

# Independent L2 toggle (default: on unless mode=off)
UR_VERIFIER_DISABLE_SUBAGENT=1   # keep L1 deterministic gates, skip L2 nudge
```

Project-specific gates live in `.ur/verify.json`:

```json
{
  "afterEdit": ["bun x tsc --noEmit", "bun test --quiet"],
  "afterBash": [],
  "ignorePatterns": ["**/*.md", "node_modules/**"],
  "timeoutMs": 60000
}
```

After a turn that modified files, every `afterEdit` command must exit 0
before the agent can declare the task complete. A failing command surfaces
to the model as a structured reminder with the command name and the trimmed
stdout/stderr.

Two related slash commands:

- `/verify [focus]` — manually ask the agent to spawn the verification
  subagent (e.g. `/verify the auth flow`). Useful before a commit.
- `/trace [n]` — print a structured view of the last `n` messages (default 8,
  max 50): roles, tool calls, tool results, verifier verdicts. Useful for
  debugging what the agent did during a turn.

## MCP Servers

Use the `mcp` subcommand to manage Model Context Protocol servers:

```sh
ur mcp list
ur mcp get <name>
ur mcp add-json <name> '<json>'
ur mcp remove <name>
```

MCP servers may execute code or access external services. Only enable servers you trust, and keep credentials out of committed config.

## Plugins and Skills

Plugins can add commands, tools, and skills:

```sh
ur plugin list
ur plugin install <plugin>
ur plugin update <plugin>
ur plugin disable <plugin>
```

Skills can be stored in `.ur/skills/` for project-specific workflows or in `~/.ur/skills/` for personal workflows.

## Secrets

Keep secrets in environment variables, local settings, a secret manager, or your shell profile. Never commit API keys, OAuth tokens, private keys, service-account JSON, or `.env` files.
