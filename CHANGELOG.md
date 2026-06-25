# Changelog

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
