# UR SDK

Install locally in a Node project with `npm install ur-agent`, then import
`ur-agent/sdk`. Node 22.12+; no runtime library dependencies or separate Bun
installation. Local execution finds this package's bundled native launcher, so
a local npm installation works outside npm scripts too. An explicit `bin` or
`UR_EXECUTABLE` overrides it; source development falls back to `ur` on PATH.

```js
import { UrClient } from 'ur-agent/sdk'
const client = new UrClient({ model: 'your-configured-model', cwd: '/your/project' })
const result = await client.query('Summarize this project')
if (!result.ok) throw new Error(result.error)
console.log(result.text)
```

`stream(prompt)` returns an async iterable run and a `result` Promise. Each
wire revision 1 envelope contains `sequence`, `sessionId`, `transport:'local'`
and the original native stream-json `event`. Consume the stream while running.
`onPermission` receives `{requestId,toolName,input,raw}`; return `{behavior:'allow',
updatedInput?}` or `{behavior:'deny',message?}`. Alternatively reply using
`run.approve(requestId,decision)` when consuming `control_request` frames.
Omitting `updatedInput` preserves an independent copy of the original tool
input; provide it explicitly to change input. A bare denial gets a default
message required by the native permission protocol.
`query` declines requests if no callback is provided; `stream` awaits explicit
caller decisions. Normal CLI settings/permissions still apply.

`run.cancel()` and `signal` terminate local execution. Ending stream iteration
early also cancels; SIGKILL follows after two seconds if needed. Use
`client.resume(sessionId,prompt)` for the next turn of a persisted CLI session.
The result's `ok` requires a real successful result frame and clean process exit;
it does not substitute for independent verification of the work. Native result
frames remain in `result.result`, including usage and `cost_status`; unknown
prices must not be interpreted as zero. `queryJSON` returns null on failed runs
or invalid JSON content.

Options include `cwd`, `model`, `maxTurns`, `resumeSessionId`, `signal`, `bin`
(`{file,args?}`), `env`, `onPermission`, `timeoutMs` (default 30 minutes),
`maxOutputBytes` (64 MiB), `maxQueuedEvents` (4096), and explicit
`skipPermissions` (inherits the CLI's bypass semantics). One event consumer per
run; oversized or malformed output fails explicitly. Stdout UTF-8 is preserved
across chunk boundaries, final bytes are drained before resolving, and stderr
is retained as a bounded tail. Prompt text is never executed by a shell.

```js
import { UrRemoteClient } from 'ur-agent/sdk'
const remote = new UrRemoteClient({
  endpoint: 'http://127.0.0.1:9100/acp', token: process.env.UR_ACP_TOKEN,
})
const run = await remote.stream('Summarize the workspace')
for await (const frame of run) {
  if (frame.event.type === 'permission') {
    await run.approve(frame.event.requestId, { behavior: 'deny', message: 'Declined' })
  }
}
console.log(await run.result)
```

Remote clients use the existing UR-specific HTTP API (`ur acp serve`), not a
separate cloud service. Events contain `transport:'acp'` and exact ACP update
and permission payloads. Only allow_once/deny are supported, without rewriting
tool input. Save `sessionId` and `lastSequence`, then
`await remote.resume(sessionId,lastSequence)` to reconnect without replaying the
prompt. `disconnect()` stops observation while remote work continues; `cancel()`
asks the server to cancel. `close()` preserves durable history for an explicit
later resume. `request(method,params)` exposes other authenticated API methods.
Mutations are not automatically retried. Tokens stay in headers, redirects are
rejected, and protocol revision/identity/sequence gaps are validated.

Python 3.10+ clients ship in `sdk/python`; install with
`python3 -m pip install <ur-agent-package>/sdk/python`. See that directory's
README for standard-library local/remote clients. Separate PyPI publication is
not assumed. Both clients require an installed UR only for local execution.
