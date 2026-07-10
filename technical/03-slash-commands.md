# 03 — Slash Command Reference

Source of truth: `src/commands.ts` (registry) and each command definition.
Every command below exists in the registry; descriptions and argument hints are taken from
the command definitions in code. Aliases are shown in parentheses. Commands of type `local`
are also runnable from the shell as `ur <command>` when wired in `src/main.tsx` (see doc 02).
Registry integrity tests require unique invocation tokens, non-empty descriptions, valid
names/aliases, loadable implementations, and coverage in this document.

Command types: **prompt** = expands to model input · **local** = runs locally, prints text ·
**jsx** = interactive Ink dialog.

---

## 1. Session & conversation

| Command | Type | What it does | Example |
|---|---|---|---|
| `/clear` (`/reset`, `/new`) | local | Clear history, free context | `/clear` |
| `/compact [instructions]` | local | Summarize + clear; keeps a summary in context | `/compact keep the API design decisions` |
| `/resume [id or search]` (`/continue`) | jsx | Resume a previous conversation | `/resume auth refactor` |
| `/rename [name]` | jsx | Rename the current conversation | `/rename payment-bug` |
| `/tag <tag-name>` | jsx | Toggle a searchable tag on this session | `/tag experiments` |
| `/branch [name]` (`/fork`) | jsx | Branch the conversation at this point | `/branch try-other-approach` |
| `/rewind` (`/checkpoint`) | local | Restore code and/or conversation to a previous checkpoint | `/rewind` |
| `/undo` | local | Restore the most recently edited file to its pre-edit (last turn) content; deletes a file the last edit created | `/undo` |
| `/thread share\|list` (`/threads`) | local | Share a session transcript as a local web page on the artifacts server | `/thread share` |
| `/export [filename]` | jsx | Export conversation to file or clipboard | `/export session.md` |
| `/copy` | jsx | Copy the last response to the clipboard | `/copy` |
| `/btw <question>` | jsx | Quick side question without derailing the main thread | `/btw what does SIGPIPE mean?` |
| `/exit` (`/quit`) | jsx | Exit the REPL | `/exit` |
| `/session` (`/remote`) | jsx | Show remote session URL + QR code | `/session` |
| `/desktop` (`/app`) | jsx | Continue this session in UR Desktop | `/desktop` |
| `/summary` | internal | Summarize conversation (internal builds) | — |

## 2. Context & memory

| Command | Type | What it does | Example |
|---|---|---|---|
| `/context` | jsx | Visualize context usage as a colored grid | `/context` |
| `/files` | local | List files currently in context | `/files` |
| `/memory` | jsx | Edit memory files (UR.md, UR.local.md, auto-memory) | `/memory` |
| `/remember <text>` | local | Save a fact/preference to memory | `/remember we deploy from the release branch only` |
| `/forget <text>` | local | Remove memory notes matching text | `/forget release branch` |
| `/memory-retention` (`/retention`) | local | Show/set/prune memory retention policy (`--ttl-days`, `--max-entries`, `--decay-days`) | `/memory-retention set --ttl-days 90` |
| `/semantic-memory` (`/memory-index`) | local | Build & search the project-local memory embedding index | `/semantic-memory search "auth token rotation"` |
| `/context-pack` (`/ctx-pack`, `/project-manifest`) | local | Scan repo architecture, remember decisions/constraints, compress project context under `.ur/` | `/context-pack remember --type decision --text "we use fastify"` |
| `/wiki generate\|map\|install-hook\|status` (`/repo-wiki`) | local | Living repo wiki + prompt-injected repo map; post-merge hook keeps both fresh | `/wiki generate` |
| `/knowledge` (`/kb`) | local | Curated knowledge base with provenance: add/remove/build/search/list/prune/status (`--embeddings`) | `/knowledge add src/auth/jwt.ts --note "token flow"` then `/knowledge search "refresh token"` |
| `/add-dir <path>` | jsx | Add another working directory | `/add-dir ../shared-lib` |
| `/init` | prompt | Analyze the codebase and generate the UR.md project memory file | `/init` |

## 3. Models & providers

| Command | Type | What it does | Example |
|---|---|---|---|
| `/model [model]` | jsx | Pick the session model | `/model qwen2.5-coder:7b` |
| `/provider [provider]` | jsx | Pick/inspect the model provider | `/provider ollama` |
| `/connect [status\|provider\|logout p]` | local | Connect a provider account or store an API key | `/connect openrouter --key sk-or-…` |
| `/model-doctor [model]` (`/model-capabilities`) | local | Probe local Ollama models for agent capabilities (tool calls, context, speed) | `/model-doctor llama3.3` |
| `/model-route <task>` (`/model-pick`) | local | Recommend best model for a task from cheap/strong/default pools | `/model-route "large refactor across 40 files"` |
| `/local-first` (`/offline-readiness`, `/local`) | local | Report readiness for no-cloud/offline/lab environments | `/local-first --json` |
| `/effort [low\|medium\|high\|max\|auto]` | jsx | Set model effort level | `/effort high` |
| `/fast [on\|off]` | jsx | Toggle fast mode | `/fast on` |
| `/advisor [<model>\|off]` | local | Configure a second "advisor" model that critiques the main model | `/advisor gpt-5.5` |
| `/escalate plan\|run\|oracle\|policy "<task>"` | local | Run on a fast model, auto-escalate hard steps to an oracle model | `/escalate run "prove this lock-free queue is correct" --oracle gpt-5.5` |
| `/route <task>` (`/intent`) | local | Classify a task → recommend subagent + collaboration pattern | `/route "find why login 500s"` |
| `/login` / `/logout` | jsx | UR account sign-in/out (hidden for 3P-service users) | `/login` |
| `/upgrade` | jsx | Upgrade plan for higher limits | `/upgrade` |
| `/extra-usage` | jsx | Configure extra usage past plan limits | `/extra-usage` |
| `/rate-limit-options` | jsx | Options shown when rate-limited | `/rate-limit-options` |
| `/usage` | jsx | Show plan usage limits | `/usage` |
| `/cost` | local | Total cost + duration of the session | `/cost` |
| `/stats` | jsx | Usage statistics and activity | `/stats` |
| `/insights` | prompt | Generate a report analyzing your UR sessions | `/insights` |

## 4. Agents & multi-agent

| Command | Type | What it does | Example |
|---|---|---|---|
| `/agents` | jsx | Manage agent (subagent) configurations | `/agents` |
| `/agent-inspect` (`/inspect-agents`) | local | Per-subagent timeline: spawns, prompts, results, verdicts, tools, tokens | `/agent-inspect --file transcript.jsonl` |
| `/agent-task status\|diff\|pr` (`/task-pr`) | local | Task state, git diff status, PR handoff (`--create --draft --base`) | `/agent-task pr --create --base main` |
| `/agent-templates [list\|install]` | local | Install reusable project agent templates | `/agent-templates install reviewer` |
| `/agent-features [init]` (`/agent-roadmap`) | local | Show/initialize agent feature expansion scaffolds | `/agent-features --json` |
| `/agent-trends` (`/trends`) | local | UR coverage of current agent-tech trends | `/agent-trends` |
| `/bg run\|fanout\|list\|status\|logs\|attach\|kill` (`/background-agent`) | local | Detached local background agents; worktrees and PR creation are separate explicit options | `/bg run "upgrade eslint to v9" --worktree --pr` |
| `/crew create\|plan\|add\|run\|…` (`/crews`) | local | Lead agent splits a goal into a shared task board; workers claim and run tasks | `/crew create cleanup --goal "remove dead code" --workers 3 --worktrees` |
| `/arena "<task>"` (`/best-of`) | local | N agents attempt the same task in isolated worktrees; judge picks (optionally applies) the winner | `/arena "optimize image pipeline" --agents 3 --apply` |
| `/pattern [list\|show\|run\|install]` (`/patterns`) | local | Multi-agent collaboration patterns: PEER, DOE, concurrent, handoff, debate, parallel | `/pattern run debate "should we adopt tRPC?" --execute` |
| `/goal add\|list\|resume\|…` (`/goals`) | local | Long-horizon objectives persisting across sessions | `/goal add v2-launch --objective "ship v2" --workflow release` |
| `/task start\|run\|pr\|list\|status` | local | Worktree-per-task sessions with PR handoff | `/task start rate-limiter --worktree` |
| `/worktree list\|status\|clean` (`/worktrees`) | local | Manage agent worktrees | `/worktree clean` |
| `/role-mode list\|show\|install` (`/roles`) | local | Built-in role modes (Architect, Code, Debug, Ask) installed as scoped agents | `/role-mode install architect` |
| `/mode [code\|research\|debug\|browser\|image\|video\|data]` | local | Switch working mode | `/mode research` |

## 5. Automation, workflows & specs

| Command | Type | What it does | Example |
|---|---|---|---|
| `/workflow init\|list\|show\|validate\|graph\|plan\|run\|next\|done\|reset` (`/wf`) | local | Declarative agent workflows (steps with dependencies) | `/workflow run release --resume` |
| `/automation list\|create\|show\|run\|run-due\|enable\|disable\|delete` (`/automations`) | local | Project-local scheduled automations (cron), installable into launchd/systemd/cron | `/automation create nightly --schedule "0 3 * * *" --prompt "run tests and report"` |
| `/spec init\|generate\|approve\|next\|run\|verify\|…` (`/specs`) | local | Spec-driven development: requirements → design → tasks in `.ur/specs`, executed task-by-task with proof gates | `/spec init checkout --goal "one-click checkout"` |
| `/trigger parse\|run --file payload.json` (`/mention`) | local | Parse GitHub/Slack webhook payload → optionally launch a headless run | `/trigger run --file payload.json --source github --keyword /ur` |
| `/cloud run\|list\|show\|apply` | local | Detached best-of-N tasks: race N isolated agents, browse results, apply the winner | `/cloud run "speed up parser" --attempts 3` |
| `/recipe init\|list\|run` (`/recipes`) | local | Structured-output playbooks: child session must return schema-valid JSON (one repair round) | `/recipe run triage "login 500s"` |
| `/exec [prompts...]` | local | Non-interactive prompt runs with concurrency (`--file`, `--worktree`, `--max-turns`) | `/exec "fix lint errors" "update snapshots" --concurrency 2` |
| `/ci-loop` (`/heal`) | local | Run build/test command in an explicit cwd, fix failures, rerun until green or prove cannot-fix | `/ci-loop --command "bun test" --cwd ./packages/app --max-attempts 3` |
| `/test-first [run\|detect\|install]` (`/quality-loop`, `/tf-loop`) | local | Detect stack, run compile/test/lint loops, install edit-time verify gates | `/test-first run --max-attempts 3` |
| `/eval init\|run\|report\|compare\|route\|builtin\|leaderboard\|bench` (`/evals`) | local | Public eval harness incl. benchmark adapters | `/eval run my-suite --model llama3.3 --repeat 3 --format html` |
| `/sdk info\|init` (`/embed`) | local | Show headless/programmatic usage; scaffold TS/Python SDK examples | `/sdk init` |
| `/toolsmith <name> <python\|bash\|node\|go\|rust>` | local | Scaffold a local helper tool under `.ur/tools`, run via UR with approval | `/toolsmith csv-differ python` |
| `/skill list\|show\|run\|init` | local | Executable skill workflows | `/skill run deploy-checklist` |
| `/create-skill <name> [description]` (`/new-skill`) | local | Scaffold a new SKILL.md | `/create-skill release-notes "draft release notes" --project` |

## 6. Code quality & verification

| Command | Type | What it does | Example |
|---|---|---|---|
| `/review` | prompt | Review a pull request | `/review 128` |
| `/ultrareview` | prompt | Deep multi-pass review | `/ultrareview` |
| `/verify` | prompt | Spawn the verification subagent on current state | `/verify` |
| `/diff` | jsx | View uncommitted changes and per-turn diffs | `/diff` |
| `/pr-comments` | prompt | Fetch comments from a GitHub PR | `/pr-comments` |
| `/repo-edit index\|search\|rename\|move\|organize-imports\|unused\|callers` (`/reliable-edit`) | local | Indexed search, compiler-API rename, patch previews, rollback-safe apply | `/repo-edit rename getUser --to fetchUser --check "bun test"` |
| `/code-index build\|watch\|search\|status\|repo` (`/codeindex`) | local | Local semantic code index (embeddings via Ollama) | `/code-index search "retry with backoff"` |
| `/guardrails list\|init\|validate\|check` (`/guardrail`) | local | Declarative I/O guardrails: regex/contains/PII/LLM rules with tripwires | `/guardrails check "email me at x@y.z" --phase output` |
| `/claim-ledger add\|list\|validate` (`/claims`) | local | Claim-to-source provenance ledger | `/claim-ledger add --claim "p99 < 200ms" --source bench:latest` |
| `/artifacts list\|show\|serve\|add\|capture-diff\|capture-tests\|approve\|reject\|feedback\|delete` (`/artifact`) | local | Reviewable deliverables under `.ur/artifacts` with approval flow + local web viewer | `/artifacts capture-diff --title "auth refactor"` then `/artifacts serve --port 7777` |
| `/audit export\|verify` | local | Hash-chained audit trail (JSONL/CSV) with tamper verification | `/audit export --format csv --out audit.csv` |
| `/evidence [n]` | local | Stability evidence/action ledger | `/evidence 20` |
| `/actions [n]` | local | Recent stability action log | `/actions 10` |
| `/learn run\|stats\|apply` | local | Mine artifacts/CI outcomes into success-rate stats + reflective lessons that tune escalate/arena/model-route | `/learn run --reflect` |
| `/commit` | prompt (internal) | Create a git commit | `/commit` |
| `/commit-push-pr` | prompt (internal) | Commit, push, open PR | `/commit-push-pr` |

## 7. Security suite

| Command | Type | What it does | Example |
|---|---|---|---|
| `/security scan\|code\|secrets\|threat-model\|vuln\|scope\|status\|rules\|report` | local | Umbrella security toolkit | `/security secrets` |
| `/security-review` (`/secure-review`, `/sec-review`) | prompt | Audit code in an isolated worktree, fix low-risk issues, and report findings without publishing | `/security-review` |
| `/scope` | local | Define/approve an authorized security test scope | `/scope set local` |
| `/threat-model` | local | STRIDE/ATT&CK threat model | `/threat-model` |
| `/vuln` | local | Dependency vulnerability audit (OSV) | `/vuln` |
| `/ir` | local | Incident-response collection (read-only) | `/ir` |
| `/compliance` | local | OWASP / SSDF / CIS compliance mapping | `/compliance` |
| `/playbook` | local | Show/run a defensive security playbook | `/playbook` |
| `/harden` | local | System hardening checks (read-only) | `/harden` |
| `/kali` | local | Detect installed Kali/security tools (read-only) | `/kali` |
| `/lab` | local | Create a safe local security lab | `/lab` |
| `/safety status\|init\|check` (`/safety-policy`) | local | Project shell-safety policy (`.ur/safety-policy.json`); evaluate risky commands | `/safety check --command "rm -rf build"` |
| `/sandbox [status\|check\|init\|eval\|exclude]` | jsx | Interactive sandbox settings plus text status, dependency, policy, approval-level, and exclusion actions | `/sandbox eval "curl https://example.com"` |
| `/permissions` (`/allowed-tools`) | jsx | Manage allow/deny tool permission rules | `/permissions` |
| `/privacy-settings` | jsx | View/update privacy settings | `/privacy-settings` |

## 8. Research & analysis

| Command | Type | What it does | Example |
|---|---|---|---|
| `/research [note]` | local | Add/list research notes | `/research vector DBs comparison started` |
| `/paper [title or path]` | local | Add/list research papers | `/paper attention-is-all-you-need.pdf` |
| `/cite [citation]` | local | Add/list citations | `/cite Vaswani et al. 2017` |
| `/graph [entity] [text]` | local | Research graph of papers/claims/methods/datasets | `/graph claim "RoPE beats ALiBi at 128k"` |
| `/read <file>` | local | Read a text-like file into context | `/read notes/design.md` |
| `/summarize <file>` | local | Read a file for summarization | `/summarize RFC.md` |
| `/analyze <file>` | local | Read a file for analysis | `/analyze profiler-output.json` |
| `/search <query>` | local | Search workspace files for text | `/search "TODO(auth)"` |
| `/index` | local | Build a workspace file index (`.ur/index`) | `/index` |
| `/convert <file> <target>` | local | Convert a file format (dependency-aware) | `/convert report.md pdf` |
| `/pdf <file> [pages] [task]` | local | Deps-aware PDF text/metadata extraction (pdftotext) | `/pdf spec.pdf 2-7` |
| `/image <file> [task]` | local | Inspect an image (vision/OCR aware) | `/image screenshot.png "what error is shown?"` |
| `/video <file\|url> [task]` | local | Inspect video (ffmpeg/yt-dlp aware) | `/video demo.mp4 "summarize"` |
| `/youtube <url> [task]` | local | Fetch YouTube metadata/transcript | `/youtube https://youtu.be/… "key points"` |

## 9. Integrations

| Command | Type | What it does | Example |
|---|---|---|---|
| `/mcp [enable\|disable [server]]` | jsx | Manage MCP servers interactively | `/mcp` |
| `/plugin` (`/plugins`, `/marketplace`) | jsx | Manage installed and marketplace plugins | `/plugin` |
| `/reload-plugins` | local | Activate pending plugin changes in the current session | `/reload-plugins` |
| `/ide open\|status\|doctor\|config <editor>\|diff …` | jsx | IDE integrations, inline diff bundles | `/ide status` |
| `/acp serve\|stdio\|stop\|status` | local | Agent Communication Protocol server for IDE extensions | `/acp serve --port 9100` |
| `/a2a-card [base-url]` (`/agent-card`) | local | Print UR Card metadata for A2A discovery | `/a2a-card https://myhost:8765` |
| `/chrome` | jsx | UR-in-Chrome (browser extension) settings | `/chrome` |
| `/browser <url\|task>` | local | Browser pilot (Playwright if installed) | `/browser https://localhost:3000 "click login and screenshot"` |
| `/browser-qa list\|validate\|run` | local | Browser QA replay fixtures | `/browser-qa run login-flow` |
| `/install-github-app` | jsx | Set up UR GitHub Actions for a repo | `/install-github-app` |
| `/install-slack-app` | local | Install the UR Slack app | `/install-slack-app` |
| `/remote-control [name]` (`/rc`) | jsx | Connect terminal for remote-control (mobile/web) sessions | `/remote-control` |
| `/remote-env` | jsx | Default remote environment for teleport sessions | `/remote-env` |
| `/web-setup` | jsx | Set up UR on the web (GitHub account link) | `/web-setup` |
| `/devcontainer status\|init\|exec` (`/exec-target`) | local | Reproducible container execution target for commands and ci-loop | `/devcontainer exec -- npm test` |
| `/connect` | local | (see Models & providers) | — |

## 10. Project & environment info

| Command | Type | What it does | Example |
|---|---|---|---|
| `/project` | local | Project summary (workspace + DNA) | `/project` |
| `/workspace` | local | Workspace path, git, project DNA | `/workspace` |
| `/dna` | local | Detect language/package-manager/build/test/lint, save to `.ur` | `/dna` |
| `/os` | local | OS, shell, runtime, detected tools | `/os` |
| `/env` | internal | Environment dump (internal builds) | — |
| `/ur-init` | local | Generate the `.ur` asset folder (docs, superpowers, brainstorming, memory, prompts) | `/ur-init` |
| `/ur-doctor` | local | Full health check: OS, tools, Ollama, `.ur`, MCP, Playwright | `/ur-doctor` |
| `/doctor` | jsx | Diagnose installation and settings | `/doctor` |
| `/status` | jsx | Version, model, account, connectivity, tool statuses | `/status` |
| `/release-notes` | local | View changelog | `/release-notes` |

## 11. UI, terminal & input

| Command | Type | What it does | Example |
|---|---|---|---|
| `/config` (`/settings`) | jsx | Open the config panel | `/config` |
| `/theme` | jsx | Change color theme | `/theme` |
| `/color <color\|default>` | jsx | Prompt-bar color for this session | `/color magenta` |
| `/vim` | local | Toggle Vim editing mode | `/vim` |
| `/keybindings` | local | Open/create the keybindings file | `/keybindings` |
| `/terminal-setup` | jsx | Configure terminal (Shift+Enter etc.) | `/terminal-setup` |
| `/statusline` | prompt | Configure the status line | `/statusline show model and git branch` |
| `/output-style` | jsx | Deprecated → use `/config` | — |
| `/hooks` | jsx | View hook configurations | `/hooks` |
| `/help` | jsx | Help and available commands | `/help` |
| `/feedback [report]` (`/bug`) | jsx | Submit feedback | `/feedback` |
| `/plan [open\|description]` | jsx | Enter plan mode / view session plan | `/plan add caching layer` |
| `/passes` | jsx | Passes UI | `/passes` |
| `/tasks` (`/bashes`) | jsx | List/manage background tasks | `/tasks` |
| `/think-back` / `/thinkback-play` | jsx/local | Year-in-review animation | `/think-back` |
| `/voice` | local | Toggle voice mode (feature-gated) | `/voice` |
| `/heapdump` | local | Dump JS heap to ~/Desktop (debugging) | `/heapdump` |
| `/trace` | local | Inspect recent turns: roles, tool calls | `/trace` |

## 12. Stability & reliability

| Command | Type | What it does | Example |
|---|---|---|---|
| `/stability metrics\|firewall\|why <error>\|policy\|evidence\|actions\|cooldown` | local | Stability-aware MAPE-K controls and root-cause | `/stability why "ECONNRESET"` |
| `/actions`, `/evidence` | local | (see §6) | — |

## 13. Bundled skills (prompt commands shipped in the binary)

Registered in `src/skills/bundled/` at startup:

| Skill | What it does | Example |
|---|---|---|
| `/batch` | Research + plan a large change, then execute across 5–30 parallel local worktrees; asks before final integration tests and does not publish | `/batch migrate all API handlers to zod validation` |
| `/debug` / `/debug-v2` | Reproduce, root-cause, and fix a bug in an isolated worktree; ask before the full suite and keep publishing explicit | `/debug-v2 login 500s when password has emoji` |
| `/refactor` | Safe, test-backed refactor in a worktree; ask before the full suite and keep publishing explicit | `/refactor extract retry logic into a helper` |
| `/benchmark` | Add/run benchmarks in a worktree; optionally commit results | `/benchmark the JSON parser hot path` |
| `/dockerize` | Add Dockerfile, compose, health checks, and .dockerignore in a worktree; keep publishing explicit | `/dockerize` |
| `/security-review` | Audit code in a worktree, fix low-risk issues, and report findings without publishing | `/security-review` |
| `/latex-paper` (`/latex`) | Generate/compile a LaTeX paper with a build script; ask before final verification and keep publishing explicit | `/latex-paper systems paper skeleton` |
| `/paper-implementation` (`/implement-paper`) | Implement an algorithm/system from a paper or URL with tests and notes; keep publishing explicit | `/paper-implementation https://arxiv.org/abs/… ` |
| `/loop <interval> <prompt>` | Run a prompt/command on a recurring interval (default 10m) | `/loop 5m /ci-loop` |
| `/remember` | Review auto-memory; promote entries to UR.md/UR.local.md; detect stale/duplicates | `/remember` |
| `/simplify` | Review changed code for reuse/quality/efficiency, apply fixes | `/simplify` |
| `/skillify` | Turn the current workflow into a reusable skill | `/skillify` |
| `/update-config` | Configure settings.json/hooks via natural language | `/update-config allow npm commands without prompting` |
| `/keybindings-help` | Keybinding customization help | `/keybindings-help` |
| `/schedule` | Create/update/list scheduled remote agents (cron triggers) | `/schedule run tests every morning at 8` |
| `/ur-api` | Guidance for building apps on the UR API/SDK | `/ur-api` |
| `/ur-in-chrome` | Chrome-extension driving skill (auto-enabled when configured) | — |
| `/verify` | Verify a change end-to-end by running the app (internal gate) | `/verify` |
| `/lorem-ipsum <tokens>` | Filler text for context testing (internal) | `/lorem-ipsum 50000` |
| `/stuck` | Diagnose frozen/slow sessions (internal) | — |
| `/dream`, `/hunter`, `/run` | Feature-gated skills (KAIROS idle tasks, review artifact hunter, run-skill generator) | — |

## 14. Internal-only commands (`USER_TYPE=ant`, stripped from external builds)

`/backfill-sessions`, `/break-cache`, `/bughunter`, `/commit`, `/commit-push-pr`, `/ctx_viz`,
`/good-ur`, `/issue`, `/init-verifiers`, `/force-snip`, `/mock-limits`, `/bridge-kick`,
`/version`, `/ultraplan`, `/subscribe-pr`, `/reset-limits`, `/onboarding`, `/share`,
`/summary`, `/teleport`, `/ant-trace`, `/perf-issue`, `/env`, `/oauth-refresh`,
`/debug-tool-call`, `/autofix-pr`.

## 15. Feature-gated commands

Compiled in only when the corresponding `feature(...)` flag is on:
`/proactive`, `/brief`, `/assistant` (KAIROS) · `/remote-control` (BRIDGE_MODE) ·
`/voice` (VOICE_MODE) · `/workflows` (WORKFLOW_SCRIPTS) · `/web-setup` (CCR_REMOTE_SETUP) ·
`/peers` (UDS_INBOX) · `/fork` (FORK_SUBAGENT) · `/buddy` (BUDDY) · `/torch` (TORCH).

## 16. Custom command sources

Beyond built-ins, slash commands are loaded from (see doc 08 for formats):
- **Skills**: `.ur/skills/<name>/SKILL.md` (project) and `~/.ur/skills/` (user)
- **Plugins**: commands and skills contributed by installed plugins (`(plugin-name)` prefix in help)
- **Workflows**: each workflow in `.ur/workflows/` becomes a command (feature-gated)
- **MCP prompts**: MCP servers exposing prompts appear as commands (`MCP_SKILLS` gate for model-invocable)

Sources are resolved in the order shown by `src/commands.ts`. The first source
to claim a canonical token wins; later conflicting commands are omitted and
only conflicting aliases are removed from otherwise distinct commands.
