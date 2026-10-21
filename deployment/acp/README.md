# Native remote worker

This self-hosted image runs the same native UR release as the CLI. It requires
neither Node nor Bun at runtime. The Docker host needs Linux containers matching
the release architecture. The image provides Git, CA certificates and curl;
project-specific build tools and browser engines must be added to a derived image
when the task needs them. This does not provision a hosted account or public URL.

## Build from a verified release

Download the Linux ARM64 or x64 archive and its checksums from the
[GitHub release](https://github.com/Maitham16/UR/releases). Verify the archive
against `SHA256SUMS`, then extract it into an empty directory. Set `release_dir`
to the extracted directory containing **both** `ur` and `resources/`.

```sh
docker build -f deployment/acp/Dockerfile -t ur-worker "$release_dir"
```

The image copies only these release files; source files, credentials and host
configuration are excluded. The base image is digest-pinned. OS packages receive
current repository security updates during the build, so rebuilding is not a
claim of byte-identical image output. Record your resulting image digest and
deploy that digest for repeatable rollouts. Preserve release notices/resources.

## Configure and run

Create separate persistent volumes for the project and the private state:

```sh
docker volume create ur-workspace
docker volume create ur-state
docker run --rm --user 0:0 --entrypoint /bin/sh \
  --mount type=volume,src=ur-state,dst=/state \
  --mount type=bind,src="$PWD/settings.json",dst=/settings.json,readonly \
  ur-worker -c 'cp /settings.json /state/config/settings.json && chown -R 10001:10001 /state && chmod 700 /state/config && chmod 600 /state/config/settings.json'
```

`settings.json` uses normal [provider settings](../../technical/05-providers-and-models.md).
Use an endpoint reachable **from the container**. For a host service on Docker
Desktop use `host.docker.internal`; on Linux add
`--add-host host.docker.internal:host-gateway`. Do not use the container's
`localhost` to address a model running on the host.

Create a private `worker.env` (mode 0600) containing a random `UR_ACP_TOKEN`,
`UR_MODEL` set to your selected model, and only the provider environment variables
this worker needs. The explicit model selects it for fresh noninteractive
workspaces; a global provider default alone does not bypass workspace selection. Generate the token
with `openssl rand -hex 32`. Environment files are runtime inputs; never add
them to the image or repository. Start the worker:

```sh
docker run -d --name ur-worker --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,size=256m \
  --mount type=volume,src=ur-workspace,dst=/workspace \
  --mount type=volume,src=ur-state,dst=/state \
  --env-file worker.env -p 127.0.0.1:8123:8123 ur-worker
```

The application runs as UID/GID 10001. Use `docker cp` plus an explicit ownership
adjustment when seeding the workspace, or mount an existing project writable by
10001. The read-only application and separate workspace/state preserve recovery
data when replacing the container. This single-user image shares writable state
with its worker: it is not hostile multi-tenant isolation. Optional team policy
needs an operator-managed control boundary and protected policy/state; do not
claim the sample image alone provides that boundary.

The endpoint is published on host loopback. Use an SSH tunnel for another machine
or an authenticated TLS reverse proxy configured by your operator. The bearer
token remains required. Do not expose plain HTTP tokens across an untrusted
network. `GET /healthz` checks server availability without exposing task data.

## Operate and recover

- Use the [Node/Python remote SDK](../../technical/11-integrations.md) or
  [HTTP contract](../../docs/ACP.md) to create a session and submit a prompt with
  `stream:true` and a unique `requestId`. Poll `session/events` with the last
  acknowledged cursor; answer pending approvals with `session/approve`.
- Reconnect using `session/resume`, then replay events from the saved cursor.
  Retrying an identical request ID reuses the same run. A new task needs a new
  ID. After interruption, inspect uncertainty; UR asks the model to reconcile
  prior effects rather than replaying shell commands.
- `device/new` issues an expiring credential limited to selected sessions.
  `device/revoke` blocks further access; `session/cancel` stops active work.
- `docker logs ur-worker` contains server diagnostics. Session events carry
  text/tool progress and errors. Copy requested output from `/workspace` using
  `docker cp`; keep private `/state` out of published artifacts.
- Previews remain workspace processes/files. Publish only the selected preview
  port through your authenticated proxy or SSH tunnel; this recipe does not
  automatically expose project servers to the Internet.
- Replace the container with the same image digest and volumes to reconnect.
  Stop with `docker stop ur-worker`. Keep the volumes until intentionally deleting
  project files, transcripts, device state and event history.

## Qualification

```sh
node scripts/acp-container-smoke.mjs --native-dir "$release_dir"
```

This host-side test needs Node and Docker. It builds the actual image, uses a
controlled provider to drive the real native child and Write tool, checks
authentication/approval/idempotency/device revocation, replaces the container,
replays unchanged events and resumes the native session. It verifies runtime
absence of Node/Bun and a read-only application. Linux native CI runs the same
test on the built payload. This is transport/recovery evidence, not a model
quality benchmark or a guarantee of exactly-once external effects.

Recipe semantics follow the official [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
and [container run reference](https://docs.docker.com/engine/containers/run/).
