# Changelog

## 1.13.0

### Fixed
- **Image paste hint.** When the clipboard holds no image, the image paste
  shortcut (`ctrl+v`, `alt+v` on Windows) no longer shows a circular "use
  ctrl+v to paste images" message — the very key that was just pressed. It now
  tells you to copy an image (e.g. a screenshot) first, then press the shortcut
  to paste it. SSH sessions keep the existing `scp` hint.

## 1.12.3

### Added
- **Agent feature expansion commands.** Added `ur agent-features`,
  `ur agent-templates`, `ur automation`, `ur agent-task`, `ur model-doctor`,
  `ur semantic-memory`, `ur claim-ledger`, and `ur browser-qa` so the agent
  platform roadmap is visible and executable from both CLI and slash command
  surfaces.
- **Opt-in A2A task server.** `ur a2a serve` now exposes loopback Agent Card,
  health, and dry-run task endpoints from the launcher, with off-loopback binds
  requiring a bearer token.
- **Project scaffolds and examples.** `ur agent-features init` creates reusable
  project assets for agents, automations, GitHub workflow entrypoints, A2A,
  memory, provenance, and browser QA, with `examples/agent_features.md`
  documenting the workflow.

### Fixed
- **Agent template typo safety.** `ur agent-templates install <name>` now
  rejects unknown template names instead of interpreting a misspelling as
  "install all templates."
- **Ollama model inspection request.** `ur model-doctor` now uses the preferred
  `/api/show` request body key (`model`) when inspecting local Ollama models.

### Verified
- Added focused Bun tests for feature scaffolds, template installation,
  automations, PR dry-run generation, local memory/provenance/browser QA
  commands, and the model-doctor Ollama request body.

## 1.12.2

### Changed
- **Ziggurat of Ur spinner.** Replaced the canoe spinner with the Ziggurat of
  Ur catching light: an up-pyramid whose lit face sweeps across (`△ ◭ ▲ ◮`)
  with a gold glint at the fully-lit peak.
- **Lapis & gold prompt.** The prompt input rules are now dashed lapis-lazuli
  (Standard of Ur), with a Standard-of-Ur gold chevron and a soft navy
  drop-shadow beneath the box so the prompt reads as a card floating above the
  surface.

## 1.12.1

### Changed
- **Mashoof spinner.** The activity spinner is now a Mashoof (مشحوف) — the
  marsh canoe — bobbing on the water. It cycles boat-hull arcs (`⌣ ⏝ ‿`) into
  a gentle up-down bob loop instead of the old dot→blocks→house growth, and
  the brightness "breathe" was dropped so it reads as a clean bob.

## 1.12.0

### Added
- **Agent trend coverage.** New `ur agent-trends` CLI command and
  `/agent-trends` slash command report how UR maps to current agent trends:
  local-first model runtime, MCP, A2A, durable workflows, multi-agent
  orchestration, memory, browser automation, provenance, evals, security,
  agent identity, and multimodal workflows. The report includes source
  references for each trend.
- **A2A Agent Card export.** New `ur a2a card` CLI command and `/a2a-card`
  slash command print UR Agent Card metadata for discovery by A2A-aware tools.
- **Professional trend docs.** `docs/AGENT_TRENDS.md` documents the coverage
  matrix, source/trust policy, and prioritized roadmap.

### Changed
- **Web-source trust guidance.** WebSearch and WebFetch prompts now explicitly
  treat search results and fetched pages as untrusted evidence, not instruction
  channels, while preserving source citation requirements.

## 1.11.3

### Changed
- **Read-only web browsing.** `WebSearch` and `WebFetch` now run without
  prompting by default, while still respecting explicit deny or ask rules.
- **Source visibility.** `WebFetch` tool results now include the fetched URL so
  final answers can mention where the result came from.

## 1.11.2

### Fixed
- **Clarification dialogs.** `AskUserQuestion` is now loaded without a
  `ToolSearch` round trip and accepts common question text aliases such as
  `prompt` and `text`, preventing malformed clarification attempts from
  surfacing as validation errors.

## 1.11.1

### Changed
- **Npm publication docs.** README installation guidance now reflects that
  `ur-agent` is published on npm, while keeping the GitHub install path for
  source-based installs.

## 1.11.0

### Changed
- **Ollama model selection now lets routing work by default.** The launcher no
  longer forces `OLLAMA_MODEL` when neither `OLLAMA_MODEL` nor `UR_MODEL` is
  set, so UR's Ollama router can choose from the models exposed by the local
  Ollama app. The built-in fallback is `qwen3-coder:480b-cloud` when model-list
  discovery is unavailable.
- **Repository metadata now matches production.** Package metadata, docs, bundled
  issue links, marketplace defaults, and GitHub workflow templates now point to
  `Maitham16/UR-mapek`.

### Added
- **Release consistency gate.** `bun run release:check` verifies package,
  `bunfig.toml`, bundled CLI, docs, and launcher version output agree. It also
  runs automatically from `prepack`.
- **Quality notes.** `QUALITY.md` documents the release gate, runtime
  assumptions, safety boundaries, and known limits.
- **Stronger production CI.** The GitHub workflow now runs typecheck, tests,
  bundle, smoke, secret scan, release check, package dry-run, and global install
  verification.

### Fixed
- **Stale bundle/version drift.** The release process now prevents publishing a
  package where `package.json`, `dist/cli.js`, `bunfig.toml`, and `ur --version`
  disagree.
- **Ollama Cloud wording.** Docs now clarify that UR talks only to the local
  Ollama app, while models exposed by that app may be local or Ollama
  Cloud-backed.

## 1.10.2

### Fixed
- **Clipboard image paste — the fix that actually ships.** The 1.10.1 change edited the native NSPasteboard branch, which is dead-code-eliminated from the bundle (its feature gate compiles out), so it never ran. The live path is osascript, whose `saveImage` reused a fixed temp file (`ur_cli_latest_screenshot.png`) opened `with write permission` but never truncated — so a smaller image pasted over a previously larger one kept the old trailing bytes, producing a corrupt PNG ("found in clipboard but not attached"). Added `set eof fp to 0` to truncate before writing.

## 1.10.1

### Fixed
- **Clipboard image paste.** An image the clipboard reported as present but the native reader couldn't decode was silently dropped — "found in clipboard but not attached." `getImageFromClipboard` now falls back to the osascript path instead of treating a native `null` as authoritative.
- **Token truncation on Ollama Cloud models.** Cloud models (the `-cloud` / `:cloud` suffix) now default to a 128K-token context floor for both `num_ctx` and auto-compaction, instead of the small or missing value `/api/show` reports for them — so prompts are no longer silently truncated, with no env vars required. The reported value is still used when it is larger, and `UR_OLLAMA_NUM_CTX` (no longer capped to the detected value) / `OLLAMA_CONTEXT_TOKENS` still override.

### Changed
- **Default model** is now `qwen3-coder:480b-cloud` instead of `llama3.2`, so a session started without an explicit model no longer falls back to a 3B model.
- **Comment discipline now applies to all sessions.** UR's "default to writing no comments / don't explain WHAT the code does / verify it actually works before reporting complete" guidance was gated to internal builds; it is now enabled for everyone (the upstream `@[MODEL LAUNCH]` TODO had it marked for external release).

## 1.10.0

### Added
- **`skill-forge` plugin** in the `ur-plugins-official` marketplace — have the agent author skills for you. `/forge-skill <description>` runs on the active session model: it designs the skill (name, `when_to_use` triggers, arguments, minimal `allowed-tools`, inline vs fork, and steps that each carry a success criterion), shows the `SKILL.md` for a single confirmation, then saves it to `~/.ur/skills/<name>/` (or `./.ur/skills/` with `--project`) without clobbering an existing one. `/skill-refine <name> : <change>` improves an existing skill, and a bundled `skill-authoring` skill encodes the conventions. Complements the built-in `/create-skill`, which only scaffolds an empty template.

### Verified
- The plugin manifest plus its two command and one skill frontmatter blocks parse as strict YAML; the marketplace entry resolves; and there are no slash-command name collisions across the marketplace.

## 1.9.0

### Added
- **Seven first-party integration plugins** in the `ur-plugins-official` marketplace. Each bundles an official MCP server, curated slash commands, and a methodology skill, and falls back to a CLI or local library so the commands still work before any token is configured:
  - **`obsidian`** — operate a vault as a second brain: `/second-brain`, `/daily-note`, `/moc`, `/backlinks`, `/vault-search`. Direct vault file edits or the Obsidian Local REST API MCP server, plus a Zettelkasten/PARA/MOC skill.
  - **`github`** — `/gh-pr-review`, `/gh-pr-create`, `/gh-issues`, `/gh-repo-health` via GitHub's official remote MCP server (`api.githubcopilot.com/mcp/`) or the `gh` CLI.
  - **`gitlab`** — `/gl-mr-review`, `/gl-mr-create`, `/gl-issues`, `/gl-pipeline` via GitLab's official MCP server (OAuth) or the `glab` CLI.
  - **`huggingface`** — `/hf-model-search`, `/hf-dataset-search`, `/hf-model-card`, `/hf-download` via the official Hugging Face MCP server or the `hf` CLI.
  - **`word`** — `/docx-new`, `/docx-from-md`, `/docx-review`, `/docx-edit` via the Office Word MCP server (`uvx`) or a pandoc / python-docx fallback.
  - **`powerpoint`** — `/pptx-new`, `/pptx-from-md`, `/pptx-review`, `/pptx-theme` via the Office PowerPoint MCP server (`uvx`) or a python-pptx fallback.
  - **`miro`** — `/miro-board`, `/miro-diagram`, `/miro-stickies`, `/miro-export` via Miro's official MCP server (OAuth) or the REST API.
- Each manifest wires its MCP server through `userConfig`, so tokens are prompted at enable time and stored in secure storage (keychain / credentials file) — never in plaintext settings or prompt content.

### Verified
- All seven manifests validate against the plugin schema (mcpServers transport, `userConfig` identifiers, `${user_config}` resolution); 36 command/skill frontmatter blocks parse as strict YAML; no secret keys are referenced in prompt content; and there are no slash-command name collisions across the marketplace.

## 1.8.0

### Added
- **`/create-skill` command.** Scaffold a new skill without leaving the REPL: `/create-skill <name> [: <description>] [--project]` writes a ready-to-edit `SKILL.md` (with frontmatter) to `~/.ur/skills/<name>/` — or `.ur/skills/` with `--project` — refuses to clobber an existing skill, and clears caches so it shows up immediately (alias `/new-skill`).
- **Game Designer mode.** A new built-in output style (`/output-style`) that makes UR reason like a game designer — core loops, player fantasy, game feel, and tunable balance constants — while it writes working code.
- **Thinking toggle in the model picker.** `/model` now lets you toggle extended thinking with `t` (alongside `← →` effort cycling) for models that support it. The choice applies to the session and persists via `alwaysThinkingEnabled`.

### Fixed
- **`/update-config` no longer crashes** with `Undefined cannot be represented in JSON Schema`. The settings-schema generator now tolerates Zod types with no JSON Schema equivalent (e.g. the `enabledPlugins` union) instead of throwing.

## 1.7.0

### Added
- **Adaptive model routing (Ollama).** The agent auto-selects the best installed model per tier — the strongest coder model for the main loop, the smallest fast model for light internal work (titles, classification, session search, hooks). Honors `OLLAMA_MODEL` / `OLLAMA_SMALL_FAST_MODEL`; gated by `UR_OLLAMA_AUTO_ROUTE`.
- **Per-model context auto-tuning.** Each request sets `num_ctx` from the model's real context window and the prompt size (floored at 32K for agent work, bucketed so the KV cache stays warm), fixing silent truncation at Ollama's 4096 default. Override with `UR_OLLAMA_NUM_CTX`.
- **Keep-alive for faster responses.** Requests set `keep_alive` (default 30m) to keep the active model warm between turns and cut first-token latency. Override with `UR_OLLAMA_KEEP_ALIVE`.
- **Smarter model listing.** `/model` shows each model's tier (coder/fast) and context window; `/ur-doctor` reports the routing picks and recommends pulling a coder model when none is installed.

### Verified
- New unit tests for routing, context tuning, and keep-alive (including an end-to-end request-body assertion); full suite green.

## 1.6.0

### Added
- **Proactive clarification & planning prompts.** The agent now uses the `AskUserQuestion` multiple-choice popup before significant or ambiguous work and at key planning decisions. Options are navigated with arrow keys and submitted; the last "Other" entry always lets you type a custom answer.
- **Smarter prompt handling.** New always-on guidance makes the agent resolve ambiguity before acting, work in verifiable steps and check each step's output against the request before continuing, verify work actually runs before reporting done, report outcomes faithfully, and keep changes precisely scoped and professional.

### Changed
- **Fewer permission prompts (Balanced default).** When no permission mode is explicitly configured, sessions now start in `acceptEdits`: in-project file edits and safe filesystem/read-only commands are auto-approved, while risky or out-of-project actions still prompt. Override anytime with `permissions.defaultMode` or `--permission-mode`.
- **Elegant breathing spinner.** The house glyph (`⌂`) and bar now pulse smoothly between dim and bright instead of hard-blinking.
