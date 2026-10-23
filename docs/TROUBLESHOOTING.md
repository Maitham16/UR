# Troubleshooting

Each entry lists the symptom, the likely cause, the fix, and a command that
verifies the fix.

## Readiness, review and recorded evidence

Run `ur doctor --readiness` or interactive `/ur-doctor` after choosing a
provider/model. `--json` returns the same structured report. It checks the
active provider, not an unrelated local Ollama server, and does not generate
model output or start MCP servers. Resolve failed checks with the displayed
`ur provider doctor <provider>` command or `/model`; **K** in an API provider's
model picker adds/replaces its key. Submit a small read-only task to verify
actual generation after diagnostics pass.

A historical verification PASS can become stale after source changes.
`ur spec verify <name>` reruns execution-bound verification. Prose-only legacy
PASS records are unverifiable/PARTIAL. Readiness reports that assessment
without rewriting old records; ordinary verification loading migrates them.
Source-current evidence does not prove external services or outside files.

Reported cost plus unknown-cost calls means some provider results omitted
usage/billing metadata. It is not a complete zero-dollar bill. `/cost` shows
current-session reporting; saved goals show their own cumulative usage.
Ctrl+C interrupts foreground work, `ur bg cancel <id>` cancels background
work, and `ur --resume <session-id>`, `ur bg resume <id>` or
`ur goal resume <name>` resume their respective saved state. Unknown side
effects need reconciliation before an effect can safely be repeated.

The sandboxed preset takes effect only when explicitly passed with
`--settings .ur/sandboxed.settings.json`. `ur sandbox status` and the readiness
report distinguish disabled, available and unavailable enforcement. A required
but unavailable sandbox fails closed; an offline `ur safety audit` PASS does
not establish OS confinement. Review the [preset scope and exceptions](../technical/12-security-sandbox-stability.md#opt-in-sandboxed-preset).

## Install and startup

### A supported Claude model reports no thinking or effort controls

Update UR and restart it, then use Ctrl+R in `/model` to refresh the live
catalogue. Claude publishes effort levels and thinking modes as nested
capability fields; older UR builds did not read those fields. `/effort status`
and `/thinking status` now report the selected model's actual contract.

Opus 5.5 has five native effort levels and always-on thinking. An off switch
cannot disable that model's thinking; use effort to control depth. Sonnet 5.5
uses a between-tools mode when up-front thinking is reduced. Haiku 5.5 allows
explicit disabling. Supported speed tiers appear in `/model` (`s`, then Enter)
and `/fast on|off|status`. Fast uses premium provider pricing; models without
a documented fast tier stay on Standard.

### Claude API rejects `anthropic-beta: ur-20250219`

This is an old UR request-header defect. Update through the installation's
package manager (`brew upgrade ur-nexus` or `npm install -g ur-agent@latest`),
restart UR, select Claude API and your model with `/model`, then retry a small
prompt. Standalone installations use `ur upgrade`. The fix removes automatic
hosted-service headers for every external provider; no model switch is needed.

UR sends feature-specific beta headers only where needed. If you explicitly
set `URHQ_BETAS`, check those values against Anthropic's documented beta names
and your account's access. Invalid explicit opt-ins still produce the provider's
error. Readiness diagnostics check connectivity; a short prompt verifies
generation. Add or replace your API key through `/connect` or the model picker.

### `ur: command not found`

- Likely cause: UR is not installed, or its launcher directory is not on `PATH`.
- Native install on macOS/Linux ARM64/x64: follow
  [Native installation](NATIVE_INSTALL.md), add `~/.local/bin` to PATH if
  requested, and inspect `command -v ur`.
- Homebrew install: inspect `brew list ur-nexus` and `command -v ur`; update with
  `brew upgrade ur-nexus`. For a first installation, follow the
  [tap and formula-trust setup](NATIVE_INSTALL.md#homebrew).
- Windows native and public npm installation are unavailable in 1.87.3. For
  optional Windows source development, inspect `Get-Command ur` and follow the
  [Development Guide](DEVELOPMENT.md).
- npm install: check the npm global bin path, then reinstall if needed. The
  launcher requires Node.js `>=22.12`; it needs no separate Bun.

```sh
npm install -g ur-agent
npm prefix -g       # ensure <prefix>/bin is on PATH
ur --version
```

### `npm install -g ur-agent` fails

- Likely cause: permission errors on the global prefix, or Node.js older than
  the supported `22.12` baseline.
- Fix: use a user-writable npm prefix (or a Node version manager), then retry.

```sh
npm config set prefix ~/.npm-global   # then add ~/.npm-global/bin to PATH
npm install -g ur-agent
ur --version
```

### An npm installation asks for Bun

The official npm package from 1.86.1 needs Node.js `>=22.12` and uses the pinned
native application without a separate Bun. If it asks for Bun, inspect
`command -v ur` for an older npm install, source checkout, or alias, then update
with `npm install -g ur-agent@latest`. Homebrew uses
`brew upgrade ur-nexus`; standalone installs use `ur upgrade`.

### The first npm launch cannot download its native application

The first `ur` launch needs access to the exact package version's GitHub release.
Check the reported network, checksum, or resource-validation error and retry;
UR does not substitute a different version or fall back to Bun. A valid cached
installation under `~/.cache/ur/npm/<version>-<platform>` can launch offline.
`XDG_CACHE_HOME` must be absolute when set. Provider requests may still need
network access independently.

### Bun is missing or too old (source development only)

Source checkouts and GitHub-source packages execute through the pinned Bun
(`1.4.3`). Install that development runtime, or set `BUN_BIN` to its absolute
path when it is outside PATH. Public Homebrew, npm, and standalone installs do
not require it.

### Invalid or corrupted settings

- Likely cause: malformed JSON in `~/.ur/settings.json` or project settings.
- Fix: repair the JSON or set values through safe config commands instead of
  editing by hand.

```sh
ur config set provider ollama
ur provider status
```

### Every Bash call fails with `ENOENT .../tasks/<id>.output`

- Likely cause: the operating system or a cleanup process reclaimed UR's
  session task-output directory, or the conventional Unix `/tmp` path is
  unavailable. The command itself never started; identical failure from
  `echo ok` distinguishes this harness failure from an application error.
- Fix: upgrade to UR 1.79.1 or newer. UR now uses `os.tmpdir()`, ensures the
  output directory for every launch, and automatically recreates and retries
  when it disappears. Restarting an older session is only a temporary
  workaround.
- Verification: start a new UR session and ask it to run `echo ok` through
  Bash. A successful result confirms the harness; `/design3d doctor` alone
  validates the local slash command but does not exercise Bash execution.

### Fetch repeatedly reports `404`

- Likely cause: the page moved or the model generated a stale URL. A successful
  fetch from another page proves the network path is working; retrying the same
  missing URL cannot change its HTTP status.
- Fix: upgrade to UR 1.80.4 or newer. WebFetch now records permanent 4xx
  failures by normalized URL, independent of its hidden summarization prompt.
  It refuses another network request for that URL and stops the turn if the
  model keeps retrying. Alternating between two dead URLs is bounded as well.
- Recovery: use WebSearch, fetch the site’s parent/index page, or choose a
  different source. Timeouts, `408`, `409`, `425`, `429`, and `5xx` responses
  remain retryable because they may be transient.

### A built-in research agent says `TaskListRequired`

- Likely cause on UR 1.80.3–1.80.5: the strict task gate treated either the
  active plan file or early read-only research delegation as an untracked
  project mutation, creating a circular requirement before planning finished.
- UR 1.80.6 fixed this inside Plan Mode. UR 1.80.7 extends the same safe rule to
  ordinary main-session research: upgrade to 1.80.7 or newer. The exact active
  plan file and main-thread delegation to UR's shipped read-only `Explore` and
  `Plan` agents are allowed before tasks exist. The child is forced into plan
  permissions even if the parent uses Accept Edits or Approve All. Approved
  plans are synchronized into visible
  implementation and verification tasks before the first project mutation.
  Other files and write-capable delegation remain protected. Existing
  actionable tasks are preserved.
- If the message names a project file rather than the active plan file, it is
  expected. It is also expected for custom/general-purpose/nested/team/worktree
  agents without a parent task: create the requested tasks or finish and
  approve the plan first. Disabling `tasks.requireBeforeChanges` is no longer
  needed for normal plan mode.
- If an API, local, or subscription-CLI model still returns this error for an
  explicitly read-only research brief on 1.80.7, upgrade to 1.80.8. Some models
  emitted `subagent_type: "general-purpose"` despite the read-only instruction.
  UR 1.80.8 routes that narrow contract to the protected Explore worker before
  the gate. A real general-purpose or implementation worker is still expected
  to require a task.
- If the model preserved only the research/report instructions and omitted the
  words “read-only,” upgrade to 1.80.9. UR recognizes that remaining provider
  shape without relying on a specific model name. Prompts that also direct
  implementation, testing, command execution, or file changes remain blocked
  until an actionable task exists.
- If the same failure persists on 1.80.9, upgrade to 1.80.10. The 1.80.9 public
  bundle could still compile the protected `Explore` and `Plan` registry entries
  out, leaving the correct routing decision with no read-only destination.
  Version 1.80.10 makes both core agents deterministic in public builds.

### Ollama stops with `unavailable tool "WebSearch"`

- Cause on UR 1.80.6 and older: a local model requested a provider-hosted tool
  that was not present in its active tool profile. The Ollama adapter treated
  the valid but unavailable tool name as a fatal provider-response error, so
  the parent could not receive the research agents' remaining useful results.
- Fix: upgrade to UR 1.80.7 or newer. UR now returns a recoverable
  `UnavailableTool` result without executing the call. The agent is instructed
  to use an available alternative or return its partial result, and repeated
  identical unavailable calls are bounded. This applies to native and
  text-form calls in streaming and non-streaming Ollama responses.
- `WebSearch` is still not fabricated for a model or profile that does not have
  it. Malformed tool names and malformed arguments still fail closed.

## Providers and models

### Provider selected but the model is unavailable

- Likely cause: the model was never pulled/served, or it belongs to a
  different provider.
- Fix: pick a model scoped to the active provider.

```sh
ur provider status
ur config set model <model-from-this-provider>   # or use /model in a session
```

### Selected model belongs to another provider

- Likely cause: provider was changed and the old model is incompatible; UR
  warns and clears the model in this case.
- Fix: choose a model from the current provider's list.

```sh
ur provider status
# then in a session: /model
```

### Requests appear to hit the wrong backend

- Likely cause: a stale provider/model pair.
- Fix: inspect the runtime backend; there is no cross-provider fallback, so
  the reported backend is the one receiving requests.

```sh
ur provider status
ur provider doctor
```

### Subscription CLI exits non-zero

- Likely cause: the vendor CLI (codex, claude, gemini, agy) is missing or not
  logged in.
- Fix: install the official CLI and log in.

```sh
ur provider doctor codex-cli    # or claude-code-cli, gemini-cli, antigravity-cli
ur auth chatgpt                 # or: ur auth claude | gemini | antigravity
```

### Provider produces output but exits with an error

- Likely cause: the vendor CLI wrote a partial result and then failed (quota,
  network, auth expiry). UR reports the provider, model, and backend with the
  failure instead of discarding the output silently.
- Fix: read the reported provider error, then re-check login/quota.

```sh
ur provider doctor <provider-id>
```

### Model discovery fails / model list is empty

- Likely cause: for local/server providers the endpoint is down; for API
  providers the key is missing, so only the curated fallback list shows.
- Fix: start the server or connect the key.

```sh
curl http://localhost:11434/api/tags        # Ollama
curl http://localhost:1234/v1/models        # LM Studio (llama.cpp: 8080, vLLM: 8000)
curl -H "Authorization: Bearer $UNSLOTH_API_KEY" http://localhost:8888/v1/models
curl -H "Authorization: Bearer $NVIDIA_API_KEY" https://integrate.api.nvidia.com/v1/models
ur connect openai-api                       # store an API key securely
ur provider doctor
```

For an authenticated generic gateway, run `ur connect openai-compatible` or
press `K` on its `/model` screen; the key is optional and stored separately
from `OPENAI_API_KEY`. NVIDIA Agentic/Special use one key stored with
`ur connect nvidia-nim` or `ur connect nvidia-special`; Agentic keeps any
custom `base_url` scoped to that provider.

When NVIDIA Special is selected, plain prompts are sent directly to its exact
model-card endpoint. They must not produce Anthropic/Ollama connection or
provider-model errors. If a contract needs media, provide its required field,
for example:

```text
prompt: Turn this source into an 8mm-film scene.
video_path: /absolute/path/source.mp4
```

### Anthropic says `anthropic-workspace-id is required`

- Cause: the API key is identity-linked and can act across workspaces. Anthropic
  requires the target workspace on model discovery and every runtime request.
- Fix: copy the `wrkspc_...` ID from Claude Console → Settings → Workspaces,
  then configure it and re-run doctor. The workspace ID is not the API key.

```sh
ur config set anthropic.workspace_id wrkspc_...
ur provider doctor anthropic-api
```

`ANTHROPIC_WORKSPACE_ID` is the environment-only alternative. If the key was
created inside one workspace and is already workspace-scoped, no header is
needed. `auto` clears an incorrect saved selection. UR cannot safely infer the
Default Workspace ID because Anthropic omits that workspace from its list API.

### OpenAI stays on `requesting` and then reports a billing 429

- Cause: older retry classification treated every HTTP 429 as a temporary rate
  limit. OpenAI also uses 429 for permanent request-state failures such as
  `billing_not_active` and `insufficient_quota`.
- Current behavior: UR reads the machine error code, reports permanent account
  or billing failures immediately, and still retries genuine transient rate
  limits. The same rule applies to Chat Completions and Responses.
- Fix for `billing_not_active`: activate API billing for the project/account or
  connect a key belonging to an active billed project. Changing models or
  transports cannot activate the account.

### NVIDIA lists a model but inference returns `Function … Not found for account`

- Cause: the card is documented by NVIDIA, but its backing function is not
  entitled or temporarily available for this API key/account.
- Fix: verify the model card and key with `ur provider doctor nvidia-nim`, then
  retry. UR uses the exact per-card endpoint and keeps the model visible. A 404
  never removes it from the current or future catalog.
- Privacy: UR does not display or retain the internal NVIDIA function UUID and
  account identifier from this error response.

If `chat_models` fails, reconnect a current build.nvidia.com key with
`ur connect nvidia-nim`. A configured enterprise/self-hosted NIM endpoint is
validated only against that gateway's own `/models` response.

### An NVIDIA specialized model is missing from `/model`

- Ongoing public models come from exact Build cards that advertise agent/tool
  use; a configured enterprise NIM uses its own live `/models` feed.
- Dedicated models appear under NVIDIA Special without relying on a chat
  `/v1/models` response.
  Run `bun run provider:nvidia-catalog` in a source checkout to refresh the
  checked-in contracts from NVIDIA's current public reference.
- Download-only cards are absent. Every Free Endpoint card is preserved. If a
  card lacks a published invocation protocol, it remains visible with
  `unpublished` status rather than receiving a guessed endpoint.
- UR inlines small supported media and automatically uses NVIDIA's Asset API
  for larger files or contracts that require an asset UUID/reference.
- A task-specific entitlement failure never removes the model. Exact endpoint,
  HTTP/RPC method, function ID, request/response schemas, and documentation are
  available through the `NvidiaSpecial` describe action.

### A provider says the previous answer was empty after successful tool calls

Some OpenAI-compatible models scope generated tool-call IDs to one response
and reuse values such as `TaskCreate:0` on a later response. Older UR releases
mistook the later completed pair for transcript corruption, removed it before
the next API request, and could make the model believe that the user sent an
empty continuation.

Upgrade UR and retry the turn. UR now canonicalizes only later, independently
completed call/result pairs before provider dispatch. Same-message duplicates,
unmatched calls, and orphaned results still go through normal transcript
repair. The saved transcript remains faithful to the provider response; only
the API-bound copy receives conversation-unique IDs.

### `The provider reported that model … reached its per-response output boundary`

This is not an input-context overflow and does not mean UR counted the text
incorrectly. The provider ended the generation with its `max_tokens`/`length`
finish reason on a response chunk whose boundary was the displayed value.
UR's shared loop for native API providers continues from the cutoff with no
fixed total continuation count while responses add useful output.

From 1.86.2, an empty, reasoning-only, or replayed capped response can trigger a
larger response budget: normally twice the actual requested size, bounded by
the model's output limit, an explicit `UR_CODE_MAX_OUTPUT_TOKENS` ceiling, and
remaining context space. Actual request/usage metadata prevents UR from
repeatedly requesting an increase that a lower-level context retry already
reduced. Once no larger usable budget remains, two unproductive attempts stop
the stalled loop. Changing hidden reasoning does not make a repeated visible
answer count as progress; different equal-sized opaque reasoning blocks are
no longer mistaken for identical output.

`UR_CODE_MAX_OUTPUT_TOKENS` sets the initial chunk and the maximum allowed
automatic chunk size, up to the model's limit. It is not a total task-output
limit. An unusually low explicit value can leave no room for recovery. Cloud
requests start with a practical chunk, while local runtimes use smaller
reservations to limit KV-memory allocation. Retry after upgrading UR; if the
stall persists, review the explicit ceiling, remaining context, and provider
diagnostics rather than repeatedly submitting the same request.

Ollama reasoning-only history is retained in its separate `thinking` field;
UR does not turn it into visible answer text. A provider's
`model_context_window_exceeded` stop instead takes the prompt-too-long path:
with automatic compaction enabled, UR preserves the partial response, compacts,
and retries. Disabled or unsuccessful compaction still reports the context
failure. These are shared recovery rules, not a guarantee that every provider
or model will finish; regression checks use deterministic fixtures, not a live
MiniMax completion.

### Unsloth is selected but unavailable

- Likely cause: Studio is not running, no model is loaded, its generated API
  key is not connected, or `base_url` does not end at the compatible API root.
- Fix: start/load Unsloth outside UR, connect its key, and inspect discovery.

```sh
echo "$UNSLOTH_API_KEY" | ur connect unsloth
ur config set provider unsloth
ur config set base_url http://localhost:8888/v1
ur provider doctor unsloth
ur provider models unsloth --json
```

UR does not start or manage Unsloth. It also disables Unsloth server-side tools
on every request; tool execution shown by UR is handled by UR's own guarded
tool loop.

### Local server unreachable

- Likely cause: wrong `base_url` or the server is not running.
- Fix: point UR at the right endpoint.

```sh
ur config set base_url ollama http://localhost:11434
ur provider doctor ollama
```

Addresses are saved per provider. If the doctor probes an unexpected URL,
select that provider first and run `ur config get base_url`; changing vLLM's
address no longer overwrites Ollama, llama.cpp, or Unsloth.

## Sessions and workflows

### No visible progress in scripts

- Likely cause: `ur -p` prints the final result only.
- Fix: stream structured progress.

```sh
ur -p --output-format stream-json "explain this repository"
```

### Dry-run works but the real run fails

- Likely cause: `--dry-run` skips model calls and permissions; the real run
  needs a reachable provider and permission approval.
- Fix: verify the provider, then run without `--dry-run` and approve prompts
  (or scope tools explicitly).

```sh
ur provider status
ur -p --allowed-tools "Read,Edit,Bash(git:*)" "run the task"
```

### Permission or sandbox issues

- Likely cause: the requested command is classified as write/execute/network
  and requires approval; OS sandbox dependencies (`sandbox-exec` on macOS,
  `bwrap` on Linux/WSL2) are missing; or `sandbox.failIfUnavailable` (required
  mode) is set and UR refused to start without a working sandbox.
- Fix: inspect the policy and the sandbox status; install missing sandbox
  dependencies, or relax `sandbox.enabled`/`sandbox.failIfUnavailable` in
  settings if required mode is not intended.
- Windows development workflows have no supported native sandbox. Run the Linux
  distribution inside WSL2 when sandboxing is required; installing a Windows
  helper does not enable this release's unsupported backend.

```sh
ur safety check --command "<the command>"
ur sandbox status
ur sandbox check
```

### Tests fail after an agent edit

- Likely cause: the edit broke a project gate.
- Fix: use the CI loop to repair with bounded attempts, or inspect verify
  gates.

```sh
ur ci-loop --command "bun test" --cwd . --max-attempts 3
ur test-first detect
```

If the runner says "No tests found", check the working directory printed by
the result and run from the test root or pass it explicitly. This configuration
failure stops after the first attempt and does not invoke a fix agent:

```sh
ur ci-loop --command "bun test" --cwd ./packages/app --max-attempts 3
```

## Integrations

### Plugin fails to load

- Likely cause: invalid manifest or wrong install scope.
- Fix: validate the manifest and re-check installed state.

```sh
ur plugin doctor
ur plugin list
```

### ACP / editor connection issues

- Likely cause: the native stdio command/config is wrong, or the optional UR
  HTTP server used by JetBrains is not running.
- Fix: verify the stdio command is registered, check HTTP status when relevant,
  regenerate the editor config, and run the IDE doctor.

```sh
ur acp status
ur acp stdio --help
ur ide doctor
ur ide config zed    # or vscode, cursor, windsurf, jetbrains, neovim
```

If a problem persists, run the repository's validation runbook
([docs/VALIDATION.md](VALIDATION.md)) and file an issue at
<https://github.com/Maitham16/UR/issues> with the exact command and output.
