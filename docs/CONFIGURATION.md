# Configuration

UR reads configuration from CLI flags, environment variables, and project or user settings files.

## Model Providers

UR-Nexus supports official provider access paths only:

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

UR-Nexus never scrapes browser sessions, extracts OAuth refresh tokens, reads
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

`provider.fallback` is diagnostic recovery metadata, not automatic routing.
When the active provider fails, `ur provider doctor` shows the configured
recovery command; changing providers remains an explicit user action.

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

The same provider-first picker is mandatory on the first interactive run in a
workspace with no model in `.ur/settings.json` or `.ur/settings.local.json`.
The result is validated and written to the gitignored local settings file.
User-global and built-in model defaults do not silently select a model for a
new folder. `--model`, `OLLAMA_MODEL`, `UR_MODEL`, agent configuration,
`--settings`, managed settings, and resumed sessions are deliberate selections
and therefore do not open the startup picker. Fresh `-p` runs without one of
those inputs fail with an actionable message before making a model request.

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
OPENAI_COMPATIBLE_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

### OpenAI Responses transport

OpenAI uses Chat Completions unless the Responses transport is selected
explicitly:

```sh
ur config set openai_transport responses
ur config set responses.store false
ur config set responses.compact_threshold 20000
ur config set responses.tool_search hosted
```

Supported safe settings are `chat-completions|responses`, boolean
`responses.store`, an integer compaction threshold of at least 1,000 tokens,
and `off|hosted` tool search. Responses defaults to `store=false`, no server
compaction, and no deferred tool search. Background and WebSocket state is kept
under `.ur/openai-responses/` with private atomic writes; identifiers, status,
model, mode, and cursors are the only plaintext durable fields. To retain an
opaque compacted window, set `UR_OPENAI_RESPONSES_STATE_KEY` to exactly 32
bytes encoded as 64 hexadecimal characters or base64. Without that key UR
refuses to persist compacted context.

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
OLLAMA_MODEL=qwen2.5-coder:7b
UR_MODEL=qwen2.5-coder:7b
```

`OLLAMA_MODEL` selects the model name and takes precedence over `UR_MODEL` only
for Ollama runtime sessions. If neither is set and the workspace has no saved
model, interactive startup asks and headless startup requires `--model`.

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

## Prompt Planning

UR-Nexus can plan an `ur exec` prompt into ordered executable tasks, show a task
board, run independent tasks through adaptive parallel logical workers, and
verify task claims after execution. Short prompts stay as one compact task when
splitting is not useful. Longer prompts are decomposed by explicit ordering,
bullets, dependencies, and file targets. The defaults are:

```json
{
  "taskPlanning": true,
  "parallelAgents": true,
  "maxAgents": 3,
  "showTaskBoard": true,
  "strictVerification": true
}
```

`taskPlanning` enables prompt decomposition. `parallelAgents` allows independent
tasks to run concurrently up to `maxAgents`; the scheduler still uses only the
number of agents that is useful for the current dependency graph and file locks.
Simple prompts use one agent, medium independent prompts use two or three when
useful, and large independent task graphs can use the configured maximum.
`showTaskBoard` renders visible progress during real execution and keeps the
final ordered board in the execution report. The board shows ordered tasks,
current status, the running task, finished tasks, tasks waiting for approval or
context, active/max agents, queued tasks, and finished/failed/waiting/skipped
counts. `strictVerification` rejects unsupported claims about changed files,
commands, or generated output. With `--no-strict-verification`, unsupported
claims become warnings and the task may finish when no hard execution error was
observed.

Legacy nested configuration is still accepted under `urAgent`, while new
configuration can use the top-level keys above or a `nexus` object.

Per-run flags:

```sh
ur exec "update docs and tests" --max-agents 3
ur exec "run exactly one direct prompt" --no-task-planning
ur exec "plan but run sequentially" --no-parallel-agents
ur exec "run without task board output" --no-task-board
ur exec "run quietly but keep the final board" --quiet
ur exec "warn instead of failing unsupported claims" --no-strict-verification
```

Risky actions use an approval-first workflow. UR-Nexus asks for approval before
destructive commands, outside-workspace writes/deletes, network actions,
credential-sensitive access, security testing commands, exploit-like commands,
or commands that affect external systems. The request explains the action, why
approval is required, and the command or file path when available. The action is
not executed until approval evidence exists, and the decision is recorded in
the final report.

Outside-workspace reads are allowed when explicitly requested or clearly needed
for the task, and the outside path is recorded as evidence. Modifying, removing,
or deleting anything outside the workspace requires explicit approval first.
For cybersecurity or security-research tasks, UR-Nexus supports authorized
workflows by asking for target scope and authorization confirmation when needed.
Vague requests are converted into scoped research tasks that wait for approval;
local, lab, and test targets are preferred unless the user confirms authorized
external scope.

The final `ur exec` report is generated from task execution evidence only:
finished, waiting approval/context, failed, and skipped task records, actual
changed files from workspace snapshots, unreported changed files,
outside-workspace files accessed or modified, verified commands surfaced by the
executor, unverified command claims, approval decisions, verification failures,
warnings, and remaining limitations. Command tracking cannot prove detached or
provider-internal activity unless the task runner surfaces those commands as
observed evidence.

## Project Safety Policy

The project safety policy lives at `.ur/safety-policy.json`. By default,
autonomous safe mode requires sandbox coverage for write, execute, and network
commands. Project owners who want to personally approve local network checks
instead of hard-requiring sandbox network isolation can remove `network` from
`sandboxRequiredFor`:

```json
{
  "version": 1,
  "sandboxRequiredFor": ["write", "execute"]
}
```

That setting makes commands such as `curl -s http://localhost:8000/ | head -20`
eligible for the normal permission flow instead of failing only because the
sandbox is unavailable. Secret-file and destructive-command rules still apply
unless explicitly changed by the project policy.

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

Memory and learning defaults:

- Auto-memory is enabled by default. Disable with `autoMemoryEnabled: false`,
  `UR_CODE_DISABLE_AUTO_MEMORY=1`, or `--bare`.
- Automatic learning is enabled by default. Disable with
  `automaticLearningEnabled: false` or `UR_CODE_DISABLE_AUTO_LEARNING=1`.
- Automatic learning folds local outcome stats only; it does not call a model
  unless you explicitly run `/learn run --reflect`.

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
                          # project gates; approval is requested once per user turn
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

To turn the sandbox on or off, use the `/config` tool or run:

```sh
ur config set sandbox.enabled true
ur config set sandbox.enabled false
```

You can also inspect the current state with `ur sandbox status`.

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
ur context-pack memory verify
ur context-pack memory quarantine
ur context-pack memory rollback --to <entry-id>
ur context-pack compress
```

Generated files:

- `.ur/project-manifest.json` — architecture manifest from Project DNA,
  package scripts, instruction files, Cursor-style rules, `.ur/verify.json`,
  `.ur/safety-policy.json`, MCP config, editor settings, workflow files, and
  other manifests.
- `.ur/context/architecture.md` — human-readable architecture summary.
- `.ur/context/task-memory.jsonl` — private, append-only decisions,
  constraints, commands, diffs, and notes with explicit provenance, UUIDs, and
  a SHA-256 content/hash chain. Legacy entries are anchored when the chain
  starts rather than silently rewritten.
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
ur mcp serve
UR_MCP_HTTP_TOKEN='<secret>' ur mcp serve-http --port 8976
```

MCP servers may execute code or access external services. Only enable servers you trust, and keep credentials out of committed config.

When UR itself runs as an MCP server, tool requests are non-interactive:
schema validation and normal permission checks still run, and any operation
that would require an approval prompt is rejected. Resource limits can be
adjusted with `UR_MCP_MAX_CALLS_PER_MINUTE`,
`UR_MCP_MAX_CONCURRENT_CALLS`, `UR_MCP_TOOL_TIMEOUT_MS`,
`UR_MCP_MAX_INPUT_CHARS`, and `UR_MCP_MAX_OUTPUT_CHARS`.

`serve-http` is a separate, opt-in MCP 2026-07-28 compatibility surface at
`POST /mcp`. It is stateless at the transport layer and exposes capability-
negotiated Tasks and a self-contained overview App backed by UR's real MCP
tool registry. Every call must supply matching protocol/method/name metadata.
Off-loopback binds require `UR_MCP_HTTP_TOKEN`; browser clients also require an
exact `--allow-origin`. HTTP request, rate, concurrency, task-retention, and
runtime limits use the `UR_MCP_HTTP_*` prefix. Durable task state is private,
owner-isolated, bounded, atomic, and quarantined if corrupt.

## Background Agents

Detached `ur bg` task state is stored under `.ur/background/`. Manifest updates
use a cross-process lock and atomic mode-`0600` replacement; task logs, outputs,
and steering inboxes are created mode `0600` under mode-`0700` directories.
The loader rejects corrupt, oversized, or structurally invalid manifests rather
than silently replacing them. `UR_BACKGROUND_MAX_MANIFEST_BYTES` controls the
manifest byte ceiling (16 MiB by default, capped at 64 MiB), and
`UR_BACKGROUND_MAX_TASKS` controls the retained task ceiling (5,000 by default,
capped at 20,000).

## Agent Servers

For native editor integration, `ur acp stdio` implements stable Agent Client
Protocol v1 through the official SDK. Its resource controls use the
`UR_ACP_STDIO_*` prefix. It supports client-provided MCP stdio/HTTP/SSE
servers, additional workspace roots, native permission requests, cancellation,
and persistent list/load/delete/resume/close with exact history replay, modes,
config options, and available commands; see the [ACP Guide](ACP.md).

`ur acp serve` is a separate UR HTTP JSON-RPC API. Set `UR_ACP_TOKEN` instead
of putting its bearer token in argv. Request, task, and tool limits use the
`UR_ACP_*` prefix.

`ur a2a serve` exposes strict v1 JSON-RPC and HTTP+JSON bindings alongside the
stable official-SDK v0.3 JSON-RPC binding and a separate UR compatibility task
API. Use `UR_A2A_TOKEN` for a static operator token or
`UR_A2A_DELEGATION_SECRET` for issuer-minted skill/tenant-scoped tokens. Limits
use the `UR_A2A_*` prefix. See the [A2A Guide](A2A.md) for endpoints, protocol
negotiation, proxy setup, and isolation.

`ur ag-ui serve` exposes an opt-in AG-UI HTTP/SSE adapter at `POST /ag-ui`,
with capability discovery at `GET /ag-ui/capabilities`. It binds to loopback by
default; off-loopback binds require `UR_AG_UI_TOKEN`, and browser clients must
be listed with exact `--allow-origin` values. Request, rate, concurrency,
runtime, and output controls use the `UR_AG_UI_*` prefix. Unsupported client
tools, multimodal/encrypted input, interrupts, and unimplemented transports are
rejected rather than silently ignored. See the [AG-UI Guide](AG_UI.md).

## Plugins and Skills

Plugins can add commands, tools, and skills:

```sh
ur plugin list
ur plugin install <plugin>
ur plugin update <plugin>
ur plugin disable <plugin>
```

Skills can be stored in `.ur/skills/` for project-specific workflows or in
`~/.ur/skills/` for personal workflows. UR also discovers the cross-client
`.agents/skills/` and `~/.agents/skills/` locations from the Agent Skills
integration guide. At an equal scope, native `.ur` skills win; project skills
win over user skills, and nearer project roots win over parent roots.

Portable `SKILL.md` directories are validated against the Agent Skills
frontmatter contract and receive deterministic content and permission digests.
Inspect and sign them with:

```sh
ur skill verify <name-or-directory> [--require-trusted] [--json]
ur skill keygen <key-id> [--out <private-key.pem>]
ur skill sign <name-or-directory> --key <private-key.pem> --key-id <key-id>
```

Set `UR_SKILLS_STRICT_SPEC=true` to reject spec-invalid file skills and
`UR_SKILLS_REQUIRE_TRUSTED_SIGNATURE=true` to require a verified key at load
and invocation. `UR_SKILL_TRUSTED_KEYS_FILE` can override the private trusted
key store (normally under the UR config directory). Signed skills cannot
contain symlinks and are re-hashed immediately before every invocation.

## OpenTelemetry

No telemetry exporter is enabled by default. Configure each signal with the
standard `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, and
`OTEL_LOGS_EXPORTER` variables; supported values are `otlp`, `console`, or
`none`. OTLP uses HTTP/protobuf and the standard
`OTEL_EXPORTER_OTLP[_<SIGNAL>]_ENDPOINT` variables. UR validates endpoints,
protocols, and export intervals before registering providers.

GenAI spans and metrics cover inference, agent/workflow invocation, tools, memory,
duration, token/cache usage, response identity, finish reason, time to first
chunk, and bounded error type. Content is excluded unless
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`; use
`UR_OTEL_GENAI_PROVIDER` only when a gateway hides the provider identity.
`OTEL_SDK_DISABLED=true` disables the SDK globally.

## Secrets

Keep secrets in environment variables, local settings, a secret manager, or your shell profile. Never commit API keys, OAuth tokens, private keys, service-account JSON, or `.env` files.
