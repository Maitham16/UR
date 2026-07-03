# Configuration

UR reads configuration from CLI flags, environment variables, and project or user settings files.

## Model Providers

UR-AGENT supports official provider access paths only:

- Explicit API providers: OpenAI, Anthropic, Gemini, OpenRouter, and
  OpenAI-compatible endpoints.
- Local/server providers: Ollama, LM Studio, llama.cpp, and vLLM OpenAI-compatible
  server mode.
- Subscription CLI providers: Codex CLI, Claude Code CLI, Gemini CLI, and
  Antigravity where officially supported. These dispatch turns through the
  vendor's official CLI using your subscription login. They are optional and
  never required for normal UR runtime.

Explicit API and local/server providers are UR-native: UR owns request
shaping, native tool-call parsing, native streaming, and the UR-run Bash/File
tool permission, sandbox, and verifier flow. Subscription CLI providers cross
an external vendor CLI boundary instead — UR passes prompt text to the
official CLI and receives final text output. UR-native tool calling, streaming,
Bash/File tool execution, and sandbox guarantees apply to UR-run tools and
final UR output, not to actions the external CLI performs internally. See
[Provider Guide](providers.md) for the full provider capability matrix.

UR-AGENT never scrapes browser sessions, extracts OAuth refresh tokens, reads
hidden provider auth files, bypasses provider restrictions, or proxies consumer
web sessions as APIs.

The default local request endpoint is:

```text
http://localhost:11434/api
```

Any model exposed by that Ollama app can be used, including local models and
Ollama Cloud-backed models. Explicit API providers may call their configured
API endpoints, but UR does not store model API keys in settings.

Provider configuration commands:

```sh
ur provider list
ur provider doctor
ur provider status
ur provider models [provider] --json
ur config set provider ollama
ur config set provider openai-api
ur config set provider anthropic-api
ur config set provider gemini-api
ur config set provider openrouter
ur config set provider openai-compatible
ur provider doctor agy
ur config set provider.fallback ollama
ur config set model <model>
ur provider select-model <provider> <model> --json
ur config set base_url <url>
```

Provider values accept canonical IDs and common aliases. Examples:
`openai-api`, `anthropic-api`, `gemini-api`, `openrouter`, `ollama`,
`lmstudio`, `LM Studio`, `llama.cpp`, `vllm`, and the subscription CLI
providers `codex-cli` (`chatgpt`), `claude-code-cli` (`claude`), `gemini-cli`
(`gemini`), and `antigravity-cli` (`agy`). Values with spaces should be quoted
in shell commands.

In the interactive app, `/model` is provider-first: choose a provider, then
choose a model from that provider only. The picker labels providers as
subscription login, API key, local runtime, or OpenAI-compatible endpoint and
shows model source as `live`, `cache`, or `static`. Changing providers clears an
incompatible saved model instead of silently carrying it across providers. The
saved provider/model pair controls the runtime backend for the next agent
request; Ollama is only used when `ollama` is the selected provider.

Use this to inspect the active runtime path:

```sh
ur provider status
```

The status output includes active provider, active model, access type,
credential type, and runtime backend.

API keys are never written to UR settings files. Store one securely with
`ur connect <provider>` (OS keychain, with an encrypted file fallback), or set
it in the environment when you explicitly choose API mode:

```sh
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

### Reconfiguring the Ollama host

The endpoint can be changed from UR in three ways, in order of precedence:

1. `--ollama-host <url>` CLI flag (session only)
2. `OLLAMA_HOST` environment variable
3. `ollama.host` in user settings (`~/.ur/settings.json`)

Examples:

```sh
# Session-only
ur --ollama-host http://192.168.1.50:11434

# Via environment
OLLAMA_HOST=http://192.168.1.50:11434 ur

# Persistent setting
ur --settings '{"ollama":{"host":"http://192.168.1.50:11434"}}'
```

Model selection environment variables still work the same way:

```sh
OLLAMA_MODEL=qwen3-coder:480b-cloud
UR_MODEL=qwen3-coder:480b-cloud
```

`OLLAMA_MODEL` selects the model name and takes precedence over `UR_MODEL` only
for Ollama runtime sessions. If neither is set, UR lets its Ollama router choose
from the model list advertised by the configured Ollama app.

### Discovering LAN Ollama servers

UR can scan your active local subnets for other Ollama servers and show a picker. This works for both wired Ethernet and wireless (Wi-Fi/WLAN) interfaces:

```sh
ur --discover-ollama
```

This is **session-only**: the picker appears and the chosen host is used for
that session, but plain `ur` continues to use `localhost:11434` unless you set
`ollama.host` explicitly.

To make the picker appear on every startup, enable it in user settings:

```json
{
  "ollama": {
    "lanDiscovery": true
  }
}
```

The scan is limited to active local IPv4 interfaces, ignores loopback/link-local
addresses, and uses bounded concurrency with short timeouts. It is opt-in and
never runs automatically unless enabled.

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

Run `ur test-first install` to detect the current project stack and merge the
compile/test/lint commands it finds into `afterEdit`.

After a turn that modified files, every `afterEdit` command must exit 0
before the agent can declare the task complete. A failing command surfaces
to the model as a structured reminder with the command name and the trimmed
stdout/stderr.

## Project Safety Policy

`ur safety` exposes the project shell safety policy:

```sh
ur safety status
ur safety init
ur safety check --command "rm -rf build"
```

The default policy separates command behavior into read, write, execute, and
network permission classes. It asks before destructive operations, recommends
sandboxing for write/execute/network commands, and denies common secret-file or
secret-like environment exfiltration patterns before broad Bash allow rules.
Command classification parses the shell command with an AST parser and falls
back to a conservative heuristic when parsing fails; anything it cannot
confidently classify is routed to the normal permission prompt instead of
being silently allowed.

Run `ur safety init` to write `.ur/safety-policy.json`. Commit it only when the
rules are safe and useful for the whole team; keep machine-local secrets and
local settings out of Git.

## Sandbox

`ur sandbox` inspects the OS-level sandbox that wraps UR-run Bash/File tool
commands:

```sh
ur sandbox status
ur sandbox check
ur sandbox eval "rm -rf build"
```

UR enforces this policy before running a UR Bash/File tool call, not after.
Sandbox behavior has three modes, controlled by `sandbox.enabled` and
`sandbox.failIfUnavailable` in settings:

- **disabled** — `sandbox.enabled: false` (default). No OS-level confinement;
  permission checks from the safety policy still apply.
- **recommended** — `sandbox.enabled: true`, `sandbox.failIfUnavailable: false`.
  Commands run sandboxed when OS support is available; if it is not, UR warns
  and continues unsandboxed rather than blocking work.
- **required** — `sandbox.enabled: true`, `sandbox.failIfUnavailable: true`.
  UR fails closed: it refuses to start rather than run without a working
  sandbox.

OS confinement depends on platform support: `sandbox-exec` (Seatbelt) on
macOS, or `bwrap` (bubblewrap) on Linux/WSL2. `ur sandbox check` reports
missing dependencies for the current platform.

This sandbox covers UR-run Bash/File tool commands only. For subscription CLI
providers, it does not extend to actions the external CLI performs internally
— see [Provider Guide](providers.md).

## Project Context Pack

`ur context-pack` writes durable architecture context and task memory:

```sh
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack remember --constraint "Do not expose secret values"
ur context-pack remember --command "bun run typecheck"
ur context-pack remember --diff "Safety policy wired into Bash permission checks"
ur context-pack compress
```

Generated files:

- `.ur/project-manifest.json` — architecture manifest from Project DNA,
  package scripts, instruction files, Cursor-style rules, `.ur/verify.json`,
  `.ur/safety-policy.json`, MCP config, editor settings, workflow files, and
  other manifests.
- `.ur/context/architecture.md` — human-readable architecture summary.
- `.ur/context/task-memory.jsonl` — decisions, constraints, commands, diffs,
  and notes.
- `.ur/context/compressed.md` — compressed task context summary.

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
