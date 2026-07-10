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
    "model": "…", "baseUrl": "…", "timeoutMs": 30000,
    "commandPath": "…",            // external CLI path for cli-login providers
    "fallback": "…",
    "preferences": {},
    "availableModels": [], "modelOverrides": {}
  },
  "ollama": { "host": "http://localhost:11434", "lanDiscovery": true },
  "offline": false,
  "effortLevel": "high",
  "fastMode": false, "fastModePerSessionOptIn": false,
  "advisorModel": "…",
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
    "defaultMode": "acceptEdits"        // default | plan | acceptEdits | autoApprove
  },
  "sandbox": { /* SandboxSettingsSchema — OS sandbox for shell commands */ },
  "autoMode": { "allow": [], "soft_deny": [], "deny": [] },
  "useAutoModeDuringPlan": false, "disableAutoMode": false,
  "skipDangerousModePermissionPrompt": false,
  "skipAutoPermissionPrompt": false,
  "classifierPermissionsEnabled": false,
  "allowManagedPermissionRulesOnly": false
}
```
Rule syntax: `ToolName` (blanket) or `ToolName(specifier)` — e.g. `Bash(npm run *)`,
`Edit(src/**)`, `mcp__server__tool`. Managed via `/permissions` UI as well.

Permission modes:
- `default`: normal permission checks; operations that need review ask first.
- `plan`: planning-only mode until the user approves execution.
- `acceptEdits`: auto-approve safe in-workspace file edits and safe commands.
- `autoApprove`: auto-approve command/tool permission approvals, while
  user-input dialogs still ask and explicit denials remain enforced.

### Hooks
```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "./scripts/lint-command.sh" } ] }
    ],
    "PostToolUse": [ … ], "UserPromptSubmit": [ … ]
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

### MCP
```jsonc
{
  "mcpServers": { "db": { "command": "npx", "args": ["…"] } },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [], "disabledMcpjsonServers": [],
  "allowedMcpServers": [], "deniedMcpServers": [],
  "allowManagedMcpServersOnly": false
}
```

### Git & attribution
```jsonc
{
  "attribution": { "commit": true, "pr": true,
                   "includeCoAuthoredBy": true, "includeGitInstructions": true }
}
```

### UI & terminal
```jsonc
{
  "statusLine": { "type": "command", "command": "…", "padding": 1 },
  "theme": "…", "language": "en",
  "spinnerTipsEnabled": true, "spinnerVerbs": { "mode": "…", "verbs": [] },
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

### Memory & verification
```jsonc
{
  "autoMemoryEnabled": true, "autoMemoryDirectory": "…",
  "autoMemoryExtractionInterval": 1,   // run extraction every N turns (token dial)
  "automaticLearningEnabled": true,    // local outcome stats, no model calls
  "verifier": { "askBeforeGates": true },
  "autoDreamEnabled": false,
  "plansDirectory": "…"
}
```

### Plugins & marketplaces
```jsonc
{
  "enabledPlugins": { "fmt@acme": true },
  "pluginConfigs": {},
  "extraKnownMarketplaces": {},
  "strictKnownMarketplaces": false, "blockedMarketplaces": [],
  "strictPluginOnlyCustomization": false,
  "marketplace": {}, "plugin": { "defaultView": "…" }
}
```

### Auth, org & misc
```jsonc
{
  "apiKeyHelper": "./get-key.sh",
  "awsCredentialExport": "…", "awsAuthRefresh": "…", "gcpAuthRefresh": "…",
  "xaaIdp": { "issuer": "…", "clientId": "…", "callbackPort": 0 },
  "forceLoginMethod": "…", "forceLoginOrgUUID": "…",
  "otelHeadersHelper": "…",
  "env": { "FOO": "bar" },              // extra env for the session
  "companyAnnouncements": [],
  "remote": { "defaultEnvironmentId": "…" },
  "autoUpdatesChannel": "stable",
  "minimumVersion": "…", "disableDeepLinkRegistration": false,
  "cleanupPeriodDays": 30,
  "fileSuggestion": { "type": "command", "command": "…", "respectGitignore": true },
  "defaultShell": "…",
  "skipWebFetchPreflight": false,
  "voiceEnabled": false, "assistantName": "…",
  "sshConfigs": {}, "environment": {},
  "agent": "…"                          // default agent config
}
```

## Environment variables (grep of `src/`)

### Core behavior
| Variable | Effect |
|---|---|
| `UR_CODE_SIMPLE=1` | Minimal tool set (Bash/Read/Edit); set by `--bare` |
| `UR_CODE_REMOTE=true` | Remote/CCR container mode (raises heap to 8GB) |
| `UR_CODE_DISABLE_BACKGROUND_TASKS=1` | No background tasks |
| `UR_CODE_DISABLE_AUTO_MEMORY=1` | Disable auto-memory |
| `UR_CODE_DISABLE_CRON=1` | Disable cron/trigger scheduling |
| `UR_CODE_DISABLE_COMMAND_INJECTION_CHECK=1` | Skip bash injection analysis (not recommended) |
| `UR_CODE_MAX_OUTPUT_TOKENS` | Cap model output tokens |
| `UR_CODE_MAX_RETRIES` | API retry cap |
| `UR_CODE_EXTRA_BODY` | Extra JSON merged into API requests |
| `UR_CODE_COORDINATOR_MODE=1` | Coordinator (lead + workers) mode |
| `UR_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Agent teams/swarm mode |
| `UR_CODE_REPL=1` | REPL tool mode (VM-wrapped primitives) |
| `UR_CODE_USE_POWERSHELL_TOOL=1` | PowerShell tool |
| `UR_CODE_VERIFY_PLAN=true` | VerifyPlanExecution tool |
| `UR_CODE_INDEX=1` | Semantic code index + CodeSearch tool |
| `ENABLE_LSP_TOOL=1` | LSP tool |
| `UR_CODE_SYNTAX_HIGHLIGHT=0` | Disable syntax highlighting |
| `UR_CODE_ACCESSIBILITY=1` | Accessibility rendering |
| `UR_CODE_SHELL_PREFIX` | Prefix every shell command |
| `UR_CODE_PRESET_PREFIX` | Prompt preset prefix |
| `UR_CODE_TAGS` | Session tags |
| `UR_CODE_OVERRIDE_DATE` | Fake "today" (testing) |
| `UR_CODE_ABLATION_BASELINE=1` | Harness-science L0 baseline: sets SIMPLE, no thinking/compaction/memory/background |

### Providers & auth
| Variable | Effect |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | API-key providers |
| `UR_MODEL_POOL_CHEAP/STRONG/DEFAULT` | Model pools for routing |
| `UR_CODE_USE_BEDROCK` / `UR_CODE_USE_VERTEX` | AWS Bedrock / GCP Vertex backends |
| `UR_CODE_OAUTH_TOKEN` / `UR_CODE_OAUTH_REFRESH_TOKEN` / `UR_CODE_OAUTH_SCOPES` | OAuth token injection |
| `UR_CODE_SESSION_ACCESS_TOKEN` | Remote session token |
| `URHQ_DEFAULT_MODELO_MODEL` / `URHQ_DEFAULT_MODELS_MODEL` / `URHQ_DEFAULT_MODELH_MODEL` | Default model tiers (opus/sonnet/haiku-class) |
| `MCP_CLIENT_SECRET` | OAuth client secret for `ur mcp add` |

### Internal / build
`USER_TYPE=ant` (internal commands/tools), `IS_DEMO`, `NODE_OPTIONS`,
`COREPACK_ENABLE_AUTO_PIN=0` (forced), `UR_CODE_ENTRYPOINT`, `UR_CODE_WORKER_EPOCH`,
`UR_CODE_ENVIRONMENT_KIND`, `UR_CODE_IS_COWORK`, `UR_CODE_BRIEF`, `UR_CODE_PROACTIVE`,
`UR_CODE_EAGER_FLUSH`, `UR_CODE_STREAMLINED_OUTPUT`, `UR_CODE_DEBUG_REPAINTS`,
`UR_CODE_EXIT_AFTER_FIRST_RENDER`, `UR_CODE_TEST_FIXTURES_ROOT`.

## Keybindings

`~/.claude`-style keybindings live at `~/.ur/keybindings.json`; open with `/keybindings`,
get help with `/keybindings-help`. Managed by `src/keybindings/` (chords supported,
global + command-scoped bindings; see `useGlobalKeybindings.tsx` / `useCommandKeybindings.tsx`).

## Output styles

`outputStyle` setting selects a style; custom styles load from an output-styles directory
(`src/outputStyles/loadOutputStylesDir.ts`). `/output-style` is deprecated in favor of
`/config`. Built-in styles (`src/constants/outputStyles.ts`) include Explanatory,
Concise, JSON-strict (every response a parseable JSON object), Debug-verbose
(hypothesis-driven diagnostics), and Release-notes (changelog tone).
