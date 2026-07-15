# Agent Client Protocol (ACP)

UR exposes one native ACP transport and one separate HTTP integration surface:

1. **Stdio ACP agent** (`ur acp stdio`) — the stable ACP v1 wire protocol over
   newline-delimited JSON-RPC, implemented with the official TypeScript SDK.
   Use this for Zed and other native ACP clients.
2. **UR HTTP JSON-RPC compatibility server** (`ur acp serve`) — a separate
   loopback endpoint for scripting, the experimental JetBrains plugin, tool
   calls, and background tasks. It is not an ACP transport binding and is not
   advertised as one.

## Stdio ACP agent

```sh
ur acp stdio
```

The editor launches this process and exchanges one JSON-RPC object per line.
The official SDK owns wire parsing, request concurrency, notification
semantics, and error envelopes.

Methods:

| Method | Direction | Result |
| --- | --- | --- |
| `initialize` | client → agent | `{ protocolVersion, agentCapabilities, authMethods }` |
| `authenticate` | client → agent | `{}` (no auth required for local stdio) |
| `session/new` | client → agent | `{ sessionId }` |
| `session/list` | client → agent | returns a 50-item page and opaque, filter-bound cursor |
| `session/load` | client → agent | restores a session and replays its exact ordered updates |
| `session/delete` | client → agent | deletes private metadata and history after stopping active work |
| `session/resume` | client → agent | restores identity without replaying history |
| `session/close` | client → agent | cancels active work and releases the in-process session |
| `session/set_mode` | client → agent | selects `default`, `acceptEdits`, or `plan` |
| `session/set_config_option` | client → agent | selects full tool updates or permission-only updates |
| `session/prompt` | client → agent | `{ stopReason }`, with streaming `session/update` notifications |
| `session/cancel` | client → agent (notification) | aborts the in-flight prompt |
| `session/request_permission` | agent → client | asks the user to allow or reject a tool call |

During `session/prompt` the agent emits `session/update` notifications:

```json
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "sess_…",
    "update": { "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "…" } } } }
```

`session/prompt` resolves with `{ "stopReason": "end_turn" }` (or `"cancelled"`
if a `session/cancel` arrived). Repeated prompts resume the underlying UR CLI
conversation for that ACP session. `session/resume` reconnects after an agent
restart without replay; `session/load` emits the bounded, exact stored update
sequence before current session information and available commands. UR stores
the ACP-to-CLI identity, working directory, modes/options, and append-only
history in private metadata under `~/.ur/acp/sessions/`. Writes are locked,
atomic, bounded, migration-aware, and fail closed on malformed state. MCP
credentials are never persisted there. Configure the agent with
`ur ide config zed`.

The stdio surface advertises text and resource-link prompt support, additional
workspace directories, MCP stdio/HTTP/SSE transports, load/list/delete,
resume/close, modes, configuration options, and available commands.
Client-provided MCP configuration is validated, written to a mode-`0600`
temporary file instead of argv, and removed after each turn. Image, audio, and
embedded-context capabilities are not advertised.

Tool calls that require approval are bridged to the client's native ACP
permission UI with allow-once, reject, and (when UR supplies a durable rule)
always-allow choices. Cancellation and client errors fail closed. The prompt is
sent over stdin rather than argv. Session count, prompt size, output size, and
runtime are bounded by `UR_ACP_STDIO_MAX_SESSIONS`,
`UR_ACP_STDIO_MAX_PROMPT_CHARS`, `UR_ACP_STDIO_MAX_OUTPUT_CHARS`, and
`UR_ACP_STDIO_PROMPT_TIMEOUT_MS`. History additionally enforces per-event,
event-count, total-byte, and discovery-scan limits.

## HTTP JSON-RPC server

```sh
UR_ACP_TOKEN='<secret>' ur acp serve --host 127.0.0.1 --port 8123 [--debug]
ur acp status [--json]
ur acp stop
```

Binds to loopback by default; binding off-loopback requires a bearer token.
Prefer `UR_ACP_TOKEN` because command-line secrets may be visible to other
local processes. `--debug` logs method names and outcomes—not request params or
secrets—to stderr. POST JSON-RPC to `/acp`; `GET /healthz` returns `{ ok: true }`.

Tool calls are schema-validated and pass through the normal permission engine.
Because the HTTP API has no interactive approval channel, requests that need an
approval fail closed. Requests, prompts, tool I/O, task submission rate, tool
call rate, concurrency, retained sessions/tasks, response size, and runtime are
bounded. A session may select an existing subdirectory of the configured server
workspace, but cannot escape that root (including through symlinks). Deployments
can tune these defaults with `UR_ACP_MAX_REQUESTS_PER_MINUTE`,
`UR_ACP_MAX_CONCURRENT_REQUESTS`, `UR_ACP_MAX_REQUEST_BYTES`,
`UR_ACP_MAX_RESPONSE_BYTES`, `UR_ACP_MAX_ERROR_CHARS`,
`UR_ACP_MAX_PROMPT_CHARS`, `UR_ACP_MAX_SESSIONS`,
`UR_ACP_MAX_ACTIVE_TASKS`, `UR_ACP_MAX_RETAINED_TASKS`,
`UR_ACP_MAX_TASKS_PER_MINUTE`, `UR_ACP_MAX_CONCURRENT_TASKS`,
`UR_ACP_MAX_TASK_OUTPUT_BYTES`, `UR_ACP_TASK_TIMEOUT_MS`,
`UR_ACP_MAX_TOOL_CALLS_PER_MINUTE`, `UR_ACP_MAX_CONCURRENT_TOOL_CALLS`,
`UR_ACP_TOOL_TIMEOUT_MS`, `UR_ACP_MAX_TOOL_INPUT_CHARS`, and
`UR_ACP_MAX_TOOL_OUTPUT_CHARS` environment variables.

Methods: `initialize` (returns `capabilities` and `workspaceRoot`),
`session/new`, `session/prompt`, `session/cancel`, `session/close`, `tools/list`, `tools/call`,
`tasks/send` / `tasks/get` / `tasks/cancel`, `ide/diffCapture`, `ide/select`,
and `shutdown` (acknowledges, then stops the server).

Example:

```sh
curl -s http://127.0.0.1:8123/acp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

```json
{ "jsonrpc": "2.0", "id": 1,
  "result": { "name": "UR", "protocolVersion": "0.1.0",
    "workspaceRoot": "/path/to/project",
    "capabilities": { "tools": true, "tasks": true, "sessions": true,
      "ide": true, "streaming": false, "cancellation": true } } }
```

## Capabilities and limitations

- The stdio agent streams text deltas via `session/update`; chunk granularity
  depends on the active provider's stream.
- The HTTP server returns unary responses (`streaming: false`); use the stdio
  agent for incremental updates.
- Neither surface silently falls back to another provider; dispatch failures are
  reported with the selected provider, model, and runtime backend.
- Errors use JSON-RPC error objects (`-32601` method not found, `-32602` bad
  params, `-32001` unauthorized, `-32603` internal).
