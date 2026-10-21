# UR Python SDK

Python 3.10+, standard library at runtime. Install this source package using
`python3 -m pip install /path/to/sdk/python` from the npm package, or
`python3 -m pip install ./sdk-python` from the source checkout. The separate
`ur-agent-sdk` PyPI name is not claimed to be published. Installed native UR
is required for local runs; remote clients need only Python and an ACP endpoint.

```python
from ur_agent import UrClient
client = UrClient(model="your-configured-model")
result = client.query("Summarize this repository")
if not result.ok:
    raise RuntimeError(result.error)
print(result.text)

run = client.stream("Fix the failing test")
for envelope in run:
    event = envelope["event"]
    if event["type"] == "control_request":
        # Let your application's user decide; this example explicitly declines.
        run.approve(event["request_id"], {"behavior": "deny", "message": "Declined"})
print(run.wait())
# client.resume(run.session_id, "Continue with this change")
```

`query` declines interactive permissions unless `on_permission` is provided.
`stream` exposes requests to the caller. No callback grants permission by
itself. Existing CLI settings/permissions apply. `cancel()` terminates local UR;
use a `with client.stream(...) as run` block when exceptions could interrupt
consumption. A result requires both a result frame and clean process exit.
Returning `{"behavior": "allow"}` preserves an independent copy of the exact
original tool input. Set `updatedInput` explicitly to replace it. A bare
`{"behavior": "deny"}` receives the native protocol's required denial message.

```python
from ur_agent import RemoteClient
remote = RemoteClient("http://127.0.0.1:9100/acp", token="configured-secret")
run = remote.stream("Summarize the workspace")
for envelope in run:
    event = envelope["event"]
    if event["type"] == "permission":
        run.approve(event["requestId"], {"behavior": "deny", "message": "Declined"})
print(run.result)
```

Remote event revision 1 is the existing authenticated `ur acp serve` protocol.
ACP `session/update` and permission payloads are exposed intact. Local events
are native stream-json frames; the `transport` field distinguishes them.
Persist session ID and last sequence; `remote.resume(id, after=cursor)`
reconnects without replaying the prompt. Remote `disconnect()` stops observation
without terminating work, while `cancel()` requests cancellation. No automatic
network retries replay mutations. Tokens never go in URLs or redirect requests.
Remote stop reasons describe a model turn, not independent task verification.
