# Configuration

UR reads configuration from CLI flags, environment variables, and project or user settings files.

## Model Provider

UR runs models strictly through the local Ollama app. The request endpoint is fixed and cannot be reconfigured from UR:

```text
http://localhost:11434/api
```

Any model exposed by that local Ollama app can be used, including local models and Ollama Cloud-backed models. UR does not call remote provider APIs directly and does not manage model API keys.

Model selection environment variables:

```sh
OLLAMA_MODEL=qwen3-coder:480b-cloud
UR_MODEL=qwen3-coder:480b-cloud
```

`OLLAMA_MODEL` selects the model name and takes precedence over `UR_MODEL`. If neither is set, UR lets its Ollama router choose from the model list advertised by the local Ollama app. If that discovery fails, the built-in fallback is `qwen3-coder:480b-cloud`. Neither variable can change the endpoint.

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
- Do not commit `UR.local.md`.

## Verifier

UR runs a lightweight verifier in the agent loop (L1) to catch false "task
done" claims, infinite tool-call loops, empty assistant turns, and project
gate failures. This is the cheap "try the implementation" pass and always
runs (outside `mode=off`).

The heavy independent `verification` subagent (L2) is **opt-in**: by default
UR never auto-spawns it after a turn. Trigger that deep second opinion
yourself with the `/verify` command when you want it. Set
`UR_VERIFIER_AUTO_SUBAGENT=1` to restore the old behaviour where the verifier
nudges the model to spawn the subagent after every mutating turn.

Behaviour is controlled by environment variables:

```sh
# Overall mode (default: strict) — controls the L1 gates
UR_VERIFIER_MODE=strict   # all L1 gates on: done-claim, loops, empty turn,
                          # project gates
UR_VERIFIER_MODE=loose    # only empty-turn check + loop detector
UR_VERIFIER_MODE=off      # disable verifier entirely

# L2 deep-verification subagent (default: off — run it manually via /verify)
UR_VERIFIER_AUTO_SUBAGENT=1      # auto-nudge the subagent after every
                                 # mutating turn (the old default)
UR_VERIFIER_DISABLE_SUBAGENT=1   # hard-off: also unregister the verification
                                 # agent so /verify can't spawn it either
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

- `/verify [focus]` — manually run the deep verification subagent (e.g.
  `/verify the auth flow`). This is the primary way to trigger L2; useful
  before a commit.
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
