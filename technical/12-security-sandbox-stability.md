# 12 — Security, Sandbox & Stability

Source of truth: `src/utils/permissions/`, `src/utils/sandbox/`, `src/services/safety/projectSafety.ts`,
`src/services/guardrails/guardrails.ts`, `src/security/`, `src/stability/`,
`src/commands/{permissions,sandbox,sandbox-toggle,safety,guardrails,security,devcontainer,stability}`.

## Permission system

Every tool call is checked (doc 04 §Permission model):
- Rules: `allow` / `ask` / `deny` lists in settings `permissions`, `--allowedTools` /
  `--disallowedTools`, or the `/permissions` UI. Syntax `Tool` or `Tool(specifier)`
  (`Bash(git:*)`, `Edit(src/**)`, `mcp__server__tool`).
- Modes: `permissions.defaultMode` / `--permission-mode` (e.g. `plan`, accept-edits).
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
/sandbox exclude "docker *"                # jsx toggle: exempt a command pattern
```
Settings: `sandbox` (SandboxSettingsSchema in `src/entrypoints/sandboxTypes.ts`).

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
`/security-review` also exists as a bundled worktree skill that fixes low-risk findings
and opens a PR.

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

## Provenance & claims (`/claim-ledger`, `/cite`)

`/claim-ledger add --claim "p99 < 200ms" --source bench:latest` records
claim-to-source provenance; `validate` checks all claims still resolve.

## Privacy

`/privacy-settings` UI; `--offline` kills telemetry; `feedbackSurveyRate`, analytics in
`src/services/analytics/` (GrowthBook flags + OTel metrics, `otelHeadersHelper`).
Secrets are kept in the OS keychain via `src/utils/secureStorage/`; `npm run secrets:scan`
exists for the repo itself.
