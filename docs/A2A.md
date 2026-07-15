# Agent2Agent (A2A)

UR exposes an opt-in agent-to-agent server with two deliberately distinct API
surfaces:

| Surface | Path | Contract |
| --- | --- | --- |
| Agent Card | `/.well-known/agent-card.json` | Public discovery metadata that exactly describes the running server |
| A2A JSON-RPC | `/a2a/jsonrpc` | A2A protocol v0.3, implemented with the official stable JavaScript SDK |
| UR compatibility API | `/a2a/tasks` and `/a2a/tasks/:id` | UR-specific REST-style background-task controls; not an A2A REST binding |

The A2A specification itself is at v1. UR does not claim v1 conformance yet:
the official JavaScript SDK's v1 support is prerelease, while its current
stable line implements v0.3. UR will migrate and run the official conformance
suite when a stable JavaScript v1 path is available.

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

The card advertises protocol `0.3.0`, `JSONRPC`, `/a2a/jsonrpc`, unary task
execution, the installed UR version, skills, and only the authentication
schemes actually configured for that server.

Send a blocking message:

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
then call `tasks/get`; use `tasks/cancel` for a nonterminal task. The stable
binding supports `message/send`, `tasks/get`, and `tasks/cancel`. Streaming,
resubscription, push notifications, and authenticated extended cards are not
advertised and return protocol errors if requested.

`params.metadata.skill` selects an advertised skill; the default is
`coding-agent`. Requests with an unknown skill are rejected before execution.
Prompts enter the child process through stdin, and the child uses fail-closed
`dontAsk` permissions because this network binding has no interactive approval
bridge.

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

Protocol task state is persisted with owner and skill metadata in
`.ur/a2a/protocol-tasks.json` using owner-only file permissions. UR
compatibility task state remains under the same `.ur/a2a/` directory and links
to `.ur/background/` output files.

References: [A2A v1 specification](https://a2a-protocol.org/latest/specification/),
[official JavaScript SDK](https://github.com/a2aproject/a2a-js).
