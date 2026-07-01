# Agent Communication / Client Protocol (ACP)

UR exposes two ACP surfaces:

1. **Stdio ACP agent** (`ur acp stdio`) — newline-delimited JSON-RPC over stdio,
   the protocol Zed and ACP-capable editors speak. Use this for native editor
   integration.
2. **HTTP JSON-RPC server** (`ur acp serve`) — a loopback HTTP endpoint for
   scripting, task delegation, and custom clients. This is **not** Zed-style
   stdio ACP; use the stdio agent for native ACP editors.

## Stdio ACP agent

```sh
ur acp stdio
```

The editor launches this process and exchanges one JSON-RPC object per line.

Methods:

| Method | Direction | Result |
| --- | --- | --- |
| `initialize` | client → agent | `{ protocolVersion, agentCapabilities, authMethods }` |
| `authenticate` | client → agent | `{}` (no auth required for local stdio) |
| `session/new` | client → agent | `{ sessionId }` |
| `session/prompt` | client → agent | `{ stopReason }`, with streaming `session/update` notifications |
| `session/cancel` | client → agent (notification) | aborts the in-flight prompt |
| `shutdown` | client → agent | `null` |

During `session/prompt` the agent emits `session/update` notifications:

```json
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "sess_…",
    "update": { "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "…" } } } }
```

`session/prompt` resolves with `{ "stopReason": "end_turn" }` (or `"cancelled"`
if a `session/cancel` arrived). Configure it with `ur ide config zed`.

## HTTP JSON-RPC server

```sh
ur acp serve --host 127.0.0.1 --port 8123 [--token <secret>] [--debug]
ur acp status [--json]
ur acp stop
```

Binds to loopback only; binding off-loopback requires `--token`. `--debug` logs
each method and outcome to stderr. POST JSON-RPC to `/acp`; `GET /healthz`
returns `{ ok: true }`.

Methods: `initialize` (returns `capabilities` and `workspaceRoot`),
`session/new`, `session/prompt`, `session/cancel`, `tools/list`, `tools/call`,
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
  "result": { "name": "ur-agent", "protocolVersion": "0.1.0",
    "workspaceRoot": "/path/to/project",
    "capabilities": { "tools": true, "tasks": true, "sessions": true,
      "ide": true, "streaming": false, "cancellation": true } } }
```

## Capabilities and limitations

- The stdio agent streams via `session/update`; token-level granularity depends
  on the active provider.
- The HTTP server returns unary responses (`streaming: false`); use the stdio
  agent for incremental updates.
- Neither surface silently falls back to another provider; dispatch failures are
  reported with the selected provider, model, and runtime backend.
- Errors use JSON-RPC error objects (`-32601` method not found, `-32602` bad
  params, `-32001` unauthorized, `-32603` internal).
