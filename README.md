# UR-Nexus

<p align="center">
  <strong>Autonomous engineering workflow engine for reproducible software work.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ur-agent"><img alt="npm package" src="https://img.shields.io/npm/v/ur-agent.svg"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-non--commercial-blue.svg"></a>
  <a href="./QUALITY.md"><img alt="quality gate" src="https://img.shields.io/badge/quality-release%20gated-brightgreen.svg"></a>
</p>

UR-Nexus is a Bun and TypeScript autonomous engineering workflow engine: a
reproducible autonomous software engineering agent built for disciplined local
and CI-driven work. It is not only chat, autocomplete, or code edits: UR is
built to plan, execute, test, verify, document, benchmark, and reproduce
software work. It opens a stateful interactive terminal session by default, can
run one-shot prompts for scripts, and includes workflow commands for
specification-driven development,
multi-agent execution, test-first quality loops, CI repair loops, background
agents, MCP servers, plugins, skills, memory, permission safety policy,
project context packing, verification, and local model routing.

UR-Nexus integrates official model access paths only: subscription CLIs,
explicit API-key mode, and local OpenAI-compatible runtimes. It never scrapes
browser sessions, extracts OAuth tokens, or bypasses provider restrictions.

## Why UR

UR is built around the work that happens after a prompt: reading a repository,
editing files, running commands, validating the result, preserving context, and
handing work off to other tools or agents when needed.

- **Reproducible engineering loop.** Substantial tasks should move through
  `spec -> plan -> patch -> test -> report -> rollback`, with command evidence
  captured before success is claimed.
- **Terminal-native agent loop.** Run `ur` for an interactive coding session or
  `ur -p` for automation-friendly output.
- **Local model runtime.** Use any model exposed by Ollama, set a specific host
  with `--ollama-host`, or discover LAN Ollama servers with `--discover-ollama`.
- **Legal provider routing.** Use `ur provider`, `ur auth chatgpt`,
  `ur auth claude`, `ur auth gemini`, `ur auth antigravity`, and safe
  `ur config set ...` commands to select official subscription, API, or local
  providers without storing secrets in UR settings.
- **Agent workflows.** Use `ur spec`, `ur arena`, `ur agent-ci`, `ur cloud`,
  `ur workspace`, `ur test-first`, `ur ci-loop`, `ur bg`, `ur workflow`,
  `ur crew`, and `ur automation` for structured work beyond a single chat turn.
- **Reliable repo editing.** Use `ur repo-edit` for indexed search,
  compiler/graph change-impact maps, AST-aware rename plans, patch previews,
  and rollback-safe multi-file apply.
- **Evidence-backed research.** Use `ur research` to persist sanitized sources,
  cited findings, open questions, independent-corroboration checks, and
  reviewable Markdown reports instead of relying on an unstructured note list.
- **Professional 3D workflows.** Use `ur design3d` for scriptable Blender,
  OpenSCAD, Autodesk 3ds Max, and reviewed custom DCC/CAD app pipelines with
  real-world units, dry-run argv, bounded builds, format inspection, and glTF
  validation.
- **Permission and context control.** Use `ur safety` and `ur context-pack` to
  inspect command risk, initialize project safety policy, summarize repository
  architecture, and preserve task decisions, constraints, commands, diffs,
  architecture decisions, preferred commands, failed attempts, accepted patterns,
  rejected approaches, and citation freshness.
- **Lifecycle hooks.** Configure `BeforeEdit`, `AfterEdit`, `BeforeCommand`,
  `AfterCommand`, `BeforeCommit`, and `OnFailure` hooks in `.ur/hooks.json` or
  `UR.md` to run custom commands when the agent edits files, runs shell commands,
  commits, or hits a failure.
- **Verification and provenance.** Use `ur test-first`, the built-in verifier,
  `/verify`, `.ur/verify.json`, `ur artifacts`, `ur claim-ledger`, and `/trace`
  to make results easier to inspect.
- **Extensible tool surface.** Add MCP tools, plugin marketplace entries,
  executable skills, reusable templates, deterministic validators, language
  adapters, LSP servers, role modes, custom agents, IDE diff bundles, A2A
  endpoints, and local knowledge indexes.
- **Standards-current protocol runtime.** MCP client and server paths use the
  stable split TypeScript SDK v2 packages and negotiate the final 2026-07-28
  protocol while retaining only explicit, tested compatibility surfaces.

## Prompt Planning and Task Board

UR-Nexus decomposes `ur exec` prompts into executable task units before work
starts. Short prompts stay compact. Longer prompts are split into ordered small
tasks only when the wording, dependencies, or file targets make separate tasks
useful. Each task records id, order, title, description, status, dependencies,
assigned logical agent role, input, expected output, verification criteria, file
targets, risk level, and whether approval is required.

Inside the interactive agent, task tracking uses a strict-hybrid default:
atomic low-risk work stays direct, while multi-outcome, sequenced, planned,
delegated, project-sized, and high-risk lifecycle work must create a visible
task before the first mutation. Reads stay unrestricted. Configure the gate
with `tasks.requireBeforeChanges`; `enabled=false` makes it advisory and
`freeReads=0` requires a task before every mutation.

During real `ur exec` runs the task board streams when a task status changes,
then appears again in the final report. Quiet/non-interactive runs can suppress
streaming while preserving the final board. Public status labels are
action-oriented: queued, running, waiting approval, needs scope, needs context,
paused for review, skipped by policy, finished, and failed.

```text
[UR-Nexus Task Board]
Agents: 1 active / 3 max

1. queued           | executor | Update CLI branding
2. running          | executor | Update README references
3. waiting approval | verifier | Validate release archive

Progress: 0/3 finished, 1 running, 1 queued, 1 waiting, 0 failed, 0 skipped
```

Before a task runs, UR-Nexus checks that required files/resources exist and
that assumptions are explicit. Risky actions require explicit approval first:
destructive commands, outside-workspace writes/deletes, network or external
system actions, credential-sensitive access, exploit-like commands, and security
testing. The approval request records the action, reason, command or path when
available, and the approval decision in task evidence. Security-research prompts
need scoped targets and authorization confirmation; local/lab/test targets are
preferred unless the user confirms authorized external scope.

Reading source code does not attach a blanket modification refusal. UR evaluates
the actual behavior and requested intent, so ordinary games, websites, apps,
and developer tools can be analyzed and improved normally. Genuine malicious
or unauthorized activity remains subject to UR's security and operational
boundaries.

Authorized researchers can explicitly activate `/mode redteam`. The first use
shows a mandatory risk warning; `/mode redteam --accept-risk` acknowledges it
and enables UR's unrestricted security-research prompt policy for the current
session only. UR's scope, permissions, sandbox, approvals, and audit controls
remain enforced, and the selected model/provider keeps its own policies. The
bundled UR-native `reverse-skills` plugin is runtime-gated to this mode. See the
[Redteam Mode Guide](docs/REDTEAM.md).

Outside-workspace reads are allowed when requested or clearly required, and the
outside path is recorded in the task board/evidence. Modifying or deleting
outside-workspace files requires approval before execution.

After a task runs, verification compares the executor's claims with evidence
from workspace snapshots and observed command records. Strict verification
rejects unsupported file-change and command claims; non-strict verification
records them as warnings. Independent tasks can run through adaptive parallel
logical workers: simple prompts use one agent, medium prompts use two or three
when useful, and large independent graphs can use up to `maxAgents`. Tasks that
depend on another task or target the same file are serialized.

At the end of execution, `ur exec` reports task counts, the final ordered task
board, active/max agents used, finished/waiting/failed/skipped tasks, actual
changed files, outside-workspace files accessed or modified, verified commands,
unverified command claims, approval decisions, verification failures, warnings,
and remaining limitations. Command tracking is limited to commands surfaced by
the task runner; provider-internal or detached activity is reported as
unverified unless the executor exposes it as observed evidence. Use
`--no-task-planning` to keep the legacy direct prompt execution path for a run.

Planning defaults are safe and can be configured with:

```json
{
  "taskPlanning": true,
  "parallelAgents": true,
  "maxAgents": 3,
  "showTaskBoard": true,
  "strictVerification": true
}
```

## Quick Start

### Requirements

- Bun `>=1.3.0` (this repository pins `bun@1.3.14`). Bun is mandatory: every
  install path — npm, GitHub, or source checkout — runs the CLI through Bun,
  not Node. UR-Nexus is not Node-native.
- Node.js `>=22.12` to start the npm-installed launcher script
  (`bin/ur.js`), which immediately checks for Bun and re-execs into it. If Bun
  is missing, the launcher errors out instead of falling back to Node.
- `sharp` installs automatically as a native runtime dependency (image
  resizing for file reads, pasted images, and multimodal provider input).
- For the default local setup: a running Ollama app or server
  (`http://localhost:11434/api`). Any other supported provider (API key,
  OpenAI-compatible server, or subscription CLI) works without Ollama.
- Optional tools for specific workflows: GitHub CLI, tmux, and supported IDE
  integrations.

### Install

Remove old global installs first if needed:

```sh
npm uninstall -g ur-agent
bun remove -g ur-agent
```

Install the global `ur` command:

```sh
npm install -g ur-agent
ur --version
ur --help
```

Install directly from GitHub when you want this repository build:

```sh
bun add -g github:Maitham16/UR
ur --version
```

### Start A Session

```sh
ur
```

Run one prompt and exit:

```sh
ur -p "summarize this repository"
```

Return structured output for scripts:

```sh
ur -p --output-format json "list the main services in this codebase"
```

Resume previous work:

```sh
ur --continue
ur --resume
```

Check for npm updates:

```sh
ur upgrade
```

Source checkouts report:

```text
Development build detected. To update, pull latest source or install from npm.
```

Choose a model or Ollama host:

```sh
ur                              # first run opens provider/model selection
ur --model qwen2.5-coder:7b
ur --ollama-host http://192.168.1.50:11434
ur --discover-ollama
```

A fresh workspace never silently inherits a user-global or built-in model.
Interactive `ur` requires a provider/model choice and stores it in the
gitignored `.ur/settings.local.json`. Fresh print-mode runs require an explicit
`--model`, `OLLAMA_MODEL`, `UR_MODEL`, workspace setting, or managed setting.
For Ollama sessions, explicit environment precedence is `OLLAMA_MODEL`, then
`UR_MODEL`. Once selected, runtime requests use that provider backend; they do
not fall back to Ollama unless `ollama` is the selected provider.

### Legal Provider Auth

UR-Nexus stores only safe provider preferences: provider name, model name,
base URL, fallback preference, and non-secret settings. API keys stay out of
plaintext settings and are read from the OS keychain after `ur connect` or from
environment variables. API, local, and OpenAI-compatible server providers are
UR-native runtimes and behave like Ollama: UR owns the conversation loop, tool
loop, errors, and output.

The provider list shows the subscription CLIs (Codex CLI, Claude Code, Gemini
CLI, Antigravity) alongside the API and local/server providers, and they are
first-class: pick one in `/model` and it dispatches through the official CLI.
These are external app bridges — they run the vendor's own CLI using your
subscription — so you log in with `ur auth <provider>` (e.g. `ur auth chatgpt`,
`ur auth claude`). UR does not invent subscription models; each subscription
shows its curated model list. The generic `subscription` entry is an internal
placeholder and is hidden from the list.

```sh
ur provider list
ur provider status
ur provider doctor
ur provider models [provider] --json
ur config set provider ollama
ur config set provider openai-api
ur config set provider anthropic-api
ur config set provider gemini-api
ur config set provider openrouter
ur config set provider nvidia-nim
ur config set provider nvidia-special
ur config set provider unsloth
ur config set model qwen2.5-coder:7b
ur provider select-model ollama qwen2.5-coder:7b --json
ur config set base_url ollama http://localhost:11434
ur config set base_url llama.cpp http://localhost:9931/v1
ur config set provider.fallback ollama
ur config set openrouter.routing auto
ur config set openrouter.preferred_min_throughput 40
ur config set openrouter.preferred_max_latency 3
```

`provider.fallback` records a recovery provider for `ur provider doctor`
guidance. UR never switches providers automatically: inspect the failure and
select the recovery provider explicitly with `ur config set provider <id>`.

`base_url` belongs to the active provider when only a URL is supplied. Pass a
provider before the URL to configure it without switching first, for example
`ur config set base_url llama.cpp http://localhost:9931/v1`. UR remembers each
provider's address independently, so switching among Ollama, LM Studio,
llama.cpp, vLLM, Unsloth, NVIDIA Agentic, or another compatible endpoint restores that
provider's last URL automatically. Existing single-URL settings are migrated
to the previously active provider on the first provider switch or scoped
base-URL write.

OpenAI API traffic uses Chat Completions by default. The Responses transport is
an explicit, provider-scoped opt-in with privacy-conscious defaults:

```sh
ur config set provider openai-api
ur config set openai_transport responses
ur config set responses.store false
ur config set responses.compact_threshold 20000
ur config set responses.tool_search hosted
```

The Responses adapter supports semantic SSE streaming, background
create/retrieve/poll/cancel, WebSocket continuation, server compaction, and
deferred tool discovery. `store` defaults to `false`; the durable local cursor
store records identifiers and status only. Compacted context is persisted only
when `UR_OPENAI_RESPONSES_STATE_KEY` contains a 32-byte encryption key. Return
to the default with `ur config set openai_transport chat-completions`.

OpenRouter `auto` routing leaves tool turns to Auto Exacto and optimizes
non-tool turns for end-to-end throughput. The routing, fallback,
strict-parameter, rolling performance preference, service-tier, and supported
fast-mode controls are configurable; `priority` and `fast` are optional and may
cost more. Native `:nitro`, `:floor`, and `:exacto` model suffixes are accepted
and keep the base model's discovered context, output, tool, and reasoning
capabilities.

```sh
ur config set openrouter.routing auto          # auto | throughput | latency | price
ur config set openrouter.allow_fallbacks true    # true | false | auto
ur config set openrouter.require_parameters true # true | false | auto
ur config set openrouter.service_tier priority # auto | default | flex | priority | fast
ur config set openrouter.speed fast            # standard | fast
```

Direct Anthropic requests automatically preserve UR's prompt-cache
breakpoints and enable per-tool fine-grained input streaming, reducing repeat
prefill work and exposing large tool arguments as Claude generates them.
Anthropic's premium research-preview fast tier is opt-in and is sent only for
Claude Opus 5 or Opus 4.8:

```sh
ur config set anthropic.speed fast             # standard | fast
```

The account must have Anthropic fast-mode access. Unsupported Claude models
stay on standard speed instead of receiving a fabricated provider option.

Provider config accepts canonical IDs and common aliases. Examples:
`openai-api`, `anthropic-api`, `gemini-api`, `openrouter`, `nvidia-nim` (`NVIDIA Agentic`),
`nvidia-special` (`NVIDIA Special`), `ollama`,
`lmstudio`, `LM Studio`, `llama.cpp`, `vllm`, `unsloth` (`Unsloth Studio`), and the subscription CLIs
`codex-cli` (`chatgpt`), `claude-code-cli` (`claude`), `gemini-cli` (`gemini`),
and `antigravity-cli` (`agy`). Use quotes for shell values with spaces.

Connect accounts once with `ur connect` (or `/connect` in a session):

```sh
ur connect status                     # connection state for every provider
ur connect codex-cli                  # subscription: launches the official login
echo "$OPENAI_API_KEY" | ur connect openai-api   # API: store a key in the OS keychain
ur connect logout openai-api          # clear a stored key
```

| Provider | Access type | Runtime kind | Legal path |
| --- | --- | --- | --- |
| OpenAI API | API key | UR-native | `OPENAI_API_KEY` or `ur connect openai-api` |
| Claude API | API key | UR-native | `ANTHROPIC_API_KEY` or `ur connect anthropic-api` |
| Gemini API | API key | UR-native | `GEMINI_API_KEY` or `ur connect gemini-api` |
| OpenRouter | API/router | UR-native | `OPENROUTER_API_KEY` or `ur connect openrouter` |
| NVIDIA Agentic | hosted/server API | UR-native | `NVIDIA_API_KEY` or `ur connect nvidia-nim`; configurable `base_url` |
| NVIDIA Special | hosted/focused-task API | UR-native | the same `NVIDIA_API_KEY`; exact per-card HTTP/NVCF/gRPC inference contract |
| Ollama | local/server | UR-native | configurable local, LAN, or hosted endpoint; optional `OLLAMA_API_KEY` |
| LM Studio | local/server | UR-native | configurable endpoint; optional `LMSTUDIO_API_KEY` |
| llama.cpp | local/server | UR-native | configurable endpoint; optional `LLAMA_CPP_API_KEY` |
| vLLM | local/server | UR-native | configurable endpoint; optional `VLLM_API_KEY` |
| Unsloth | local/server | UR-native | authenticated user-run Unsloth Studio endpoint (`UNSLOTH_API_KEY`) |
| Codex CLI | subscription | external app bridge | official Codex CLI login (`ur auth chatgpt`) |
| Claude Code | subscription | external app bridge | official Claude Code login (`ur auth claude`) |
| Gemini CLI | subscription | external app bridge | official Gemini Code Assist login (`ur auth gemini`) |
| Antigravity | subscription | external app bridge | official Antigravity CLI login (`ur auth antigravity`) |

#### Provider-first model selection

In the interactive app, `/model` is a two-step, provider-first picker:

1. **Choose a provider.** Every provider is listed with its display name,
   internal ID, access type (`subscription`, `api`, `local`, `server`),
   credential type, and a live connection status (`connected`, `missing`,
   `unavailable`, `unknown`).
2. **Choose a model.** Only the selected provider's models are shown, labelled
   by source: `live` (discovered from the endpoint), `cache` (last discovery),
   `static` (predefined), or `unavailable` after a failed discovery with no
   fallback. Local/server providers (Ollama, LM Studio,
   llama.cpp, vLLM, Unsloth) and OpenAI-compatible endpoints are discovered live. Public
   NVIDIA Agentic discovery is generated from each current Build Free Endpoint
   card that explicitly advertises agent/tool use; NVIDIA's account `/v1/models`
   inventory does not narrow it, and a runtime entitlement error never removes a
   model. A configured enterprise/self-hosted NIM gateway continues to use that
   gateway's live `/models` response. API
   providers use live discovery from their `/models` endpoint once a key is
   connected (with a curated fallback list before that). Subscription CLIs show
   their curated model list because the official CLIs expose no models API. The
   generic `subscription` entry is an internal placeholder hidden from listings.

   NVIDIA is split into two provider entries. NVIDIA Agentic owns the ongoing
   tool-calling conversation. NVIDIA Special selects one focused task and never
   replaces that agent. The checked-in catalog is regenerated from all 100
   currently visible Build cards and preserves all 36 cards labelled Free
   Endpoint: 13 Agentic and 23 Special. Thirty-five publish executable
   inference contracts; the one card whose invocation protocol is unpublished
   remains visible and is labelled accordingly instead of being guessed or
   removed. Every row shows its purpose, accepted input, and produced output.
   Each executable Special model uses the URL, HTTP/RPC method, function ID,
   request schema, and response schema in that model's own inference reference.
   UR supports direct HTTP, model-specific NVCF invocation, NVIDIA Assets,
   asynchronous polling, and the five documented Maxine/Riva gRPC services;
   artifacts are written under `.ur/artifacts/nvidia/` unless a path is supplied.

   In the model catalog, use **Up/Down** to browse. For graded models, the effort row updates to
   the focused model's capability-backed selectors; use **Left/Right** to cycle
   only values UR can map to provider-native levels before pressing Enter. For
   models with thinking but no advertised graded ladder on runtimes with a native
   two-state mapping (currently Ollama, direct Anthropic, and NVIDIA Nemotron
   3.5 Lightning), Left selects off, Right selects on, and `t`
   toggles. The same state is available directly through `/thinking on|off`.
   Generic OpenAI-compatible runtimes never receive an invented boolean field.
   `ultra` is UR's visible
   beyond-high ceiling selector. It appears only when the provider/model
   advertises `ultra`, `max`, `xhigh`, or an explicit equivalent, and the row
   shows the exact mapping (for example, `ultra→max`). Models whose graded
   ladder tops out at `high`, plus models without an advertised beyond-high
   value, do not get Ultra. A generic
   `max` request resolves visibly to that model's highest supported non-Ultra tier
   (commonly `max`, `xhigh`, or `high`), and that resolved value is sent to the provider. llama.cpp models
   are checked lazily through their model-scoped `/props` capability while the
   cursor moves. Because current llama.cpp reports support but not the accepted
   level names, that flag alone does not create a graded selector. vLLM is
   checked lazily through `/server_info?config_format=json`; a configured
   reasoning parser enables its documented `none|low|medium|high` Chat
   Completions contract (`minimal→none`) without inventing Ultra. Ollama models
   are checked through `/api/show`; a generic `thinking` capability establishes
   thinking support but not a model-specific ladder, so UR uses Ollama's native
   on/off control unless the endpoint supplies exact levels.
   If `/effort max` or another graded request is used for such a model, UR
   enables thinking but reports that no graded level was sent.
   GPT-OSS uses its documented `low|medium|high` values, while any other graded
   values or Ultra aliases must be explicitly present in provider metadata.
   The resolved value is sent through Ollama's native `think` field. OpenRouter additionally
   shows compact model names, FREE/PAID tier, context size, tool/reasoning
   support, and the full untruncated ID immediately below the focused entry.
   Its endpoint-scoped catalog is reused for five minutes; Ctrl+R forces an
   immediate live refresh without substituting stale entries. Interactive
   tool turns preserve OpenRouter Auto Exacto so the router can combine live
   throughput with measured tool-call reliability; ordinary text turns prefer
   end-to-end throughput rather than time-to-first-token alone. UR reuses a
   stable session ID and provider-authored prompt-cache markers for warmer
   multi-turn streams. Configure the policy with `openrouter.routing`, or use
   the native `:nitro`, `:floor`, and `:exacto` model variants.
   API-key entry is masked, aligned on one row, and stored through the OS
   keychain flow.

   Selecting a disconnected local/server provider opens an endpoint field in
   `/model`; saving it continues directly to discovery and leaves every other
   provider's address untouched.

Model lists never cross providers: OpenAI API, Claude API, Gemini API,
OpenRouter, NVIDIA Agentic, NVIDIA Special, Ollama, and OpenAI-compatible local/server endpoints are separate
access paths. API keys, local runtimes, and subscription logins are not
interchangeable. The provider/model pair is validated before it is saved and
again before every request; changing provider clears an incompatible model.
`ur config set provider X` warns and clears an incompatible model, and
`ur config set model Y` is validated against the active provider. The
confirmation shows the selected provider, model, model source, and the runtime
backend that will receive the next request.

#### Runtime dispatch

The selected provider/model drives every agent request — the assistant's own
identity line in the system prompt reflects it too:

- **API** providers call each service in its native wire format — Anthropic
  `x-api-key` + `anthropic-version` on `/v1/messages`, OpenAI `Bearer` on
  `/v1/chat/completions` by default or `/v1/responses` when explicitly
  selected, Gemini `x-goog-api-key` on `:generateContent`, OpenRouter on its
  OpenAI-compatible chat endpoint, and NVIDIA Agentic models on their exact
  documented hosted chat endpoint or a user-selected compatible NIM gateway.
  NVIDIA Special uses each card's documented HTTP, direct NVCF, or gRPC
  endpoint with the same stored `NVIDIA_API_KEY`; asynchronous jobs are polled
  through NVIDIA's request ID until completion or user cancellation.
- **Local/server** providers call the configured endpoint (`/v1/chat/completions`
  for LM Studio/llama.cpp/vLLM/Unsloth; the native API for Ollama). Unsloth is
  provider-only: UR never starts, installs, updates, trains, or loads models in
  Unsloth. UR sends `enable_tools: false` so only UR's permissioned native tools
  can execute.
- **Subscription CLIs** (Codex, Claude Code, Gemini, Antigravity) are external
  app bridges: selecting one dispatches the turn through the vendor's official
  CLI using your subscription. Log in with `ur auth <provider>`. UR-native
  tool calling, UR-native streaming, UR Bash/File tool execution, and sandbox
  guarantees apply to UR-run tools and final UR output — not to what the
  external CLI does internally (see Provider Guide below).
- **Subscription** access does not list fake models. If no independent
  subscription backend is configured, `/model` marks it unavailable and asks you
  to choose a connected local, server, or API provider.

Image-bearing tool results use each UR-native provider's valid multimodal wire
shape. OpenAI Chat Completions, OpenRouter, NVIDIA Agentic, LM Studio, llama.cpp,
vLLM, Unsloth, and generic compatible endpoints keep the tool response textual and
place its image in the immediately following user turn; Gemini nests the image
parts in its function response; OpenAI Responses, Anthropic, and Ollama use their
native rich-result forms. The selected model must still support vision.
External subscription CLIs remain text-only because their official prompt
interfaces do not expose a portable binary-image channel.

Ollama is used only when Ollama is selected. There is no silent cross-provider
fallback: if dispatch fails, UR reports the selected provider, model, and runtime
backend. Use `ur provider status` (or `ur provider doctor <id>`) to inspect the
active provider, model, access type, and backend.

Security policy: UR-Nexus never scrapes browser sessions, extracts OAuth
tokens, bypasses subscription/quota/region/organization restrictions, proxies a
consumer web session as an API, or claims support for a provider unless the
official CLI/API path works. See [Provider Guide](docs/providers.md).

## Command Surface

Run `ur --help` for the complete CLI reference. These commands are implemented
as first-class subcommands in the shipped CLI.

| Command | Purpose |
| --- | --- |
| `ur` | Start an interactive terminal agent session in the current workspace. |
| `ur -p` | Run a non-interactive prompt with text, JSON, or stream-JSON output. |
| `ur spec` | Default spec-first workflow: create requirements, design, and task documents under `.ur/specs/`, run the task list, and verify with strict proof gates. |
| `ur escalate` | Plan or run work with fast and oracle model tiers selected from local model capabilities. |
| `ur arena` | Run verified best-of-N candidates in isolated worktrees with deterministic, model, or hybrid judging. |
| `ur agent-ci` | Run a policy-gated agent in an isolated CI worktree and emit bounded, hash-addressed review artifacts. |
| `ur ci-loop` | Run a build or test command in an explicit working directory, hand failures to a fix agent, and retry with a bounded budget. |
| `ur test-first` | Detect the project stack, run compile/test/lint commands, store failure traces, and install edit-time verify gates. |
| `ur safety` | Inspect or initialize project shell safety policy and evaluate command risk before execution. |
| `ur sandbox` | Inspect and manage the sandbox/permission architecture: status, dependency check, policy init, and command approval levels. |
| `ur context-pack` | Write project architecture context and citation-validated, tamper-evident task memory; search, revalidate, quarantine, or roll back the chain. |
| `/hooks` | Inspect lifecycle hooks (`BeforeEdit`, `AfterEdit`, `BeforeCommand`, `AfterCommand`, `BeforeCommit`, `OnFailure`) configured via settings files. |
| `ur bg` | Run, inspect, cancel, and idempotently steer detached local background agents with optional worktrees and PR creation. |
| `ur cloud` | Run verified local best-of-N workers or managed candidates with lifecycle reconciliation, safe-branch eligibility, steering, and cancellation. |
| `ur workspace` | Coordinate dependency-aware tasks across isolated worktrees in multiple repositories and generate explicit PR/rollback plans. |
| `ur learn playbooks` | Mine verified outcomes into candidates, explicitly approve them as workflows, and run or disable them. |
| `/btw` | Create, continue, inspect, rename, or close a private durable tool-free side chat while the main task continues. |
| `ur worktree` | List, inspect, and clean up UR agent worktrees. |
| `ur task` | Start, run, and hand off worktree-per-task sessions with optional PR creation. |
| `ur automation` | Store and run project-local scheduled automation specs under `.ur/automations/`. |
| `ur workflow` | Define, validate, graph, run, and resume declarative agent workflows. |
| `ur crew` | Run dependency-aware worker subagents over a shared task board; independent tasks fan out, while bounded retries require isolated worktrees. |
| `ur pattern` | Run multi-agent collaboration patterns (PEER, DOE, concurrent, handoff, debate, parallel); `--execute` runs them as a workflow. |
| `ur goal` | Track long-horizon objectives that persist across sessions. |
| `ur repo-edit` | Build a repo edit index, map symbol/file blast radius and verification targets, plan AST-aware edits, preview patches, and apply with rollback. |
| `ur research` | Create source-backed research workspaces, add cited findings/open questions, verify corroboration, and emit Markdown reports. |
| `ur design3d` | Discover 3D apps and create, plan, build, inspect, or validate Blender, OpenSCAD, 3ds Max, and custom DCC/CAD projects. |
| `ur code-index` | Build, query, or watch a local semantic code index using Ollama embeddings; `ur code-index repo` adds files/symbols/calls/tests/docs/configs. |
| `ur semantic-memory` | Build and search a project-local memory index. |
| `ur memory retention` | Configure and apply local memory retention policies (TTL, max entries, decay). |
| `ur knowledge` | Manage a curated project knowledge base with provenance. |
| `ur artifacts` | Capture diffs, test runs, notes, and review feedback under `.ur/artifacts/`; `serve` opens a local web page per artifact ID. |
| `ur claim-ledger` | Map generated claims to file, web, MCP, tool, or user sources. |
| `ur browser-qa` | Validate and smoke-run browser QA replay fixtures. |
| `ur desktop-qa` | Validate and run bounded Electron QA fixtures with teardown, masked screenshots, and optional raw video/trace only when selector redaction is disabled. |
| `ur eval run` | Run isolated eval cases and grade outputs plus redacted tool trajectories; optionally capture cost/tokens/files/test metrics. |
| `ur eval gate` | Enforce pass-rate, trajectory, test, cost, duration, and baseline-regression thresholds in CI. |
| `ur eval report` | Show a saved eval report; `--dashboard` writes a single-suite HTML timeline. |
| `ur eval dashboard` | Generate the local-first HTML dashboard across all saved reports. |
| `ur eval bench` | Import local SWE-bench, Terminal-Bench, or Aider Polyglot exports. |
| `ur model-doctor` | Inspect Ollama models and report likely agent capabilities. |
| `ur model-route` | Recommend a local model for a task by capability fit. |
| `ur route` | Classify a task and recommend the best subagent and collaboration pattern. |
| `ur local-first` | Show readiness for no-cloud, private, lab, offline, and edge/server environments. |
| `ur provider` | List, check, and diagnose legal model provider adapters. |
| `ur connect` | Connect a provider account: subscription login or store an API key in the OS keychain. |
| `ur auth chatgpt` | Launch the official Codex CLI login for ChatGPT subscription access. |
| `ur auth claude` | Launch the official Claude Code login flow. |
| `ur auth gemini` | Use the official Gemini CLI login flow where supported. |
| `ur auth antigravity` | Use the official Antigravity CLI login flow where supported. |
| `ur config set|get|list` | Set or inspect validated non-secret agent, accessibility, editor, and provider settings. |
| `ur mcp` | Configure Model Context Protocol servers, expose fail-closed built-in tools over standard input/output, or run the secure stateless web server with Tasks and Apps. |
| `ur skill` | Initialize, run, strictly verify, Ed25519-sign, and create trusted signing keys for portable skills. |
| `ur ag-ui serve` | Start the secure AG-UI HTTP/SSE adapter for user-facing applications with truthful capability discovery. |
| `ur plugin` | Install, update, enable, disable, and validate UR plugins that can add MCP tools, skills, templates, validators, language adapters, LSP servers, agents, hooks, output styles, and commands. |
| `ur role-mode` | Install built-in Architect, Code, Debug, and Ask role modes. |
| `ur acp` | Connect editors through the Agent Client Protocol, or manage the separate UR HTTP JSON-RPC server. |
| `ur exec` | Run one or more prompts in non-interactive mode with optional concurrency. |
| `ur ide diff` | Capture editor-readable inline diff bundles. |
| `ur a2a card` | Print legacy Agent-to-Agent discovery metadata; add `--v1` to preview the current A2A 1.0 card. |
| `ur a2a serve` | Start the negotiated Agent-to-Agent server with automatic client compatibility. |
| `ur sdk` | Show programmatic headless usage and scaffold SDK examples. |
| `ur trigger` | Parse a GitHub/Slack webhook payload and optionally launch a headless UR run. |
| `ur agent-templates` | List or install reusable project agent templates. |
| `ur agent-task` | Summarize task state, git diff status, and PR handoff commands. |
| `ur agent-inspect` | Reconstruct a per-subagent timeline from a session transcript. |
| `ur agent-features` | Show or initialize agent feature expansion scaffolds. |
| `ur agent-trends` | Show UR coverage for current agent technology trends. |
| `ur agents` | List configured agents. |
| `ur doctor` | Check the health of the UR installation and auto-updater. |
| `ur update` | Check npm for UR-Nexus updates (`ur upgrade` is an alias). |

### Status Bar

Interactive sessions show a compact bottom status bar when the terminal supports
it. It is hidden in CI, dumb terminals, non-interactive mode, and assistant
viewer mode.

Example:

```text
Ollama | llama3 | ask | main
```

The bar reflects the active in-session provider/model immediately after a
`/model`, `/model <model>`, or `/provider` change — it does not wait for
persisted settings to reload. If a custom status-line hook is configured,
UR-Nexus uses that hook output instead of the built-in bar.

### IDE Integration

The professional UR IDE integration is the **UR Inline Diffs** VS Code
extension: a chat panel, inline diff review, an actions panel, an agent
status card, a searchable command palette, and an agent options panel for VS
Code, Cursor, and Windsurf. It is bundled inside this repository and
packaged as a local VSIX when installed from UR-Nexus; the public install
path does not depend on an unpublished marketplace extension ID. The
extension never talks to a model provider or network service directly —
every AI request goes through your local `ur` CLI, same as in a terminal.

`ur ide diff` captures review bundles under `.ur/ide/diffs/` so editors can
show agent diffs without scraping terminal output:

```sh
ur ide diff capture --title "Parser fix"
ur ide diff list
ur ide diff show <id>
```

In the **Inline Diffs** / **Actions** views you can preview a bundle,
**Apply** it (a confirmed `git apply`, recorded through `ur ide diff
approve` — never a silent write or an out-of-vocabulary status), **Reject**
it, or run **UR: Agent Status**. Chat, editor actions (Explain/Fix/Generate
Tests), diff review, and the verifier all route through the same CLI
contract — see the [IDE Guide](docs/IDE.md) for the full feature list.

Inspect and configure integration per editor:

```sh
ur ide status               # workspace, UR HTTP server, provider/model, sandbox/verifier mode, plugin count
ur ide doctor               # pass/warn/fail checks; reports missing config clearly
ur ide config zed           # print the .zed/settings.json ACP block
ur ide config vscode        # VS Code / Cursor / Windsurf setup
```

VS Code, Cursor, and Windsurf connect through the UR Inline Diffs extension;
Zed and ACP-capable Neovim clients connect through the stdio Agent Client
Protocol. The experimental bundled JetBrains plugin under
`extensions/jetbrains-ur` uses project-scoped JSON-RPC sessions over the
loopback UR HTTP compatibility endpoint and is installable from its Gradle `buildPlugin`
zip. Start an ACP surface with:

```sh
ur acp stdio                        # stdio ACP agent for editors (Zed, Neovim)
ur acp serve --port 8123 [--debug]  # HTTP JSON-RPC server for scripts/clients (not the VS Code chat transport)
ur acp status
```

See the [IDE Guide](docs/IDE.md) and [ACP Guide](docs/ACP.md) for per-editor
setup, supported features, and limitations.

New slash skills run agentic work in isolated git worktrees and leave changes
local for review. They ask before the final full verification suite and do not
commit, push, or create PRs unless explicitly requested:
`/fix-bug`, `/refactor`, `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, `/latex-paper`.
Install matching agent templates with `ur agent-templates install`.

New built-in tools (exposed through MCP and the UR HTTP compatibility API): GitHub, API, Browser, Docker, TestRunner, Database. Browser can discover and invoke permission-gated imperative WebMCP tools registered by the active site; site schemas and results remain bounded, untrusted content. File-system and terminal tools are already built in (FileRead, FileEdit, FileWrite, Glob, Grep, Bash, PowerShell).

### Plugin Marketplace

UR plugins are trusted local extension bundles. A marketplace entry can install
commands, MCP tools, executable skills, reusable templates, deterministic
validators, language adapters, LSP server metadata, agents, hooks, and output
styles. The bundled `engineering-discipline` reference plugin demonstrates the
full extension contract with a `/discipline-check` command, a
`reproducible-release` skill, a release-verifier template, a release-gate
validator, and Markdown language-adapter metadata.

```sh
ur plugin list
ur plugin marketplace add npm:@acme/ur-marketplace@latest
ur plugin search git
ur plugin search --capability skills --json
ur plugin show github@ur-plugins-official
ur plugin doctor
ur plugin install engineering-discipline@ur-plugins-official
ur plugin install reverse-skills@ur-plugins-official
ur plugin install hello@ur-plugins-official
ur plugin update <plugin>
ur plugin disable <plugin>
```

`ur plugin search` discovers plugins across managed, personal, workspace,
implicit, built-in, and session catalogs. Results use deterministic relevance
ranking, show catalog/source provenance and installation state, support
capability/marketplace/installed filters, and remain available as structured
JSON for scripts. `ur plugin show` prints one plugin's complete discovery
metadata and an exact install command. `ur plugin doctor` validates every
installed, project, and bundled plugin manifest and reports its declared
components and capability surface, so you can review what a plugin touches
before enabling it.

Marketplace catalogs can come from GitHub/Git, direct URLs, npm packages,
local files/directories, or inline settings. npm sources use
`npm:<package>[@<version-range-or-dist-tag>]`, respect the user's npm registry
and authentication configuration, and must ship `.ur-plugin/marketplace.json`.
See the [Plugin Guide](docs/plugins.md) for private-registry configuration and
refresh behavior.

The npm package includes `README.md`, `QUALITY.md`, `docs/`, `documentation/`,
and `plugins/`, so the npm package page and installed artifact both carry the
marketplace documentation, core plugins, community staging directory, and
example plugin template. See [Plugin Guide](docs/plugins.md).

UR also documents the core Cursor-style agent primitives as first-class,
project-backed features: Agent surfaces (`ur`, `ur agents`, `ur crew`, `ur bg`),
Rules (`AGENTS.md`, `UR.md`, `.cursor/rules/*.mdc`, `.cursorrules`, safety and
guardrail config), MCP (`ur mcp`, `.mcp.json`, plugin MCP servers), Skills
(`/skills`, bundled, project, user, and plugin skills), CLI (`ur --help`, `ur -p`,
`ur exec`, `ur acp`), and Models (`/model`, `ur config set model`,
`ur model-doctor`, Ollama routing and discovery).

Examples:

```sh
ur spec init checkout --goal "1. add cart 2. add payment 3. add receipt"
ur spec run checkout --all --dry-run
ur spec run checkout --all --kernel
ur spec verify checkout --kernel
ur crew create parser-crew --goal "fix the flaky parser test" --decompose --dry-run
ur crew plan parser-crew --goal "fix the flaky parser test" --decompose
ur crew run parser-crew --workers 3 --decompose --dry-run
ur crew run parser-crew --workers 3 --worktrees --max-attempts 2
ur pattern parallel "refactor login without changing behavior" --execute --dry-run
ur arena "implement a debounce helper" --agents 3 --judge hybrid --verify "bun test"
ur agent-ci init default
ur agent-ci validate default
ur cloud run "fix the parser race" --runner managed --attempts 3
ur cloud steer <task-id> --message "preserve the public API" --request-id review-1
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first detect
ur test-first --dry-run
ur test-first install
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack remember --architecture "Repository pattern for data access" --status accepted --rationale "Testability"
ur context-pack remember --preference "Use bun test over jest"
ur context-pack remember --accepted "Use p-map for bounded concurrency" --scope project
ur context-pack remember --rejected "Switch to esbuild" --alternative-to "Keep bun bundle"
ur context-pack remember --attempt "Tried Deno runtime" --status superseded
ur context-pack remember --decision "Keep streaming" --cite-file src/parser.ts --lines 20:48
ur context-pack memory revalidate
ur context-pack memory search --query "streaming"
ur context-pack memory verify
ur context-pack memory quarantine
ur context-pack memory rollback --to <entry-id>
ur context-pack compress
ur ci-loop --command "bun test" --cwd . --max-attempts 3 --dry-run
ur bg run "fix the flaky parser test" --worktree --dry-run
ur learn playbooks mine --min-runs 3
ur workspace init checkout
ur desktop-qa validate .ur/desktop-qa/fixtures/smoke.json
ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
ur repo-edit impact checkoutTotal --depth 5
ur research init agent-landscape --question "Which capabilities shipped in 2026?"
ur research source agent-landscape --url https://example.com/spec --title "Primary specification"
ur research finding agent-landscape --text "The feature shipped." --cite S1,S2 --confidence high
ur research verify agent-landscape
ur research report agent-landscape --out docs/research/agent-landscape.md
ur design3d doctor
ur design3d init product-shot --engine blender --units mm --format glb
ur design3d init studio-scene --engine 3dsmax --units cm --format max
ur design3d build design3d/product-shot --dry-run
ur design3d validate design3d/product-shot
ur code-index search "where is the rate limiter configured"
ur code-index repo build
ur code-index repo search "rate limiter"
ur skill init security-review
ur skill run security-review "src/auth.ts"
ur skill verify security-review --require-trusted
ur skill keygen release --out ~/.ur/keys/release.pem
ur skill sign security-review --key ~/.ur/keys/release.pem --key-id release
UR_MCP_HTTP_TOKEN='<secret>' ur mcp serve-web --port 8976
ur artifacts capture-tests --command "bun test"
ur artifacts serve --port 4180
ur agent-task pr --create --dry-run
ur acp serve --port 8123
ur exec "add tests for the parser" --concurrency 4 --json
ur eval run starter --metrics --json
ur eval gate starter --min-pass-rate 1 --min-trajectory-score 0.9
ur eval report starter --dashboard
ur eval dashboard
```

## Project Context

UR reads repository instructions and local runtime state from project files:

- `AGENTS.md` and `UR.md` provide shared project instructions.
- `UR.local.md` is for private local instructions.
- `.ur/skills/` stores native project skills; `.agents/skills/` is the
  cross-client Agent Skills location. User equivalents live under `~/.ur/skills/`
  and `~/.agents/skills/`, with deterministic project/native precedence.
- `.ur/agents/` stores custom agents and role modes.
- `.ur/safety-policy.json` configures project shell safety rules for read,
  write, execute, and network command classes.
- `.ur/project-manifest.json` and `.ur/context/` hold architecture summaries,
  task memory, compressed context, and project memory including architecture
  decisions, preferred commands, failed attempts, accepted patterns, and
  rejected approaches. Task-memory v2 entries include provenance, source
  citations, freshness validation, and an integrity chain; corrupt tails can
  be quarantined without discarding the verified prefix.
- `.ur/specs/`, `.ur/artifacts/`, `.ur/automations/`, `.ur/test-first/`,
  `.ur/memory/`, `.ur/index/`, `.ur/agentic-ci/`, `.ur/workspaces/`, and
  `.ur/desktop-qa/` hold workflow state, review artifacts, scheduled jobs,
  failure traces, memory, indexes, isolated automation state, and QA evidence.

Commit only shared project assets that are safe for teammates. Keep local
settings, generated indexes, memory, logs, and secrets out of Git.

## Architecture

- `bin/ur.js` is the global launcher, invoked via Node's shebang. It always
  executes the CLI through Bun — `bun dist/cli.js` when the bundle is present,
  otherwise `bun run` against the TypeScript entrypoint — and exits with an
  install error if Bun is not found. Node never runs the CLI itself.
- `src/entrypoints/cli.tsx` handles fast startup paths such as `--version`,
  A2A serving, background sessions, bridge mode, and daemon paths before loading
  the full CLI.
- `src/main.tsx` defines the top-level flags and subcommands.
- `src/commands.ts` and `src/commands/` register slash commands and local CLI
  command modules.
- `src/tools/` contains tool implementations for file editing, shell execution,
  MCP resources, task management, and agent delegation.
- `src/services/` contains runtime services for MCP, verification, memory,
  code indexing, safety policy, context manifests, model routing, background
  agents, A2A, analytics, sync, and API integration.
- `extensions/vscode-ur-inline-diffs/` contains the professional VS Code IDE
  extension (chat, streaming, inline diff review, actions panel, status
  card, search, and agent options) for VS Code, Cursor, and Windsurf.
- `plugins/core/` contains first-party marketplace plugins.
- `plugins/community/` stages contributed plugins.
- `plugins/examples/` contains plugin templates users can copy.

## OpenTelemetry

Telemetry export is off unless an operator explicitly configures a signal:

```sh
OTEL_TRACES_EXPORTER=otlp \
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
ur
```

UR emits bounded OpenTelemetry GenAI inference, agent, workflow, tool, and
memory spans plus duration, token, streaming time-to-first-chunk, and
inter-output-chunk latency metrics. Raw prompts, system instructions, tool
arguments/results, and memory records are omitted by default; set
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` only inside an
appropriately secured telemetry environment. `OTEL_SDK_DISABLED=true` is the
global kill switch.

## Safety Model

UR can read files, edit code, execute commands, and call configured tools, so
the permission boundary matters.

- Sensitive tool actions go through permission checks by default.
- `--allowed-tools` and `--disallowed-tools` can scope tool access for
  automation.
- `permissions.defaultMode: "autoApprove"` auto-approves operations that would
  otherwise pause for permission approval, while user-input dialogs still ask.
- `--dangerously-skip-permissions` should only be used inside disposable
  sandboxes.
- The verifier checks for false completion claims, immediate-action promises
  that end without the matching tool call, repeated tool-call loops, empty
  assistant turns, and project gates.
- Project gates can be configured in `.ur/verify.json`.
- `ur test-first install` writes detected compile/test/lint commands into
  `.ur/verify.json` so mutating turns have command evidence before completion.
- `ur safety check --command "<cmd>"` classifies read, write, execute, and
  network permissions, asks before destructive commands, recommends sandboxing
  for risky operations, and blocks common secret exfiltration paths.
- `ur safety init` writes `.ur/safety-policy.json` for project-specific safety
  rules.
- `ur context-pack scan` writes a repo architecture manifest from package
  scripts, instruction files, `.ur/verify.json`, and safety config.
- Auto-memory and automatic learning are enabled by default. Auto-memory can be
  disabled with `autoMemoryEnabled: false`; automatic learning can be disabled
  with `automaticLearningEnabled: false`. The automatic learning path writes
  local JSON stats only and uses no model tokens.
- The deep verification subagent is available through `/verify` and can be
  auto-enabled with `UR_VERIFIER_AUTO_SUBAGENT=1`.
- UR enforces permission and sandbox policy before running UR Bash/File
  tools, not after. Sandbox mode is `disabled` (default), `recommended`
  (`sandbox.enabled: true`, best-effort), or `required`
  (`sandbox.enabled: true` + `sandbox.failIfUnavailable: true`) — `required`
  fails closed and refuses to start if OS sandbox support is unavailable.
  OS confinement uses `sandbox-exec` (Seatbelt) on macOS and `bwrap`
  (bubblewrap) on Linux/WSL2; see `ur sandbox status` for the active policy.
- This sandbox wraps UR-run Bash/File tool commands only. It does not extend
  to actions a subscription CLI provider performs internally — see
  [Provider Guide](docs/providers.md).
- MCP servers can access external services; only enable servers you trust.

See [Frontier Agent Workflows](docs/FRONTIER_AGENT_FEATURES.md),
[Configuration](docs/CONFIGURATION.md), [Validation](docs/VALIDATION.md), and
[Quality Notes](QUALITY.md) for operational guidance.

## Troubleshooting

Common problems — `ur` not found after install, a provider that is selected
but not connected, a model that belongs to another provider, unreachable local
servers, plugin or editor connection issues — are covered with symptom, cause,
fix, and a verification command in the
[Troubleshooting Guide](docs/TROUBLESHOOTING.md). Start with:

```sh
ur --version
ur provider status
ur provider doctor
```

## Development

Install dependencies:

```sh
bun install
```

Run from source:

```sh
bun run start
bun run dev
```

Build and verify a release:

```sh
bun run typecheck
bun run lint
bun test
bun run build
bun run smoke
bun run secrets:scan
bun run release:check
bun run package:check
npm pack --dry-run
npm publish --dry-run
bun run release:tag                 # read-only committed/pushed preflight
bun run release:tag -- --push       # immutable tag; CI publishes the artifact
```

`dist/cli.js` is intentionally tracked because GitHub installs use the bundled
CLI. Rebuild it after source, version, or macro changes.

The GitHub workflow runs production bundle, smoke, release, package, and global
install checks only after the Bun test step succeeds. Do not publish or tag a
release until that GitHub run is green.

## Package

- npm package: [`ur-agent`](https://www.npmjs.com/package/ur-agent), binary `ur`.
- The package name remains `ur-agent` for compatibility with existing installs
  and legacy `ur-agent` configs. User-facing branding is `UR-Nexus`; the global
  command remains `ur`. A future package rename would use `ur-nexus`.
- The published package ships the bundled CLI (`dist/cli.js`), launcher
  (`bin/ur.js`), documentation (`docs/`, `documentation/`, `examples/`), and
  first-party plugins (`plugins/`, `.ur-plugin` marketplace manifest is part of
  the repository).
- Releases follow the [Release Runbook](RELEASE.md); every release is recorded
  in [CHANGELOG.md](CHANGELOG.md).

## Documentation

- [Usage Guide](docs/USAGE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Provider Guide](docs/providers.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Agent Feature Expansion](docs/AGENT_FEATURES.md)
- [Agent Trend Coverage](docs/AGENT_TRENDS.md)
- [Changelog](CHANGELOG.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [IDE Guide](docs/IDE.md)
- [ACP Guide](docs/ACP.md)
- [A2A Guide](docs/A2A.md)
- [AG-UI Guide](docs/AG_UI.md)
- [Plugin Guide](docs/plugins.md)
- [Validation Runbook](docs/VALIDATION.md)
- [Release Runbook](RELEASE.md)
- [Quality Notes](QUALITY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Static Documentation Site](documentation/index.html)

The `examples/` directory includes prompt and workflow examples for coding,
research, browser, image, video, MCP, memory, and agent-platform tasks.

## License

UR-Nexus is released under the
[UR-Nexus Non-Commercial Self-Responsibility License](LICENSE).

Personal, educational, research, evaluation, and other non-commercial use is
permitted. Commercial use requires prior written permission from Maitham
Al-rubaye.

The software is provided as-is. Users are responsible for how they configure
UR, what tools it can access, and any outputs, commands, files, network
requests, integrations, or decisions created with it.

Designed by Maitham Al-rubaye.
