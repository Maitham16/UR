# 12 — Security, Sandbox & Stability

Source of truth: `src/utils/permissions/`, `src/utils/sandbox/`, `src/services/safety/projectSafety.ts`,
`src/services/guardrails/guardrails.ts`, `src/security/`, `src/stability/`,
`src/commands/{permissions,sandbox,sandbox-toggle,safety,guardrails,security,devcontainer,stability}`.

## Permission system

Every tool call is checked (doc 04 §Permission model):
- Rules: `allow` / `ask` / `deny` lists in settings `permissions`, `--allowedTools` /
  `--disallowedTools`, or the `/permissions` UI. Syntax `Tool` or `Tool(specifier)`
  (`Bash(git:*)`, `Edit(src/**)`, `mcp__server__tool`).
- Modes: `permissions.defaultMode` / `--permission-mode`:
  `default`, `plan`, `acceptEdits`, `autoApprove`. `autoApprove` skips
  command/tool approval prompts while preserving user-input dialogs.
- Bypass: `--dangerously-skip-permissions` (or `--allow-dangerously-skip-permissions` to
  make it opt-in at runtime); org policy can forbid it (`policyLimits`).
- Auto-mode: `autoMode.allow / soft_deny / deny` + optional LLM classifier
  (`classifierPermissionsEnabled`) to auto-approve safe commands;
  `useAutoModeDuringPlan`, `disableAutoMode` toggles.
- Managed environments: `allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`,
  `allowManagedMcpServersOnly`, managed-settings scope wins over all.
- Bash-specific hardening: command parsing + injection analysis
  (`bashSecurity.ts`, disable only via `UR_CODE_DISABLE_COMMAND_INJECTION_CHECK`),
  destructive-command warnings, path validation against allowed directories.

## OS sandbox (`/sandbox`)

`src/utils/sandbox/` wraps shell execution in an OS sandbox where supported.
```
/sandbox status          # architecture + dependency check
/sandbox check           # sandbox deps present?
/sandbox init            # write sandbox policy
/sandbox eval "curl https://example.com"   # what approval level would this need?
/sandbox exclude "docker *"                # same command: exempt a command pattern
```
Settings: `sandbox` (SandboxSettingsSchema in `src/entrypoints/sandboxTypes.ts`).
Configured read/write allow and deny roots are enforced by Seatbelt/bwrap
profiles. Paths are canonicalized through existing parents. Selective domain
policies fail closed to blocked network access when the compatibility runtime
cannot enforce domain-level filtering; bare-repository cleanup removes only a
signature-verified repository created during the command.

### Deny-default profiles

`buildSeatbeltProfile` emits a deny-default profile — `(deny default)` plus an
explicit read allowlist — whenever `allowRead` is set, or when `denyByDefault`
is passed. With neither, it falls back to `(allow default)` with targeted
denials. That fallback is a blocklist rather than a sandbox: anything the
denial list fails to anticipate is permitted, which is the shape behind the
2026 Seatbelt escape write-ups. Prefer `denyByDefault`; it stays opt-in because
it breaks agents that read outside the standard runtime roots
(`/System`, `/Library`, `/usr`, `/bin`, `/sbin`), which then need an explicit
`allowRead`.

## Prompt-injection defenses (`src/security/promptInjection.ts`)

Untrusted text reaches the model from fetched pages, search results, file
contents and — since `@ur` — GitHub comments written by strangers. This module
is **detection and framing, not filtering**: no reliable injection classifier
exists, and one that claims to block attacks invites misplaced trust. The
durable defenses are privilege separation and human approval, documented above.

| Function | Purpose |
|---|---|
| `scanForInjection(text)` | Seven rules: instruction override, role reassignment, exfiltration, tool coercion, forged system turns, secrecy demands, boundary forgery. Returns signals with severity; `suspicious` at ≥ 0.6 |
| `stripHiddenCharacters(text)` | Removes zero-width and bidirectional controls used to hide payloads from human review |
| `wrapUntrusted(text, source)` | Wraps content in a boundary tagged with a per-call 128-bit nonce |
| `makeCanary()` / `canaryLeaked()` | Token placed in privileged context; appearing in output proves a boundary was crossed |

`wrapUntrusted` is applied in `WebFetchTool` and `WebSearchTool` inside
`mapToolResultToToolResultBlockParam` — the one function every return path
passes through, so no fetch route can bypass it. WebSearch's citation reminder
is appended *outside* the boundary: it is UR's own instruction, and wrapping it
would label it as untrusted data.

The nonce matters. A fixed `</untrusted-content>` marker is forgeable — text
containing the closing tag escapes the fence and the remainder is read as
instruction. Binding the boundary to a random per-call id means breaking out
requires guessing 128 bits. A block that trips a detector is additionally
labelled for the model with the rules that fired.

## Project safety policy (`/safety`)

`.ur/safety-policy.json` classifies risky shell commands for this repo
(`src/services/safety/projectSafety.ts`):
```
/safety status
/safety init
/safety check --command "rm -rf build" --json
```

## Guardrails (`/guardrails`)

Declarative I/O guardrails in `.ur/guardrails/` layered onto the self-review gate
(`src/services/guardrails/guardrails.ts`). Rule kinds: `regex`, `contains`, `pii`,
`llm`; phases `input` / `output`; rules can be scoped per tool and can declare
tripwires (hard-stop on match).
```
/guardrails init
/guardrails list
/guardrails validate
/guardrails check "send this to x@y.com" --phase output --json
```

## Security toolkit (`/security` + standalone commands)

Backed by `src/security/` (attackSurface, codeAudit, webAudit, cloudAudit, secrets,
vulnIntel, threatModel, compliance, playbooks, hardening, incident, lab, scope,
containment, findings/reports):

```
/security scan            # umbrella scan
/security code            # code audit
/security secrets         # secret scanning
/security report          # findings report
/security rules · /security status
/scope set local          # define/approve an authorized test scope (required for offensive checks)
/threat-model             # STRIDE/ATT&CK model of the project
/vuln                     # dependency vulnerability audit via OSV
/ir                       # read-only incident-response collection
/compliance               # OWASP / SSDF / CIS mapping
/playbook                 # defensive playbooks
/harden                   # host hardening checks (read-only)
/kali                     # detect installed security tooling (read-only)
/lab                      # spin up a safe local practice lab
/security-review          # review pending branch changes for vulnerabilities
```
`/security-review` also exists as a bundled worktree skill that fixes low-risk
findings locally. Security labs accept only known templates and refuse symlinked
lab roots; approved security fixes canonicalize the target, write atomically,
and roll back if verification fails. The skill runs focused checks, asks before
the final full verification suite, and never commits, pushes, or opens a PR
without a separate explicit request.

## Devcontainer execution target (`/devcontainer`, alias `/exec-target`)

Opt-in reproducible container target (`.ur/devcontainer.json`): run commands and
`/ci-loop` inside Docker instead of the host:
```
/devcontainer status
/devcontainer init --image node:22
/devcontainer exec -- npm test
```

## Stability layer (MAPE-K) (`/stability`, `/actions`, `/evidence`)

`src/stability/` implements Monitor-Analyze-Plan-Execute-over-Knowledge controls with an
append-only ledger (`.ur/actions.jsonl`):
```
/stability metrics        # error rates, latencies, loop indicators
/stability firewall       # active protections
/stability why "ECONNRESET"   # root-cause analysis of an error
/stability policy · /stability cooldown
/evidence 20              # evidence/action ledger tail
/actions 10               # recent stability actions
```

The strict L1 verifier also validates terminal action intent. A final clause
such as `Let me create it now` requires a successful Write/Edit/NotebookEdit or
Bash mutation in the current user turn; `I will run the tests now` requires a
successful Bash call. The detector examines only the final visible clause and
excludes conditional plans, limiting false positives. Rejections use the
existing three-injection ceiling, so an uncooperative model cannot loop
indefinitely. This gate does not change permission or AutoApprove behavior.
Project-gate approval requests are tracked per user-turn UUID and emitted once;
the marker is cleared with the rest of the verifier turn state.

## Provenance & claims (`/claim-ledger`, `/cite`)

`/claim-ledger add --claim "p99 < 200ms" --source bench:latest` records
claim-to-source provenance; `validate` checks all claims still resolve.

## Release publication integrity

The tag workflow verifies and packs once, then publishes that exact tarball to
GitHub and npm. Its `publish-preflight` job checks `NPM_TOKEN` before the GitHub
Release job when the package version is not already registered. Both publish
jobs depend on the preflight, and a missing token fails closed instead of
leaving a successful-looking partial release. The guarded local tag command
still requires a clean, pushed release commit and never moves an existing tag.
Publication passes the verified artifact as an explicit `./dist-release/...`
path; without the `./`, npm's package-spec parser treats the slash-containing
value as GitHub shorthand and tries an unrelated SSH clone.

## Privacy

`/privacy-settings` UI; `--offline` kills telemetry; `feedbackSurveyRate`, analytics in
`src/services/analytics/` (GrowthBook flags + OTel metrics, `otelHeadersHelper`).
Secrets are kept in the OS keychain via `src/utils/secureStorage/`; `npm run secrets:scan`
exists for the repo itself.
