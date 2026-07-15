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

- Likely cause: permission errors on the global prefix, or an old Node.js.
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
ur connect openai-api                       # store an API key securely
ur provider doctor
```

### Local server unreachable

- Likely cause: wrong `base_url` or the server is not running.
- Fix: point UR at the right endpoint.

```sh
ur config set base_url http://localhost:11434
ur provider doctor
```

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
