# Agent2Agent (A2A)

UR exposes an opt-in agent-to-agent server with two deliberately distinct API
surfaces:

| Surface | Path | Contract |
| --- | --- | --- |
| Agent Card | `/.well-known/agent-card.json` | Strict v1 card by default; send `A2A-Version: 0.3` for the separate v0.3 card |
| A2A v1 JSON-RPC | `/` or `/a2a/v1/jsonrpc` | Stable-SDK ProtoJSON, PascalCase lifecycle methods, SSE streaming, `A2A-Version: 1.0` |
| A2A v1 HTTP+JSON | `/message:send`, `/message:stream`, `/tasks`, or `/a2a/v1/...` | Versioned REST lifecycle, SSE subscription, push configuration, pagination, artifacts, references, and cancellation |
| A2A v0.3 JSON-RPC | `/a2a/jsonrpc` | Explicit SDK compatibility transport, including streaming/resubscription |
| UR compatibility API | `/a2a/tasks` and `/a2a/tasks/:id` | UR-specific REST-style background-task controls; not an A2A REST binding |

UR uses `@a2a-js/sdk` 1.1 as its native v1 execution engine. The SDK's explicit
v0.3 compatibility transport translates older peers onto the same bounded,
durable task store; UR does not keep a second legacy SDK runtime. JSON-RPC and
HTTP+JSON streaming, in-flight task resubscription, and webhook push
(authenticated for public destinations) are advertised because each path has
end-to-end tests. UR does not
advertise a gRPC interface or authenticated extended Agent Card.

## Start the server

Loopback without authentication is allowed for local development:

```sh
ur a2a serve --port 8765
```

For authenticated use, keep secrets out of process arguments:

```sh
UR_A2A_TOKEN='<random-secret>' ur a2a serve --port 8765
```

An off-loopback bind requires either `UR_A2A_TOKEN` or
`UR_A2A_DELEGATION_SECRET`. A wildcard bind also requires a reachable external
base URL so the Agent Card never advertises `0.0.0.0`:

```sh
UR_A2A_TOKEN='<random-secret>' \
  ur a2a serve --host 0.0.0.0 --port 8765 \
  --public-base-url https://agent.example.com
```

Terminate TLS at a trusted reverse proxy for non-loopback deployments; bearer
tokens must not travel over plaintext networks.

## Agent Card and protocol calls

Inspect the live card:

```sh
curl -s http://127.0.0.1:8765/.well-known/agent-card.json
```

Preview either card without starting the server:

```sh
ur a2a card --v1                         # current A2A 1.0 card
ur a2a card                              # legacy 0.3 compatibility card
ur a2a card --v1 --base-url https://agent.example.com
```

Without a version header, discovery returns the v1 ProtoJSON card with
`supportedInterfaces` for JSON-RPC, HTTP+JSON, and the legacy v0.3 binding. Use
`A2A-Version: 0.3` to retrieve the standalone v0.3 SDK card. Both cards report
the installed UR version, skills, implemented capabilities, and only the
authentication schemes configured for that server; responses include
`Vary: A2A-Version`.

Send a blocking v1 message over JSON-RPC:

```sh
curl -s http://127.0.0.1:8765/a2a/v1/jsonrpc \
  -H 'content-type: application/json' \
  -H 'A2A-Version: 1.0' \
  -H "authorization: Bearer $UR_A2A_TOKEN" \
  -d '{
    "jsonrpc":"2.0",
    "id":"request-v1",
    "method":"SendMessage",
    "params":{
      "configuration":{"returnImmediately":false},
      "message":{
        "messageId":"message-v1",
        "role":"ROLE_USER",
        "parts":[{"text":"Review the current diff."}]
      }
    }
  }'
```

The v1 HTTP+JSON binding accepts `application/a2a+json` and exposes
`message:send`, `message:stream`, task list/get/cancel/subscribe, push
notification configuration, continuation, and artifact/reference operations
at the advertised transport root or under `/a2a/v1`. Stream responses use
`text/event-stream`; each SSE `data` field contains one ProtoJSON
`StreamResponse`. List cursors are opaque and filter-bound. An optional tenant
segment, for example `/a2a/v1/acme/tasks`, requires a matching `tenant:acme`
delegation scope.

Stream a v1 request:

```sh
curl -N http://127.0.0.1:8765/a2a/v1/message:stream \
  -H 'content-type: application/a2a+json' \
  -H 'A2A-Version: 1.0' \
  -H "authorization: Bearer $UR_A2A_TOKEN" \
  -d '{
    "metadata":{"skill":"coding-agent"},
    "message":{
      "messageId":"stream-v1",
      "role":"ROLE_USER",
      "parts":[{"text":"Review the current diff."}]
    }
  }'
```

Reconnect to an in-flight task with
`POST /a2a/v1/tasks/{taskId}:subscribe`, or use the JSON-RPC
`SubscribeToTask` method. A subscription first receives the current task
snapshot, then subsequent status and artifact events from the same live event
bus.

Send a blocking v0.3 message:

```sh
curl -s http://127.0.0.1:8765/a2a/jsonrpc \
  -H 'content-type: application/json' \
  -H 'A2A-Version: 0.3' \
  -H "authorization: Bearer $UR_A2A_TOKEN" \
  -d '{
    "jsonrpc":"2.0",
    "id":"request-1",
    "method":"message/send",
    "params":{
      "configuration":{"blocking":true},
      "metadata":{"skill":"coding-agent"},
      "message":{
        "kind":"message",
        "messageId":"message-1",
        "role":"user",
        "parts":[{"kind":"text","text":"Review the current diff."}]
      }
    }
  }'
```

Set `configuration.blocking` to `false` to receive a working task promptly,
then call `tasks/get`; use `tasks/cancel` for a nonterminal task. The v0.3
compatibility binding supports `message/send`, `message/stream`, `tasks/get`,
`tasks/cancel`, `tasks/resubscribe`, and push configuration. It uses the v0.3
wire shapes while sharing the v1 task engine. Authenticated
extended cards remain unsupported.

`params.metadata.skill` selects an advertised skill; the default is
`coding-agent`. Requests with an unknown skill are rejected before execution.
Prompts enter the child process through stdin, and the child uses fail-closed
`dontAsk` permissions because this network binding has no interactive approval
bridge.

## Push notifications

The v1 HTTP+JSON routes are:

- `POST /tasks/{taskId}/pushNotificationConfigs`
- `GET /tasks/{taskId}/pushNotificationConfigs`
- `GET /tasks/{taskId}/pushNotificationConfigs/{configId}`
- `DELETE /tasks/{taskId}/pushNotificationConfigs/{configId}`

A loopback development callback may use HTTP and omit `authentication`; this
works directly for `localhost`, `127.0.0.0/8`, and `::1` receivers without an
allow-list entry. UR sends no `Authorization` header when the configuration has
no authentication object.

By default, public and other non-loopback destinations must use HTTPS and
include both
`authentication.scheme` and `authentication.credentials`; UR sends them in the
webhook `Authorization` header. UR validates DNS at registration and again
immediately before delivery, follows no redirects, and pins the validated
address into the outbound connection. Unlisted private, link-local, multicast,
documentation, and metadata destinations are rejected.

For an intentional non-loopback development receiver, an operator can allow
one exact origin:

```sh
UR_A2A_PUSH_ALLOWED_ORIGINS=http://192.168.1.20:9000 ur a2a serve
```

Multiple origins are comma-separated. This exception can permit HTTP or a
private destination, but it does not waive authentication for a non-loopback
receiver. Do not use a broad or user-controlled value. Push
credentials are kept in process memory instead of being written to the task
manifest; clients should register them again after a server restart.

## Delegation tokens

UR delegation tokens are short-lived HMAC-signed capabilities bound to a
subject, one audience, an expiry, and explicit skill scopes:

```sh
export UR_A2A_DELEGATION_SECRET='<issuer-secret>'
TOKEN=$(ur a2a token mint --sub peer-a --aud ur-nexus \
  --scope coding-agent --ttl 900)
printf '%s\n' "$TOKEN" | ur a2a token verify --token-stdin \
  --aud ur-nexus --scope coding-agent
```

The HMAC secret belongs only to the trusted issuer. A narrower child token can
be minted by that issuer, but an untrusted holder cannot attenuate the token
without the root signing secret. Protocol and compatibility tasks are isolated
by both delegation subject and skill, including get, continue, reference, and
cancel operations.

## UR compatibility task API

The compatibility API preserves older UR-specific background options:

- `POST /a2a/tasks` — submit `{ prompt, skill, mode, worktree, model, maxTurns }`
- `GET /a2a/tasks` — list tasks visible to the caller
- `GET /a2a/tasks/:id` — status
- `GET /a2a/tasks/:id/output` — bounded output metadata and logs
- `POST /a2a/tasks/:id/cancel` or `DELETE /a2a/tasks/:id` — cancel

These routes do not use the A2A wire schema and must not be presented to A2A
clients as an A2A REST endpoint. `skipPermissions` additionally requires the
static operator token or a delegation scope of `permissions:bypass`.

## Operational limits

The server bounds work with these environment variables:

- `UR_A2A_MAX_REQUEST_BYTES` and `UR_A2A_MAX_PROMPT_CHARS`
- `UR_A2A_MAX_OUTPUT_BYTES`
- `UR_A2A_MAX_SUBMISSIONS_PER_MINUTE`
- `UR_A2A_MAX_CONCURRENT_SUBMISSIONS`
- `UR_A2A_MAX_ACTIVE_TASKS`
- `UR_A2A_MAX_ACTIVE_TASKS_PER_OWNER`
- `UR_A2A_TASK_TIMEOUT_MS`
- `UR_A2A_PUSH_TIMEOUT_MS`
- `UR_A2A_PUSH_DNS_TIMEOUT_MS`
- `UR_A2A_PUSH_ALLOWED_ORIGINS` (exact, comma-separated non-loopback development exceptions)

Protocol task state and v1 artifacts are persisted with owner, tenant, skill,
and version metadata under `.ur/a2a/` using owner-only permissions and atomic
writes. Retrieval, continuation, reference lookup, listing, and cancellation
all re-check the caller boundary. UR compatibility task state remains under the
same directory and links to `.ur/background/` output files.

References: [A2A v1 specification](https://a2a-protocol.org/latest/specification/),
[A2A v1 announcement](https://a2a-protocol.org/latest/announcing-1.0/),
[official JavaScript SDK](https://github.com/a2aproject/a2a-js), and
[official TCK](https://github.com/a2aproject/a2a-tck).
