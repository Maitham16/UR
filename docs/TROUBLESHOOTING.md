# Troubleshooting

Each entry lists the symptom, the likely cause, the fix, and a command that
verifies the fix.

## Install and startup

### `ur: command not found`

- Likely cause: the package is not installed globally, or the npm/bun global
  bin directory is not on `PATH`.
- Fix: reinstall globally and check the global bin path.

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

### Bun is missing or too old

- Likely cause: UR is not Node-native. Every install path — npm, GitHub, and
  source checkouts — executes the CLI through Bun (this repository pins
  `bun@1.3.14`). The npm-installed `bin/ur.js` launcher starts under Node
  only to detect Bun and re-exec into it; if Bun is missing or too old, the
  launcher prints `UR-Nexus requires Bun ... at runtime` and exits instead of
  falling back to Node.
- Fix: install Bun, then rerun. Set `BUN_BIN` to an absolute Bun path if
  `bun` is installed but not on `PATH`.

```sh
npm install -g bun   # or: curl -fsSL https://bun.sh/install | bash
bun --version
ur --version
```

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
ur connect openai-api                       # store an API key securely
ur provider doctor
```

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
ur config set base_url http://localhost:11434
ur provider doctor
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
