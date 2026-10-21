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
Legacy unary tool/task requests have no interactive approval channel and fail
closed when approval is required. Durable session prompts bridge approval through
`session/events` and `session/approve`. Requests, prompts, tool I/O, task submission rate, tool
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
      "ide": true, "streaming": true, "durableSessions": true,
      "permissionRequests": true, "devicePairing": true, "teamControls": false,
      "cancellation": true } } }
```

## Capabilities and limitations

- The stdio agent streams text deltas via `session/update`; chunk granularity
  depends on the active provider's stream.
- HTTP responses are JSON rather than SSE. Durable `stream:true` prompts return
  a run ID immediately; poll `session/events` for incremental updates and replay.
- Neither surface silently falls back to another provider; dispatch failures are
  reported with the selected provider, model, and runtime backend.
- Errors use JSON-RPC error objects (`-32601` method not found, `-32602` bad
  params, `-32001` unauthorized, `-32603` internal).

## Durable remote sessions (HTTP)

The canonical endpoint also provides authenticated persistent control:

| Method | Parameters | Behavior |
|---|---|---|
| `session/prompt` | `sessionId`, `prompt`, `stream:true`, unique `requestId` | Returns a durable run ID; identical delivery reuses the same run |
| `session/events` | `sessionId`, `after` cursor, optional `waitMs` | Ordered incremental/replayed events, next cursor, completion/result |
| `session/approve` | `sessionId`, permission `requestId`, `decision:{behavior:"allow"}` or `"deny"` | Resolves one pending approval; stale/repeated decisions fail |
| `session/resume` | `sessionId` | Restores saved native session identity without resubmitting work |
| `device/new` | `sessionIds`, optional `expiresInMs` | Operator creates an expiring session-scoped bearer credential |
| `device/revoke` | `deviceId` | Operator invalidates subsequent credential use |

Persist `UR_CONFIG_DIR` (CLI transcripts) and `UR_REMOTE_STATE_DIR` (control state)
across server replacement. By default remote state is `.ur/remote/http` under the
served workspace. Journals require contiguous sequences and reject torn/corrupt
records; clients acknowledge only received events. Live worker ownership prevents
duplicate launches. Interrupted work resumes with prior outcomes explicitly
uncertain so the model can inspect effects. Revocation does not cancel an already
running task; use `session/cancel` as needed. Provider errors and missing/failed
terminal results remain failures even if partial output exists.

See the [native container recipe](../deployment/acp/README.md) for persistent
volumes, private configuration, logs, artifacts, previews and replacement.

## Optional team policy (HTTP)

Team controls are opt-in on this existing HTTP endpoint. Without a policy,
existing ACP behavior is unchanged. Set an absolute `UR_ACP_TEAM_POLICY` path
to an administrator-controlled JSON file **outside the served workspace**, and
`UR_REMOTE_STATE_DIR` to a private external directory (0700 on Unix). Protect
both from worker writes using the deployment's OS/container boundary. Keep the
operator bearer token outside prompts and worker environments.

```sh
UR_ACP_TEAM_POLICY="$HOME/.config/ur/team-policy.json" \
UR_REMOTE_STATE_DIR="$HOME/.local/state/ur-remote" \
UR_ACP_TOKEN='<operator-secret>' ur acp serve --host 127.0.0.1 --port 8123
```

Example policy (replace the device ID with one returned by `device/new`):

```json
{
  "version": 1,
  "teamId": "research",
  "budget": { "maxPrompts": 100, "maxConcurrentPrompts": 2 },
  "operator": { "secretEnvNames": ["OPENAI_API_KEY"] },
  "members": {
    "replace-device-id": {
      "role": "member",
      "maxPrompts": 20,
      "secretEnvNames": ["OPENAI_API_KEY"]
    }
  }
}
```

An empty membership map initially permits only the operator, who can create
sessions and pair devices; the administrator then adds the returned device IDs
to the policy. Policy is reloaded on each request. Existing device expiry,
session scope and revocation checks still apply. `viewer` reads assigned
sessions/status, `member` submits/cancels/closes assigned work, and `reviewer`
may answer assigned permission requests. None grants permanent tool approval.
Only the operator pairs/revokes devices, exports the team audit, or reconciles
unknown quota reservations. Revocation prevents subsequent authorized access;
cancel active work separately when it must stop.

Team execution uses `session/prompt` with `stream:true`. Legacy `tools/call`,
`tasks/send` and non-streaming prompts are refused in team mode because they
would bypass durable accounting. The unit is **accepted prompt attempts**,
not model API calls, turns, tokens or dollars. All members and the operator
share cumulative and concurrent limits; a member can have an additional
cumulative limit. Subagent/model calls inside one prompt are not separate
units. Request IDs are bound to exact prompt, session and principal; duplicate
delivery reuses the durable run without another quota charge or execution.
Failed accepted attempts remain charged. A dead controller's unknown
reservation continues to consume concurrency until reviewed; no silent refund
or automatic replay is inferred.

Additional UR HTTP JSON-RPC methods:

| Method | Parameters | Result/scope |
|---|---|---|
| `team/status` | `{}` | Shared budget/consumption, own usage, unknown reservations; operator also sees reservation IDs |
| `team/audit` | `{ "after": 0 }` | Operator-only bounded cursor export, sequence/hash chain, no prompts, outputs or credential values |
| `team/reconcile` | `{ "receiptId": "...", "reason": "review performed" }` | Operator acknowledges an unknown ended reservation after checking processes/effects; live owners cannot be released; total charge remains |

Audit records include actor, operation, outcome, policy digest and opaque
session/request IDs. Reconciliation stores a reason digest. Modified or torn
records fail validation. This local hash chain is not an external signature or
proof against administrator edits or valid-prefix truncation; export and anchor
it externally when that assurance is required.

### Scoped environment and reviewed automation

For a team prompt, the child inherits OS/runtime essentials plus exactly the
administrator's `secretEnvNames` for that principal. Ambient proxy URLs and
unclassified variables are excluded too; this is not a name-pattern-only scrub.
The operator token/control-state path never passes through, and each durable
session gets a private `UR_CONFIG_DIR`. Configure the selected provider/model
in the workspace and explicitly allow the provider's required environment
names. Source and native children use the same literal environment forwarding;
no global environment mutation is used.

This scopes environment credentials and UR configuration. It does not isolate
all host files, external CLI login stores, hooks, MCP processes or arbitrary
same-user host access. Use the optional sandbox/container deployment where
those boundaries are required. Existing tool permission choices still apply.

For reviewed automation, set `requireReviewedAutomation:true` and add a trusted
receipt under `automations`:

```json
{
  "nightly-check": {
    "sessionId": "sess_12345678-1234-1234-1234-123456789abc",
    "promptSha256": "<64 lowercase SHA-256 hex characters of the exact prompt>",
    "principals": ["replace-device-id"],
    "reviewedBy": "operator",
    "reviewedAt": "2026-10-21T10:00:00.000Z"
  }
}
```

Send `automationId:"nightly-check"` on the existing `session/prompt` call.
Prompt/session/principal changes invalidate the receipt. Review records are
administrator input, not approval claimed by task text. This integrates reviewed
delivery with the existing control plane; it does not create a second scheduler
or grant publication permission.

Team features do not change the [license](../LICENSE). Commercial use requires
prior written permission from copyright holder Maitham Al-rubaye; contact the
maintainer for that permission before commercial deployment. No paid service,
marketplace publication, Windows qualification or signing claim follows from
this feature.
