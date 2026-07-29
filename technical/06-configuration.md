# 06 — Configuration

Source of truth: `src/utils/settings/{types.ts,constants.ts,settings.ts}`,
`src/utils/hooks/`, `src/keybindings/`, `src/utils/permissions/`.

## Settings scopes (later overrides earlier)

| Scope | File | Notes |
|---|---|---|
| user | `~/.ur/settings.json` | global |
| project | `.ur/settings.json` | shared, committed |
| local | `.ur/settings.local.json` | gitignored |
| flag | `--settings <file-or-json>` | per-invocation |
| managed/policy | managed-settings.json or remote org settings | read-only, always loaded |

`--setting-sources user,project,local` restricts which editable scopes load.
Schema URL for editors: `https://json.schemastore.org/ur-settings.json`.

Edit interactively with `/config`, by natural language with `/update-config`
(bundled skill), or directly in the JSON files.

Model selection has one intentional exception to ordinary merged precedence:
a user-global model alone does not initialize a fresh workspace. Interactive
startup requires a provider/model choice and writes it to
`.ur/settings.local.json`; fresh headless startup requires `--model`, a model
environment variable, or project/flag/managed configuration. Resumed sessions
restore their session model without showing the picker.

## settings.json keys (from `SettingsSchema`, `src/utils/settings/types.ts`)

### Model & provider
```jsonc
{
  "model": "qwen2.5-coder:7b",
  "provider": {
    "active": "ollama",
    "model": "qwen2.5-coder:7b",
    "baseUrl": "http://localhost:11434",
    "timeoutMs": 30000,
    "fallback": "disabled",
    "openaiTransport": "responses", // chat-completions (default) | responses
    "responses": {
      "store": false,
      "compactThreshold": 20000,
      "toolSearch": "hosted"        // off (default) | hosted
    },
    "preferences": {}
  },
  "ollama": { "host": "http://localhost:11434", "lanDiscovery": true },
  "offline": false,
  "effortLevel": "high",
  "fastMode": false, "fastModePerSessionOptIn": false,
  "advisorModel": "qwen2.5-coder:32b",
  "alwaysThinkingEnabled": false, "showThinkingSummaries": true,
  "availableModels": [], "modelOverrides": {}
}
```

### Permissions & safety
```jsonc
{
  "permissions": {
    "allow": ["Bash(git:*)", "Read", "WebFetch(domain:docs.example.com)"],
    "deny":  ["Bash(rm -rf:*)", "mcp__untrusted-server"],
    "ask":   ["Bash(git push:*)"],
    "additionalDirectories": ["../lib"],
    "defaultMode": "acceptEdits",       // default | plan | acceptEdits | autoApprove | bypassPermissions
    "profiles": {                       // named rule sets, appended when active
      "reviewing": { "deny": ["Edit", "Write", "Bash"], "description": "read-only" },
      "trusted":   { "allow": ["Bash(git:*)"] }
    },
    "activeProfile": "reviewing"        // switch with /permission-profile use <name>
  },
  "agents": {                           // subagent fan-out limits (doc 09)
    "maxDepth": 3,                      // default 3, hard ceiling 10
    "maxConcurrent": 20                 // default 20, hard ceiling 100
  },
  "voice": {                            // end-of-turn speech, off by default
    "speakResponses": false,
    "name": "Samantha", "rate": 210
  },
  "memory": {                           // end-of-turn suggestions, off by default
    "suggest": false,
    "suggestMinConfidence": 0.75
  },
  "sandbox": { /* SandboxSettingsSchema — OS sandbox for shell commands */ },
  "tasks": {
    "requireBeforeChanges": {
      "enabled": true,                  // default: true
      "freeReads": 3                    // calls allowed before ordinary mutations require a plan
    }
  },
  "disableAutoMode": "disable",
  "skipDangerousModePermissionPrompt": false,
  "allowManagedPermissionRulesOnly": false
}
```
Profiles are appended to the base `allow`/`deny`/`ask` lists from the same
settings source, so a profile can only narrow or extend — `deny` still beats
`allow`. A missing or misnamed `activeProfile` contributes nothing rather than
failing open. `/permission-profile use <name>` writes the switch to whichever
source defines the profile, so it lands beside its definition.

Fan-out limits clamp rather than disable: out-of-range, negative and
non-numeric values fall back to the default or the ceiling, so a settings file
cannot switch the governor off.

Rule syntax: `ToolName` (blanket) or `ToolName(specifier)` — e.g. `Bash(npm run *)`,
`Edit(src/**)`, `mcp__server__tool`. Managed via `/permissions` UI as well.

Permission modes:
- `default`: normal permission checks; operations that need review ask first.
- `plan`: planning-only mode until the user approves execution.
- `acceptEdits`: auto-approve safe in-workspace file edits and safe commands.
- `autoApprove`: auto-approve command/tool permission approvals, while
  user-input dialogs still ask and explicit denials remain enforced.
- `bypassPermissions`: bypass permission prompts after the separate dangerous-mode
  acknowledgement/CLI opt-in; use only in an external sandbox with no sensitive access.

`autoMode`, `useAutoModeDuringPlan`, `skipAutoPermissionPrompt`, and
`permissions.disableAutoMode` exist only in builds compiled with
`TRANSCRIPT_CLASSIFIER`; `classifierPermissionsEnabled` is additionally internal-only.
The standard npm build accepts `autoApprove`, which is deterministic permission approval,
not model-based classification.

### Hooks
```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "./scripts/lint-command.sh" } ] }
    ],
    "PostToolUse": [], "UserPromptSubmit": []
  },
  "disableAllHooks": false,
  "allowManagedHooksOnly": false,
  "allowedHttpHookUrls": [], "httpHookAllowedEnvVars": []
}
```
Hook events (`src/entrypoints/sdk/coreTypes.ts:HOOK_EVENTS`): `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`,
`Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`,
`PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`,
`TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`,
`WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `BeforeEdit`,
`AfterEdit`, `BeforeCommand`, `AfterCommand`, `BeforeCommit`, `OnFailure`.
Hook types: `command` (shell), plus prompt/agent hooks (`execPromptHook.ts`,
`execAgentHook.ts` — run a model prompt or subagent as the hook). View with `/hooks`.

### MCP policy
```jsonc
{
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [], "disabledMcpjsonServers": [],
  "allowedMcpServers": [], "deniedMcpServers": [],
  "allowManagedMcpServersOnly": false
}
```

Server definitions do not live under `mcpServers` in `settings.json`; configure them through
`ur mcp` / `.mcp.json`. The keys above are approval and enterprise-policy controls.

### Git & attribution
```jsonc
{
  "attribution": {
    "commit": "Co-authored-by: UR-Nexus <noreply@example.invalid>",
    "pr": "Generated with UR-Nexus"
  },
  "includeCoAuthoredBy": true,
  "includeGitInstructions": true
}
```

### UI & terminal
```jsonc
{
  "statusLine": { "type": "command", "command": "./scripts/status.sh", "padding": 1 },
  "language": "en",
  "spinnerTipsEnabled": true, "spinnerVerbs": { "mode": "append", "verbs": [] },
  "spinnerTipsOverride": { "excludeDefault": false, "tips": [] },
  "syntaxHighlightingDisabled": false,
  "terminalTitleFromRename": true,
  "prefersReducedMotion": false,
  "outputStyle": "…",                 // output style name (src/outputStyles)
  "promptSuggestionEnabled": true,
  "showClearContextOnPlanAccept": true,
  "feedbackSurveyRate": 1
}
```

`theme` is global application config managed by `/theme`, not a `SettingsSchema` key.

### Memory & verification
```jsonc
{
  "autoMemoryEnabled": true, "autoMemoryDirectory": "~/.ur/project-memory",
  "autoMemoryExtractionInterval": 1,   // run extraction every N turns (token dial)
  "automaticLearningEnabled": true,    // local outcome stats, no model calls
  "verifier": { "askBeforeGates": true }, // one approval request per user turn
  "autoDreamEnabled": false,
  "plansDirectory": ".ur/plans"
}
```

### Plugins & marketplaces
```jsonc
{
  "enabledPlugins": { "fmt@acme": true },
  "pluginConfigs": {},
  "extraKnownMarketplaces": {},
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "acme/approved-plugins" }
  ],
  "blockedMarketplaces": [],
  "strictPluginOnlyCustomization": false
}
```

### Auth, org & misc
```jsonc
{
  "apiKeyHelper": "./get-key.sh",
  "awsCredentialExport": "./scripts/aws-env.sh",
  "awsAuthRefresh": "./scripts/aws-refresh.sh",
  "gcpAuthRefresh": "gcloud auth application-default login",
  "forceLoginMethod": "urai",
  "forceLoginOrgUUID": "00000000-0000-0000-0000-000000000000",
  "otelHeadersHelper": "./scripts/otel-headers.sh",
  "env": { "FOO": "bar" },              // extra env for the session
  "companyAnnouncements": [],
  "remote": { "defaultEnvironmentId": "dev-lab" },
  "autoUpdatesChannel": "stable",
  "minimumVersion": "1.65.6",
  "cleanupPeriodDays": 30,
  "fileSuggestion": { "type": "command", "command": "./scripts/files.sh" },
  "respectGitignore": true,
  "defaultShell": "bash",
  "skipWebFetchPreflight": false,
  "voiceEnabled": false,
  "sshConfigs": [
    { "id": "lab", "name": "Lab server", "sshHost": "dev@lab.example" }
  ],
  "agent": "reviewer"                   // default agent config
}
```

`xaaIdp` is conditional on `UR_CODE_ENABLE_XAA`; when enabled,
`callbackPort` is optional but must be a positive integer. The
`disableDeepLinkRegistration: "disable"` key exists only in LODESTONE builds.
`assistantName` is KAIROS-only. There are no top-level `environment`,
`marketplace`, or `plugin` objects in the standard settings schema.

## Supported environment variables

These tables cover user-facing runtime controls. Platform-detection variables,
CI-provider metadata, test fixtures, and compile-time-only/internal branches
are not presented as supported configuration merely because source code reads
them.

### Providers

| Variable | Effect |
|---|---|
| `OLLAMA_API_KEY` | Bearer token for Ollama's hosted API. With no host set, also switches the base URL to `https://ollama.com` — a local daemon needs no key, a direct connection does. Allowlisted through the Agentic CI env scrub |
| `OLLAMA_HOST` / `OLLAMA_BASE_URL` | Explicit Ollama endpoint; always wins over the key-implied cloud default |
| `OLLAMA_CONTEXT_TOKENS` | Override the detected context window |
| `API_TIMEOUT_MS` | Explicit Ollama request timeout in milliseconds; overrides the model-aware runtime default |
| `UR_API_TIMEOUT_MS` | Default provider HTTP-client timeout where supported |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Provider credentials; also allowlisted for Agentic CI |

### Core behavior
| Variable | Effect |
|---|---|
| `UR_CODE_SIMPLE=1` | Minimal tool set (Bash/Read/Edit); set by `--bare` |
| `UR_CODE_REMOTE=true` | Remote/CCR container mode (raises heap to 8GB) |
| `UR_CODE_DISABLE_BACKGROUND_TASKS=1` | Remove background mode from the Bash, PowerShell, and Agent tools. It does not disable the separate public `ur bg` command |
| `UR_CODE_DISABLE_AUTO_MEMORY=1` | Disable auto-memory |
| `UR_CODE_DISABLE_COMMAND_INJECTION_CHECK=1` | Skip bash injection analysis (not recommended) |
| `UR_CODE_MAX_OUTPUT_TOKENS` | Cap model output tokens |
| `UR_CODE_MAX_RETRIES` | API retry cap |
| `UR_CODE_EXTRA_BODY` | Extra JSON merged into API requests |
| `UR_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Opt into agent teams/swarm mode in external builds (also available through hidden `--agent-teams`); the runtime kill-switch still applies |
| `UR_CODE_USE_POWERSHELL_TOOL=1` | Enable the PowerShell tool on Windows |
| `UR_CODE_INDEX=1` | Force-enable the semantic code index + CodeSearch tool; an existing built index enables it automatically, while `0`, `false`, or `off` force-disable it |
| `UR_CODE_ENABLE_TASKS=1` | Use structured TaskCreate/Get/Update/List tools in headless/SDK sessions; interactive sessions use them by default |
| `UR_CODE_MAX_TOOL_USE_CONCURRENCY` | Cap concurrent-safe tools in the ordinary agent loop (default 10, clamped to 1–32) |
| `UR_MAX_CONCURRENT_TOOLS` | Cap concurrent-safe tools in the streaming executor (default 8, clamped to 1–32); set both concurrency variables when one limit is desired across both paths |
| `ENABLE_LSP_TOOL=1` | LSP tool |
| `UR_BROWSER_TOOL=1` / `WEB_BROWSER_TOOL=1` | Enable the model-invocable Browser tool. Its guarded `fetch` action is runtime-independent; interactive actions require `playwright-core` and an installed Chromium/Chrome executable |
| `UR_CODE_SYNTAX_HIGHLIGHT=0` | Disable syntax highlighting |
| `UR_CODE_ACCESSIBILITY=1` | Accessibility rendering |
| `UR_CODE_SHELL_PREFIX` | Prefix every shell command |
| `UR_CODE_TAGS` | Add one opaque `tags` value to analytics environment metadata; it does not tag a conversation for `/resume` |
| `UR_CODE_OVERRIDE_DATE` | Fake "today" (testing) |
| `UR_CODE_DISABLE_AUTO_LEARNING=1` | Disable automatic local pass/fail outcome recording |

### Providers & auth
| Variable | Effect |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | API-key providers |
| `UR_MODEL_POOL_CHEAP/STRONG/DEFAULT` | Model pools for routing |
| `UR_CODE_OAUTH_TOKEN` / `UR_CODE_OAUTH_REFRESH_TOKEN` / `UR_CODE_OAUTH_SCOPES` | OAuth token injection |
| `UR_CODE_SESSION_ACCESS_TOKEN` | Remote session token |
| `URHQ_DEFAULT_MODELO_MODEL` / `URHQ_DEFAULT_MODELS_MODEL` / `URHQ_DEFAULT_MODELH_MODEL` | Default model tiers (opus/sonnet/haiku-class) |
| `MCP_CLIENT_SECRET` | OAuth client secret for `ur mcp add` |
| `UR_OPENAI_RESPONSES_STATE_KEY` | 32-byte hex/base64 key required to persist encrypted compacted Responses context |

### Protocol, skill, and telemetry controls
| Variable | Effect |
|---|---|
| `UR_MCP_HTTP_TOKEN` / `UR_MCP_HTTP_*` | Authenticate and bound the opt-in stateless MCP 2026 Tasks/Apps server |
| `UR_A2A_TOKEN` / `UR_A2A_DELEGATION_SECRET` / `UR_A2A_*` | Authenticate, scope, and bound A2A v0.3/v1 serving |
| `UR_ACP_STDIO_*` | Bound ACP durable sessions, prompts, output, and runtime |
| `UR_SKILLS_STRICT_SPEC=true` | Reject file skills that violate the Agent Skills specification |
| `UR_SKILLS_REQUIRE_TRUSTED_SIGNATURE=true` | Require a trusted Ed25519 skill signature at load and invocation |
| `UR_SKILL_TRUSTED_KEYS_FILE` | Override the trusted **public** skill-key store used to verify signatures |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | Explicitly enable `otlp` or `console`; unset/`none` is off |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` | Opt into bounded prompt/tool/memory content attributes (off by default) |
| `OTEL_SDK_DISABLED=true` | Disable all OpenTelemetry SDK export |

### Internal / build
`USER_TYPE=ant` (internal commands/tools), `IS_DEMO`, `NODE_OPTIONS`,
`COREPACK_ENABLE_AUTO_PIN=0` (forced), `UR_CODE_ENTRYPOINT`, `UR_CODE_WORKER_EPOCH`,
`UR_CODE_ENVIRONMENT_KIND`, `UR_CODE_IS_COWORK`, `UR_CODE_BRIEF`, `UR_CODE_PROACTIVE`,
`UR_CODE_EAGER_FLUSH`, `UR_CODE_STREAMLINED_OUTPUT`, `UR_CODE_DEBUG_REPAINTS`,
`UR_CODE_EXIT_AFTER_FIRST_RENDER`, `UR_CODE_TEST_FIXTURES_ROOT`.

Names found only in dead feature branches are not runtime switches. In particular,
`UR_CODE_REPL`, `UR_CODE_VERIFY_PLAN`, `UR_CODE_USE_BEDROCK`,
`UR_CODE_USE_VERTEX`, `UR_CODE_DISABLE_CRON`, `UR_CODE_COORDINATOR_MODE`, and
`UR_CODE_ABLATION_BASELINE` do not enable their named backend/tool/mode in the standard
build. The last three are read only inside `AGENT_TRIGGERS`, `COORDINATOR_MODE`, and
`ABLATION_BASELINE` compile-time branches respectively; none of those features is enabled
by `scripts/bundle.mjs`.

## Keybindings

`~/.claude`-style keybindings live at `~/.ur/keybindings.json`; open with `/keybindings`,
get help with `/keybindings-help`. Managed by `src/keybindings/` (chords supported,
global + command-scoped bindings; see `useGlobalKeybindings.tsx` / `useCommandKeybindings.tsx`).

## Output styles

`outputStyle` setting selects a style; custom styles load from an output-styles directory
(`src/outputStyles/loadOutputStylesDir.ts`). `/output-style` is deprecated in favor of
`/config`. Built-in styles (`src/constants/outputStyles.ts`) are Explanatory,
Game Designer, Learning, Concise, JSON-strict (every response a parseable JSON object),
Debug-verbose (hypothesis-driven diagnostics), and Release-notes (changelog tone).

## Settings not covered above

These keys exist in `SettingsSchema` (`src/utils/settings/types.ts`) and were
previously undocumented — the gap that let several releases ship settings no
one could discover. `test/settingsDocCoverage.test.ts` now fails if any schema
key is missing from this file.

| Key | What it does |
|---|---|
| `$schema` | JSON Schema URL for editor completion in `settings.json`. Not a UR setting; ignored at runtime. |
| `worktree.symlinkDirectories` | Directories symlinked from the main repository into each worktree instead of being copied, to avoid disk bloat. Nothing is symlinked unless listed; `node_modules`, `.cache` and `.bin` are the usual candidates. |
| `worktree.sparsePaths` | Paths to materialize when creating a worktree, via `git sparse-checkout` in cone mode. In a large monorepo only the listed paths are written to disk, which is dramatically faster. |
| `channelsEnabled` | Teams/Enterprise opt-in for channel notifications from MCP servers that declare the capability. Off unless set. |
| `allowedChannelPlugins` | Allow-list of `{ marketplace, plugin }` pairs permitted to deliver channel notifications. Used with `channelsEnabled` to bound which plugins can notify. |
| `urMdExcludes` | Glob patterns or absolute paths of `UR.md` files to skip when loading project memory. Use it to keep vendored or generated `UR.md` files out of context. |
| `pluginTrustMessage` | Extra text appended to the plugin trust warning shown before installation, for organizations that need to state their own policy at that moment. |

## Tool-result pruning (`context.pruneToolResults`)

Superseded tool results — old file reads, greps, shell output — are cleared
from context once doing so would free a worthwhile amount, keeping the most
recent ones untouched.

| Key | Default | What it does |
|---|---|---|
| `context.pruneToolResults.enabled` | `true` | Master switch. |
| `context.pruneToolResults.minTokensFreed` | `20000` | Prune only when it would free at least this many tokens. Clearing invalidates the cached prefix, so a small cleanup costs more in cache misses than it reclaims; short sessions are never touched. |
| `context.pruneToolResults.keepRecent` | `8` | Protected zone. The most recent N compactable tool results are never cleared, so the model keeps the working set it is reasoning about. Floored at 1. |

Why it is on by default: the alternative when context fills is autocompact,
which replaces the entire history with a summary. Dropping a superseded file
read is strictly less destructive than losing the conversation.

Compactable tools are `Read`, shell, `Grep`, `Glob`, `WebSearch`, `WebFetch`,
`Edit` and `Write`. Cleared results are replaced with a marker, not deleted, so
the tool call itself remains visible in the transcript.

This is separate from the time-based trigger (`tengu_slate_heron`), which fires
only after an hour of idling and is configured through GrowthBook — a service a
local install never reaches, so it is effectively always off.

## Memory integrity signing (`UR_MEMORY_INTEGRITY_KEY`)

Unsigned, the manifest defends against accident and unaware tampering only:
anyone who can write a memory file can also rewrite the manifest to match, and
verification passes. Setting `UR_MEMORY_INTEGRITY_KEY` adds an HMAC over the
file digests, so a forged manifest is detected even when every digest matches
the file beside it.

Off by default, deliberately. A key has to live somewhere, and a key stored
next to the data it protects adds no security — enable this only when the key
comes from somewhere the memory directory is not (password manager, CI secret).

`ur memory-integrity verify` exits non-zero on an invalid signature, and also
when a manifest is signed but no key is available: an unverifiable signature is
not a pass.
