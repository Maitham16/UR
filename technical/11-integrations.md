# 11 — Integrations

Source of truth: `src/services/mcp/`, `src/services/agents/{acpStdio,acpServer,a2aProtocol,a2aServer,agUi}.ts`,
`extensions/{vscode-ur-inline-diffs,jetbrains-ur}/`, `src/utils/urInChrome/`, `src/bridge/`,
`src/commands/{mcp,ide,acp,a2a-card,chrome,browser,install-slack-app,bridge,desktop,voice}`.

## MCP (Model Context Protocol) — UR as a client

Transports: `stdio`, `sse`, `http` (streamable), `ws` (`src/services/mcp/{client,config}.ts`).
Config sources: settings `mcpServers`, project `.mcp.json`, `--mcp-config` files/strings
(`--strict-mcp-config` to use only those), UR Desktop import.

```
ur mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /tmp   # stdio
ur mcp add --transport http sentry https://mcp.sentry.dev/mcp
ur mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer …"
ur mcp add-json db '{"command":"pg-mcp","args":["--dsn","…"]}'
ur mcp list · ur mcp get fs · ur mcp remove fs
ur mcp add-from-ur-desktop
ur mcp reset-project-choices        # re-prompt for .mcp.json approvals
/mcp                                 # in-session UI: status, enable/disable, auth
```
- OAuth-protected servers: `src/services/mcp/auth.ts` + `McpAuthTool`; `--client-secret`
  or `MCP_CLIENT_SECRET` for the client secret; XAA IdP settings (`xaaIdp`).
  For non-interactive XAA login, pipe the token to
  `ur mcp xaa login --id-token-stdin`; the bounded stdin path avoids exposing
  the token through shell history or process arguments.
- Tools appear as `mcp__<server>__<tool>`; resources via `ListMcpResourcesTool` /
  `ReadMcpResourceTool`; prompts become slash commands; MCP skills gate `MCP_SKILLS`.
- Permission control: `allowedMcpServers` / `deniedMcpServers` settings,
  `mcp__server` deny rules strip a whole server, `enableAllProjectMcpServers`.
- Env expansion in server configs (`envExpansion.ts`); header helpers for auth
  (`headersHelper.ts`); official registry lookup (`officialRegistry.ts`).

## UR as a server

| Surface | Start | Protocol |
|---|---|---|
| MCP server | `ur mcp serve` | exposes UR tools over MCP (stdio) |
| MCP web server | `UR_MCP_HTTP_TOKEN=… ur mcp serve-web` | opt-in stateless `/mcp` adapter with negotiated Tasks and Apps |
| ACP stdio agent | `ur acp stdio` | Stable ACP v1 via the official SDK: durable list/load/delete/resume/close, exact replay, modes, config, commands, permissions, MCP, streaming |
| UR HTTP agent API | `UR_ACP_TOKEN=… ur acp serve`; `/acp` | UR-specific HTTP JSON-RPC for scripts, tools/tasks, and the experimental JetBrains plugin; not an ACP binding |
| A2A server | `UR_A2A_TOKEN=… ur a2a serve --port 8765` | negotiated strict v1 JSON-RPC/HTTP+JSON, stable-SDK v0.3 at `/a2a/jsonrpc`, and separate UR compatibility routes under `/a2a/tasks` |
| AG-UI adapter | `UR_AG_UI_TOKEN=… ur ag-ui serve --host 0.0.0.0` | official-schema HTTP/SSE at `/ag-ui` with truthful discovery at `/ag-ui/capabilities` |

Public remote sessions use the canonical `ur acp serve` endpoint. The source
tree also contains `DIRECT_CONNECT` and `BRIDGE_MODE` implementations under
`src/server/` and `src/bridge/`; those build-gated implementations are excluded
from the public distribution and are not additional installation commands.

`ur mcp serve` exposes built-in tools only. Every call is schema-validated,
rechecked by the normal permission engine, and executed without an interactive
approval channel; operations that need approval therefore fail closed. The
stdio adapter bounds calls, concurrency, runtime, and protocol payload sizes.
Operators can tune those bounds with `UR_MCP_MAX_CALLS_PER_MINUTE`,
`UR_MCP_MAX_CONCURRENT_CALLS`, `UR_MCP_TOOL_TIMEOUT_MS`,
`UR_MCP_MAX_INPUT_CHARS`, and `UR_MCP_MAX_OUTPUT_CHARS`.

`ur mcp serve-web` requires matching protocol/method/name request metadata,
uses the real UR MCP registry, and applies bearer auth, exact CORS origins,
owner-isolated durable tasks, rate/concurrency/runtime limits, private atomic
persistence, and corrupt-state quarantine. Its limits use `UR_MCP_HTTP_*`.
Tool calls can return `input_required` with a bounded continuation state when
more user input is needed. Older elicitation remains supported for compatible
clients. `roots/list` contains the initial workspace and every authorized
directory added with `/add-dir`; connected clients receive
`notifications/roots/list_changed` when that set changes.

`ur ag-ui serve` binds to loopback by default and requires `UR_AG_UI_TOKEN`
off-loopback. Browser origins are exact allow-list entries. Adapter runs are
isolated and non-persistent, disconnects cancel execution, approval-requiring
operations fail closed, and request/rate/concurrency/runtime/output limits use
`UR_AG_UI_*`. See `docs/AG_UI.md` for the complete supported contract.

The UR HTTP API and A2A surfaces apply request, prompt, task, output, and tool
limits through the `UR_ACP_*` and `UR_A2A_*` environment variables. Delegated
A2A protocol and compatibility tasks are isolated by token subject, tenant,
and skill;
bypassing permissions on the compatibility route also requires the static
operator token or the explicit `permissions:bypass` scope. The official A2A
runner uses fail-closed `dontAsk` permissions because the network binding has
no interactive approval channel. The stdio ACP runner instead bridges UR tool
decisions to the client's native `session/request_permission` UI and fails
closed on cancellation or client errors.

## IDE integration

- `/ide` — connect/status/doctor, per-editor config, inline diff bundles
  (`/ide diff capture`, `diff list`, `diff show <id>`; `src/services/agents/ideDiffs.ts`).
- `--ide` flag auto-connects at startup when exactly one IDE is detected.
- VS Code extension shipped in `extensions/vscode-ur-inline-diffs/` (inline diffs, actions
  tree, background actions bridge over the ur CLI).
- Experimental JetBrains plugin shipped in `extensions/jetbrains-ur/`. It uses
  the loopback UR HTTP `/acp` JSON-RPC methods (`initialize`, `session/new`,
  `session/prompt`) and keeps HTTP work off the IDE event thread.
- ACP stdio mode (`ur acp stdio`) is the transport used by editor plugins;
  LSP-powered diagnostics come from `src/services/lsp/`.

## Browser control

Three tiers:
1. **`Browser` tool / `/browser`** — Playwright when installed (goto/click/type/
   screenshot/evaluate/fetch): `/browser https://localhost:3000 "log in and screenshot"`.
2. **UR in Chrome** — `/chrome` settings UI, `--chrome`/`--no-chrome`, extension talks over
   a native host (`ur --chrome-native-host`) and MCP server (`ur --ur-in-chrome-mcp`);
   auto-registers the `ur-in-chrome` bundled skill when configured.
3. **`/browser-qa`** — validate and replay browser QA fixtures: `/browser-qa run login-flow`.

## Inbound events and collaboration

- `GitHub` tool (PRs/issues/search, doc 04); `/pr-comments`, `/review`; `--from-pr` resume.
- `/install-slack-app` — Slack app install.
- `ur trigger serve` — persistent receiver for GitHub webhooks, Slack events,
  Gmail Pub/Sub pushes, Microsoft Teams/Graph notifications, and generic JSON
  producers. Accepted work is deduplicated and resumes a durable session per
  issue, thread, conversation, mailbox, or explicit generic session key.
- `/trigger` — parse or dispatch a saved inbound payload headlessly (doc 10;
  full receiver setup and route contracts are in `docs/TRIGGERS.md`).

## Remote & desktop

- `/desktop` (alias `/app`) — continue session in UR Desktop.
- `/session` (alias `/remote`) — QR/URL for the current remote session.
- `/remote-env` — default environment for teleport sessions; `/web-setup` (gated) for web.
- `ur ssh <host> [dir]` — run against a remote machine over SSH (`src/ssh/`);
  `sshConfigs` setting stores named targets.
- `ur open <cc-url>` — deep-link handler (`disableDeepLinkRegistration` to opt out).

## Voice & niceties

- `/voice` toggles voice input (feature `VOICE_MODE`, `voiceEnabled` setting, `src/voice/`).
- `/buddy` companion sprite (BUDDY gate); `/think-back` year in review.

## Supported programmatic clients

`ur-agent/sdk` is the public dependency-free Node/TypeScript export. Install the
package in the calling project (`npm install ur-agent`); a global CLI install
does not automatically make imports available to arbitrary projects. Its JS and
TypeScript declarations are built by `node scripts/build-sdk.mjs` and included in
the native npm package. End users need Node 22.12+ for this client, and an
native UR launcher bundled in that npm package for local runs. The SDK finds
its sibling launcher even when the project `node_modules/.bin` is absent from
PATH. Explicit `bin` or `UR_EXECUTABLE` overrides take precedence; source
development falls back to PATH. No separate Bun is required.

```js
import { UrClient } from 'ur-agent/sdk'
const client = new UrClient({ model: 'your-configured-model', cwd: process.cwd() })
const run = client.stream('Investigate the failing test')
for await (const frame of run) {
  if (frame.event.type === 'control_request') {
    // Supply your own approval UI; this example explicitly declines.
    await run.approve(frame.event.request_id, { behavior: 'deny', message: 'Declined' })
  }
}
const result = await run.result
if (!result.ok) throw new Error(result.error)
console.log(result.text)
```

`query` consumes events and returns the complete result. Interactive permissions
are explicitly declined if `onPermission` is absent; `stream` leaves decisions
to its consumer or callback. Existing user permission configuration applies.
`UrClient.resume(sessionId, prompt)` starts the next native CLI turn with
`--resume`; the session ID comes from UR, never a fabricated local identifier.
`run.cancel()` or AbortSignal cancellation terminates the child, escalating to
SIGKILL after two seconds if needed. Breaking stream iteration cancels local
work. A successful result requires a result frame without a reported error and
a clean exit after draining output. It is not independent proof of task success.

Local envelopes are `{protocolVersion:1,sequence,sessionId,transport:'local',event}`;
`event` is the native stream-json frame. Permission input and exact raw request
are exposed. The Node SDK preserves split UTF-8, rejects malformed frames,
and both SDKs fill a bare allow decision with an independent original input
copy; only explicit `updatedInput` replaces it. Bare denials receive the required
message before transmission to the native permission engine. The Node SDK
requires one consumer and bounds queued events (4096), one line (16 MiB), captured
stdout (64 MiB) and retained stderr (64 KiB). Exceeding a bound reports failure,
not truncated successful results. `maxQueuedEvents`, `maxOutputBytes` and
`timeoutMs` are caller-configurable; default timeout is 30 minutes. `bin` and
`env` are explicit subprocess overrides, and no shell interprets the prompt.

The standard-library Python package is bundled at `sdk/python`, with source at
`sdk-python/`. Install it using `python3 -m pip install <package-path>/sdk/python`;
Python 3.10+ is required. A separate PyPI publication is not assumed. `UrClient`,
`stream`, `query`, permission callbacks, cancellation, local resume and
`RemoteClient` expose the same semantics with Python naming. Use `with
client.stream(...) as run:` to ensure cleanup after caller exceptions.

`ur sdk init` creates examples using these actual packages. SDK wire revision 1
is independent of the CLI release number. No version-suffixed commands exist.

### Remote SDK transport

`UrRemoteClient({endpoint,token})` and Python `RemoteClient(endpoint,token)` use
only the existing authenticated `ur acp serve` JSON-RPC POST `/acp` endpoint.
They send bearer tokens in headers, reject redirects, validate response IDs and
report transport/JSON-RPC errors. This HTTP API is UR-specific, not a claim that
ACP standardizes HTTP transport. ACP stdio remains the standard editor binding.

`stream(prompt)` uses `session/new` (or `session/resume`) then
`session/prompt` with `stream:true`; event polling uses `session/events` with
`after` and bounded long polling. SDKs validate contiguous sequence, session ID,
wire revision and nextCursor; a gap or unknown revision is an error, never
silently skipped content. Remote envelopes have `transport:'acp'`, and expose
real ACP `session/update` and permission payloads intact rather than pretending
they are native stream-json frames. Approvals are allow_once/deny through
`session/approve`, with no silent input rewriting or permanent grants.

Persist `{sessionId,lastSequence}`; `remote.resume(sessionId,after)` reconnects
without replaying the prompt. `disconnect()` stops observing and leaves remote
work running; `cancel()` invokes server cancellation. Neither client retries
mutating calls automatically. Remote stop reasons describe the model turn;
provider usage and independent verification must be read from actual events.
Native final result frames retain `cost_status`. Treat `unknown` or an absent
price as unknown rather than free; the SDK does not invent a cost estimate.
`session/close` detaches/cancels and preserves history; explicit resume may reopen
it. Device revocation is a separate server operation.

## ACP team operations

`src/services/agents/acpTeam.ts` adds opt-in policy around the existing ACP HTTP
dispatcher. `UR_ACP_TEAM_POLICY` must point outside the workspace to trusted
administrator policy; external private `UR_REMOTE_STATE_DIR` stores quota
receipts and a redacted, validated hash-chain audit. The device registry and
revocation logic remain the F12 source of identity/session scope. No policy
means no new role/quota checks or environment changes.

Roles are viewer/member/reviewer plus the existing operator token. Shared and
per-member quotas count accepted durable prompt attempts and concurrent/unknown
reservations, not dollars or nested model calls. Exact prompt/session/principal
request binding preserves duplicate delivery without another execution or
charge. A killed owner retains an unknown concurrent reservation until operator
review; `team/reconcile` preserves the total charge and stores a reason digest.
`team/status` and operator-only `team/audit` use the same `/acp` endpoint.

The optional team runner environment is an explicit allowlist plus OS/runtime
essentials, with private per-session UR config. The operator token and control
path are removed. Host files and external CLI/MCP/hook credentials remain
separate OS/deployment boundaries. Administrator-reviewed automation receipts
bind exact prompt SHA-256, session and principal on `session/prompt`; they never
grant tool or publication approval. See the [team setup/protocol](../docs/ACP.md#optional-team-policy-http).

`test/acpTeam.test.ts` includes durable quotas, role/revocation enforcement,
reviewed-prompt tampering, real killed-owner recovery, hash-chain corruption and
an actual default-runner child environment fixture. No real model or external
credential is used. Team functionality does not amend the non-commercial
license; commercial use needs the copyright holder's prior written permission.

## Native remote deployment

The [container recipe](../deployment/acp/README.md) packages an extracted, verified
Linux native release with private persistent state and workspace volumes. It runs
as an unprivileged user with a read-only application and requires no separate
Node/Bun runtime. Provider settings, bearer credentials, project build tools and
TLS/tunneling are explicit deployment inputs. Its integration smoke test drives
the real native approval/tool loop and replacement-container session recovery.
