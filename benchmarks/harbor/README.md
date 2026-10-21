# UR in Harbor

`ur_agent.py` implements Harbor 0.24.0's installed-agent contract. Harbor supplies
the task container, timeouts and independent verifier; UR supplies its own model
loop, tools and session. The adapter downloads an explicitly pinned native UR
release and its checksum-verified archive. Node.js and Bun are not installed in
the task container. Use Linux ARM64/x64 with the published native requirements.

From this checkout, qualify the adapter on the included original task:

```sh
export UR_RELEASE="$(ur --version | cut -d ' ' -f 1)"
uv tool run --from harbor==0.24.0 harbor run \
  --path benchmarks/harbor/tasks/repair-json \
  --agent benchmarks.harbor.ur_agent:UrAgent \
  --model minimax-m3.1-flash:cloud \
  --ak version="$UR_RELEASE" --ak max_turns=16 --ak skip_permissions=true \
  --ak provider=ollama --ak base_url=http://host.docker.internal:11434 \
  --jobs-dir ./harbor-results
```

This example requires a running Docker daemon and an Ollama daemon reachable
from the container with that model configured. `host.docker.internal` is the
Docker Desktop host endpoint; on Linux configure an accessible host/gateway
address. Ollama Cloud performs remote inference. Change model/provider/endpoint
for another configured provider. Pass credentials through Harbor's agent
environment or secret mechanism, never in a checked-in config or prompt.

The fixture uses an unprivileged container user and its own writable `/app`.
`skip_permissions` is explicit and defaults false. If an external dataset runs
as root, supply a non-root agent user or explicitly declare its isolated sandbox
through the existing `IS_SANDBOX` setting; this adapter does not disable UR's
root permission check. A model can use its own strategy and tools within those
chosen execution settings.

`version` must be an immutable semantic release, not `latest`. Optional arguments
are `provider`, `base_url`, `max_turns`, `max_budget_usd`, and `skip_permissions`.
A dollar cap cannot be enforced when the provider's price is unknown. Older UR
releases may report a zero estimate for Ollama Cloud; do not treat it as invoiced
or guaranteed-free usage. Current results expose `cost_status`.

Harbor retains `ur-stream.jsonl`, `ur-stderr.log`, installation logs, verifier
reward and requested task artifacts. The adapter populates usage and known cost
from the actual terminal result, not from prose. A missing result leaves usage
unknown. Inspect both agent exit status and verifier reward.

The included task qualifies adapter installation, execution and verification;
it is **not** part of the official Terminal-Bench leaderboard. To run an official
dataset, replace `--path` with Harbor's pinned dataset selection and preserve its
original environment/verifier. Record dataset version, UR version, model,
configuration, environment and every task outcome before reporting a score.

Contract tests (no model calls):

```sh
uv tool run --from harbor==0.24.0 python -m unittest benchmarks.harbor.test_ur_agent
```

The native installer and real task were exercised locally on macOS Docker Desktop
with a Linux ARM64 container and the configured Ollama Cloud model. A root-user
qualification initially failed UR's root bypass check; the fixture now uses an
unprivileged user and its verifier passed. Full external dataset scores have not
been measured by this adapter qualification.

See the official [custom-agent contract](https://docs.harborframework.com/agents/custom-agents)
and [job configuration](https://docs.harborframework.com/jobs/run-a-job).
