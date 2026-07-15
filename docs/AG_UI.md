# AG-UI Integration

UR-Nexus 1.47 exposes an opt-in [AG-UI](https://docs.ag-ui.com/) HTTP adapter
for user-facing applications. It validates the official `RunAgentInput` schema
and streams official AG-UI lifecycle, text, state, step, and tool events over
Server-Sent Events (SSE).

## Start the adapter

```sh
ur ag-ui serve
```

The default endpoint is `http://127.0.0.1:8977/ag-ui`. The adapter also exposes:

- `GET /ag-ui/capabilities` — machine-readable, schema-validated capabilities.
- `GET /healthz` — lightweight process health.

The default loopback binding requires no bearer token. To expose the adapter on
another interface, configure authentication in the environment:

```sh
UR_AG_UI_TOKEN='<random-secret>' \
  ur ag-ui serve --host 0.0.0.0 --port 8977
```

UR refuses an off-loopback bind without `UR_AG_UI_TOKEN`. Put the server behind
TLS before sending a bearer token over a non-loopback network.

## Browser clients

Browser origins are denied unless they are explicitly listed. Each value must
be an exact HTTP(S) origin, without a path, query, credentials, or wildcard:

```sh
ur ag-ui serve \
  --allow-origin https://app.example.com https://admin.example.com
```

When authentication is configured, send `Authorization: Bearer <token>`. The
endpoint requires `Content-Type: application/json` and an `Accept` value that
allows `text/event-stream`.

## Minimal request

```sh
curl --no-buffer http://127.0.0.1:8977/ag-ui \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "threadId": "thread-1",
    "runId": "run-1",
    "state": {},
    "messages": [
      {"id": "message-1", "role": "user", "content": "Review this repository."}
    ],
    "tools": [],
    "context": [],
    "forwardedProps": {}
  }'
```

The response is an ordered SSE stream beginning with `RUN_STARTED` and a
`STATE_SNAPSHOT`. UR then emits step, text, and tool events and terminates with
`RUN_FINISHED` or a redacted `RUN_ERROR`. The server validates every emitted
event through the official AG-UI schemas and uses the official SSE encoder.

## Supported contract

This adapter deliberately advertises only behavior that is implemented end to
end:

- HTTP/SSE streaming, text input/output, state snapshots, UR-configured tools,
  cancellation on disconnect, delegation, and code execution are supported.
- Client-provided tools, multimodal input, encrypted input, interrupt resume,
  persistent AG-UI state, WebSocket/binary transport, push notifications,
  reasoning events, and interactive human approvals are not advertised.
- Unsupported input is rejected with a structured `4xx` error; it is never
  silently discarded.

Every request supplies the complete transcript, state, context, and forwarded
properties for that run. UR labels this envelope as untrusted client data so a
client-supplied system message cannot replace UR's own system or safety policy.
Adapter runs use isolated session IDs and disable child-session persistence.

## Permissions

Select a permission mode explicitly when necessary:

```sh
ur ag-ui serve --permission-mode plan
ur ag-ui serve --permission-mode acceptEdits
```

The default is `default`. Because AG-UI runs have no interactive terminal
approval channel, any operation that still requires a prompt is denied. `plan`
is the safest read-oriented mode. Use `acceptEdits` only in a workspace where
the adapter is authorized to edit files; other permission checks still apply.

## Resource controls

The following environment variables are optional. Invalid or excessive values
fall back to bounded defaults or are capped by the implementation.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `UR_AG_UI_TOKEN` | unset | Required bearer secret for off-loopback binds. |
| `UR_AG_UI_MAX_REQUEST_BYTES` | `2000000` | Maximum request-body bytes. |
| `UR_AG_UI_MAX_CALLS_PER_MINUTE` | `120` | Rolling request rate per server process. |
| `UR_AG_UI_MAX_CONCURRENT_RUNS` | `8` | Concurrent active runs. |
| `UR_AG_UI_PROMPT_TIMEOUT_MS` | `1800000` | Per-run execution deadline. |
| `UR_AG_UI_MAX_OUTPUT_CHARS` | `10485760` | Maximum child stream output. |

Duplicate active `threadId`/`runId` pairs are rejected per authenticated owner.
Requests, identifiers, transcript/context data, tool payloads, output, stderr,
and stream lines are independently bounded. Error responses do not expose
provider stderr or internal exception details.

## Cost and privacy

AG-UI and the adapter dependencies are free/open-source software. Running an
AG-UI request uses whichever model provider UR is configured to use; that
provider may have its own pricing. Select a local Ollama model when you need a
fully local path without paid API calls. The deterministic AG-UI tests use an
injected fake runner and never contact a model provider.

Protocol references:

- [AG-UI architecture](https://docs.ag-ui.com/concepts/architecture)
- [AG-UI events](https://docs.ag-ui.com/concepts/events)
- [AG-UI JavaScript types](https://docs.ag-ui.com/sdk/js/core/types)
- [AG-UI reference implementation](https://github.com/ag-ui-protocol/ag-ui)
