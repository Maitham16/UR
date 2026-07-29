# 12 — Security, Sandbox & Stability

Source of truth: `src/utils/permissions/`, `src/utils/sandbox/`,
`src/entrypoints/sandboxTypes.ts`, `src/services/safety/projectSafety.ts`,
`src/security/`, `src/services/guardrails/guardrails.ts`, `src/stability/`,
`src/services/verifier/`, and `src/services/tools/toolHooks.ts`.

This chapter distinguishes an **enforced runtime boundary** from an
**inspection/advisory helper**. A command that can scan, classify, or print a
warning is not described as blocking ordinary agent execution unless it is
actually wired into that execution path.

## Permission engine — enforced

Every enabled tool call passes through the permission engine. Rules are loaded
from `permissions.allow`, `permissions.ask`, and `permissions.deny`, the
`--allowed-tools`/`--disallowed-tools` flags, session decisions, and managed
policy. Rule syntax is `Tool` or `Tool(specifier)`, for example
`Bash(git:*)`, `Edit(src/**)`, or `mcp__server__tool`.

User-addressable modes are:

| Mode | Runtime behavior |
|---|---|
| `default` | Honor explicit rules and ask for undecided operations. |
| `plan` | Restrict mutation while planning. |
| `acceptEdits` | Auto-accept the supported edit path while retaining other checks. |
| `autoApprove` | Convert ordinary approval prompts to allow, except tools that require user interaction. Explicit deny rules and earlier safety checks still apply. |
| `bypassPermissions` | Broad bypass mode, but explicit ask rules and safety-check decisions that are marked bypass-immune can still prompt. Org/settings kill switches can disable the mode. |

`--dangerously-skip-permissions` selects bypass mode;
`--allow-dangerously-skip-permissions` makes that mode available to the
interactive selector. Managed settings can restrict permission rules, hooks,
and MCP servers to managed sources.

The normal external build does **not** enable the `TRANSCRIPT_CLASSIFIER`
feature. Its AI-classified `auto` mode is therefore source-only. The accepted
`permissions.classifierPermissionsEnabled` schema field is not read by a
shipped enforcement path and must not be treated as an active control.

Bash adds command parsing, command-injection checks, dangerous-pattern
classification, project safety policy, path validation, and sandbox-aware
permission decisions. `UR_CODE_DISABLE_COMMAND_INJECTION_CHECK` weakens one of
those checks and is not a safe default.

## OS sandbox — enforced when enabled and available

Set `sandbox.enabled` in settings to request OS-level Bash isolation. macOS uses
`/usr/bin/sandbox-exec`; Linux/WSL uses `bwrap`; Windows is unsupported. With
`sandbox.failIfUnavailable: false` (the default), an unavailable sandbox warns
and may run commands unsandboxed subject to permissions. Set
`failIfUnavailable: true` for a startup hard failure. The
`allowUnsandboxedCommands` policy controls whether a tool call may explicitly
request an unsandboxed run.

```text
/sandbox status
/sandbox check
/sandbox init
/sandbox eval "curl https://example.com" --json
/sandbox exclude "npm run test:*"
```

The command surface is easy to misread:

- `status` and `check` inspect support/configuration.
- `init` writes `.ur/safety-policy.json`; it does **not** write or enable an OS
  sandbox configuration.
- `eval` classifies a shell string through the project safety policy. It does
  not execute the command.
- `/sandbox exclude "<pattern>"` is an interactive slash-command action. It
  appends a non-duplicate pattern to `sandbox.excludedCommands` in the
  project-local `.ur/settings.local.json`; the shell form `ur sandbox exclude`
  is not implemented by the separate non-interactive command.
- An excluded match skips the OS sandbox for the entire Bash tool call. This is
  a convenience exception, not a security boundary: it weakens isolation and
  matching is heuristic. A compound call is excluded only when **every**
  non-empty executable subcommand matches an exclusion; one unmatched segment
  or a parse failure keeps the whole call sandboxed. Normal Bash permission
  and safety-policy checks still apply:
  exclusion does not itself grant tool permission.

Filesystem settings are merged with permission-derived paths. Existing parents
are canonicalized, sensitive UR/settings/skill paths are made non-writable, and
a sandbox-created bare-repository signature is scrubbed only when all required
signature paths appeared after the command.

Selective network-domain enforcement is not implemented by the compatibility
runtime. If allowed/denied domain lists are present, it fails closed by blocking
network for the sandboxed process instead of pretending to enforce host-level
filtering.

### Deny-default helper versus active profile

`buildSeatbeltProfile()` has a source-level `denyByDefault` option and also uses
a `(deny default)` profile when `allowRead` is non-empty. However,
`denyByDefault` is not part of `SandboxSettingsSchema`, and the shipped runtime
adapter does not pass it. With no `allowRead`, the macOS compatibility profile
uses `(allow default)` plus write/network/targeted denials. Therefore
`denyByDefault` is a tested builder capability, not a selectable shipped
setting. Linux `bwrap` separately mounts `/` read-only when no read allow-list
is supplied.

## Project shell safety policy — enforced for Bash

`.ur/safety-policy.json` classifies commands as read-only, project edits, safe
local commands, network operations, or destructive operations. Bash permission
checks consume this evaluation.

```text
/safety status
/safety init
/safety check --command "rm -rf build" --json
```

## Untrusted-content framing — enforced on three channels

`src/security/promptInjection.ts` provides deterministic detection and framing,
not a proof that prompt injection is impossible.

| Function | What it does |
|---|---|
| `scanForInjection(text)` | Detects seven instruction/exfiltration/boundary patterns plus hidden Unicode and reports a score. |
| `stripHiddenCharacters(text)` | Removes zero-width and bidirectional control characters. |
| `wrapUntrusted(text, source)` | Adds a random 128-bit nonce boundary, warning labels, and an in-memory source-ledger record. |
| `makeCanary()` / `canaryLeaked()` | Standalone canary helpers. |

The shipped automatic wrappers are exactly:

- `WebFetch` textual results;
- `WebSearch` formatted results (its citation reminder stays outside the data
  boundary); and
- textual MCP tool-result blocks, except a tool explicitly marked as a trusted
  control channel.

Local file reads, GitHub tool results, arbitrary user text, and every other
tool result do not pass through this wrapper merely because the module comment
mentions those threat classes. `makeCanary()` and `canaryLeaked()` are exported
helpers but are not installed in the main query/tool loop. `/sources` exposes
the bounded in-memory provenance created by actual `wrapUntrusted()` calls; it
does not prove that a model used a source to form a claim.

The durable boundaries remain permissions, OS sandboxing where enabled, scoped
credentials, and explicit human approval.

## Guardrails — manual checks plus two diff gates

Rules in `.ur/guardrails/*.json` support `regex`, `contains`, `pii`,
`maxLength`, `jsonSchema`, and `llm`; phases are `input`, `output`, or `both`;
actions are `warn` or `block`.

```text
/guardrails init
/guardrails list
/guardrails validate
/guardrails check "send this to x@y.com" --phase output --json
```

`/guardrails check` evaluates the supplied text and reports a tripwire. The
engine is **not** a universal pre/post hook on every normal tool call. Its
deterministic diff-compatible rules are additionally wired into:

- `agent-task pr --create` self-review; and
- the Agent CI review path.

LLM and JSON-schema guardrails are not part of those diff gates. A blocking
finding prevents the relevant PR/CI handoff unless that command's explicit
override path is used; it does not globally stop unrelated agent activity.

## Security toolkit — deterministic/local commands

The `/security` family is a command toolkit, not a collection of automatically
invoked model tools:

```text
/security scan
/security code
/security secrets
/security report
/scope set local
/threat-model
/vuln
/ir
/compliance
/playbook
/harden
/kali
/lab create web-vuln
```

Workspace code/secret scans are bounded heuristic scanners. `/vuln` consults
the dependency vulnerability implementation and can report no results when the
registry is unavailable. `/ir` and `/harden` are read-only collection/check
paths. `/scope` controls the security module's active web/testing operations;
it is separate from ordinary UR filesystem tool permissions. Lab creation
accepts only known templates and rejects unsafe roots.

The bundled `/security-review` skill is a model workflow prompt with explicit
verification and publishing instructions. Its existence does not turn the
security scanners into a universal automatic gate.

## Devcontainer target

`/devcontainer` is an explicit Docker-backed execution target described by
`.ur/devcontainer.json`:

```text
/devcontainer status
/devcontainer init --image node:22
/devcontainer exec -- npm test
```

It affects commands deliberately routed through the devcontainer command. It
does not transparently move every Bash/tool call into Docker.

## Stability ledger — recording is enforced; analysis is advisory

Normal tool start/finish hooks append action evidence to `.ur/actions.jsonl`.
The commands below inspect that ledger:

```text
/stability metrics
/stability firewall
/stability why "ECONNRESET"
/stability policy
/stability cooldown
/evidence 20
/actions 10
```

`metrics`, `firewall`, `why`, and `cooldown` calculate failure, latency,
repetition, blast-radius, or likely-cause summaries. `firewall` prints an
advisory recommendation; it does not pause or cancel the core query loop.
`StabilityMonitor` is a self-contained source API and is not instantiated by
the normal query loop. This is a Monitor/Analyze evidence layer, not a fully
automatic MAPE-K controller.

## Verifier gates — separate enforced query-loop layer

The verifier is independent of `/stability`. In the default `strict` mode its
L1 query-loop checks include empty turns, repeated calls, completion claims
versus successful tool effects, unfinished actionable tasks, and configured or
auto-detected project gates after edits. Interactive sessions ask before
running project gates; non-interactive sessions can run them directly unless
`verifier.askBeforeGates` says otherwise. `UR_VERIFIER_MODE=loose|off` weakens
or disables these checks.

Immediate promises such as “let me create it now” are checked only in the final
visible clause and require matching successful mutation evidence. Rejections
are capped at three per user turn to avoid an infinite correction loop. The
independent L2 verification subagent is opt-in through `/verify` or
`UR_VERIFIER_AUTO_SUBAGENT=1`; it is not auto-spawned by default.

## Claim ledger and credentials

`/claim-ledger add` stores claim/source strings in
`.ur/evidence/claims.json` through the contained private-state writer (atomic
replacement, regular-file/symlink checks, `0600` mode, and a 2 MiB bound).
Loading is fail-closed: malformed JSON, a wrong root shape, duplicate IDs,
unsupported confidence/source kinds, or malformed records make `list`,
`validate`, and `add` fail nonzero; `add` never replaces the corrupt file with
an empty ledger. Source kinds are `web`, `file`, `mcp`, `tool`, and `user`.
`validate` checks only this stored structure; it does **not** fetch URLs, open files,
or prove that a source still resolves.

On macOS, credentials prefer Keychain and fall back to
`~/.ur/.credentials.json` when keychain reads/writes fail. On Linux and Windows,
the current implementation uses that plaintext JSON store directly. The file
is chmod `0600`, but it is still plaintext; “kept in the OS keychain” is not a
cross-platform guarantee. `/privacy-settings` and `--offline` control
telemetry/network behavior separately from credential storage.
