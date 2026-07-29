# 08 — Skills, Plugins & Workflows

Source of truth: `src/skills/`, `src/utils/plugins/`, `src/plugins/`,
`src/services/agents/{workflows,patterns}.ts`, `src/tools/WorkflowTool/`.

## Skills

Two skill formats coexist:

### 1. Prompt skills (SKILL.md)
Directory format `skill-name/SKILL.md` with Agent Skills-compatible YAML
frontmatter (`name`, `description`, optional `license`, `compatibility`,
`metadata`, `allowed-tools`). Loaded from:
- project: `.ur/skills/<name>/SKILL.md`
- user: `~/.ur/skills/<name>/SKILL.md`
- cross-client project/user: `.agents/skills/<name>/SKILL.md` and
  `~/.agents/skills/<name>/SKILL.md`
- plugins and MCP servers (MCP skills never execute embedded shell blocks)
- bundled skills compiled into the binary (`src/skills/bundled/`, list in doc 03 §13)

Resolution is deterministic: nearer project roots beat parent roots, project
beats user, and native `.ur` beats cross-client `.agents` at the same scope.

Body supports `${UR_SKILL_DIR}` (skill directory path) and `${UR_SESSION_ID}`
substitution, plus the exclamation-backtick inline form and
exclamation-labelled fenced shell blocks for any loaded non-MCP prompt skill.
Those commands still pass through the normal
shell-tool permission checks and the skill's `allowed-tools` rules. Remote MCP
skills never execute embedded shell; “local” here is not a cryptographic trust
claim.

```
/create-skill release-notes "draft release notes from git log" --project
# → .ur/skills/release-notes/SKILL.md, then invoke with:
/release-notes v2.1
```
`/skills` opens the prompt-skill browser; the model can also self-invoke prompt
skills through the `Skill` tool. `/skill` is intentionally separate and runs
the executable `skill.yaml` workflows below. Neither slash token aliases the
other.
`/skillify` (bundled) converts the current session's workflow into a skill.

For a file-backed `SKILL.md`, UR attempts to compute deterministic content-tree
and permission digests and validates names, directory identity, field
types/lengths, and metadata; signed skills cannot contain symlinks. Trust
commands:

```
ur skill verify <name-or-directory> [--require-trusted] [--json]
ur skill keygen <key-id> [--out <private-key.pem>]
ur skill sign <name-or-directory> --key <private-key.pem> --key-id <key-id>
```

Ed25519 manifests embed the public key and signed digests. Trusted keys live in
a private store (override its file with `UR_SKILL_TRUSTED_KEYS_FILE`). In the
default mode, provenance-inspection and Agent Skills validation failures are
logged and an otherwise readable skill may still load.
`UR_SKILLS_STRICT_SPEC=true` rejects invalid or uninspectable skills;
`UR_SKILLS_REQUIRE_TRUSTED_SIGNATURE=true` requires a verified trusted
signature at load. When provenance was successfully recorded, UR re-hashes the
file tree immediately before invocation to detect changes after discovery.
The corresponding `ur skill` trust flags are declared by the shipped CLI, not
only by the local command parser.

### 2. Executable skills (skill.yaml) — skills as workflows
`skill.yaml` is searched through the same project/user native and cross-client
skill roots (`.ur/skills` and `.agents/skills`).
`src/skills/skillSpec.ts` compiles it into a `WorkflowSpec`:

```yaml
version: 1
name: deploy-checklist
description: Gate a deploy behind checks
allowedTools: [Bash, Read]
steps:
  - id: tests
    name: Run tests
    agent: general-purpose
    prompt: Run the full test suite and report failures.
  - id: approve
    name: Human sign-off
    agent: general-purpose
    prompt: Summarize risk.
    dependsOn: [tests]
    gate: approval
    checkpoint: true
```
The directory may include `instructions.md`, `scripts/`, `templates/`, and
`checklists/` referenced via `${UR_SKILL_DIR}`. `allowedTools` is validated,
copied to every compiled workflow step, and passed to the child `ur -p` process
as its exact `--tools` pool; it is not merely descriptive metadata. Each
step's `agent` is also forwarded as `ur --agent <name>`, so the selected
built-in or project-defined agent governs that child session.

```
/skill list · /skill show deploy-checklist · /skill run deploy-checklist
/skill approve deploy-checklist approve
/skill run deploy-checklist --resume · /skill reset deploy-checklist
/skill init <name>
```

An approval-gated step is held before its model/tool execution. Approval is
accepted only for the currently held step, stored as a single-use token, and
consumed by `run --resume`. A run that fails, is blocked, or is held returns a
nonzero command status.

The `ur skill verify|sign|keygen` supply-chain commands above operate on
Agent Skills directories containing `SKILL.md`. Executable `skill.yaml`
workflows are parsed and schema-validated, but that execution path does not
currently require or verify the `SKILL.md` Ed25519 manifest. Do not treat
signing a neighboring prompt skill as a signature over `skill.yaml`.

All skill, plugin, workflow, and built-in invocation tokens pass through the
same registry normalizer. Earlier sources retain priority, duplicate canonical
tokens are omitted, and a later command loses only aliases already claimed by
another command.

## Workflows (`/workflow`, aliases `/wf`, `/workflows`)

Declarative, checkpointed DAGs of agent steps (`src/services/agents/workflows.ts`).
Each step: `id`, `name`, `agent` (subagent type), `prompt`, `dependsOn`,
optional `allowedTools`, `gate: approval|verification`,
`verificationMode: enforcing|advisory`, and `checkpoint: true`. Stored under
`.ur/workflows/`.

```
/workflow init release             # scaffold
/workflow validate release        # cycle/agent checks
/workflow graph release --ascii   # Mermaid or ASCII rendering
/workflow plan release            # topological dry-run
/workflow run release             # execute until completion, failure, or a gate hold
/workflow approve release step-id # approve the currently held approval step
/workflow run release --resume    # consume approval/resume persisted progress
/workflow next release            # show the next ready step
/workflow done release step-id    # manually complete an ungated step only
/workflow reset release
```

Progress and exact step outputs are persisted after every completed step for
crash recovery, within a 32 KiB per-step and 256 KiB per-run output budget.
Oversized outputs are not silently truncated: the completed step remains done
and is never replayed, while an output-dependent successor fails closed on
resume and tells the operator to reset for an intentional rerun. Legacy state
without captured outputs follows the same rule. Resumed completed steps are
reported as done with zero executions in the resumed run, not as skipped.
`checkpoint: true` additionally creates a semantic checkpoint record.
Parallel waves use all-settled accounting: if one branch fails, every sibling
that already ran is still recorded and successful siblings remain completed;
only dependent, unstarted steps are reported as skipped.
Verification gates require exactly one standalone non-error `VERDICT: PASS`
line; inline, missing, or multiple verdicts, `FAIL`, `PARTIAL`, and runner
errors fail closed unless that step explicitly
sets `verificationMode: advisory`. Non-completed CLI runs return nonzero.
The declared `agent` is passed to each child session through `--agent`; the
built-in `worker` alias falls back to `general-purpose`, while a project
definition named `worker` takes precedence.
Workflow execution is foreground in this build. Historical
`LocalWorkflowTask` records remain renderable, but no runtime constructor or
stop operation advertises them as live background tasks.

## Collaboration patterns (`/pattern`)

Prebuilt multi-agent topologies (`src/services/agents/patterns.ts`):
`peer` (plan-execute-express-review), `doe` (data-oriented ensemble), `concurrent`,
`handoff`, `debate`, `parallel`.

```
/pattern list
/pattern show peer
/pattern run debate "adopt tRPC or keep REST?" --execute
/pattern install peer --save     # materialize as an editable workflow
```

## Plugins

Plugin manifests + marketplaces (`src/utils/plugins/`, `.ur-plugin/marketplace.json`
format). Plugins can contribute: commands, skills, agents, hooks, MCP servers, output
styles.

```
ur plugin marketplace add github.com/acme/ur-plugins   # or a local path
ur plugin marketplace list / update / remove <name>
ur plugin install fmt@acme -s project     # scopes: user | project | local
ur plugin list --json --available
ur plugin enable fmt / disable fmt / disable -a
ur plugin update fmt
ur plugin validate ./my-plugin            # manifest validation
ur plugin doctor --path ./plugins         # diagnose
/plugin                                    # interactive Ink UI (alias /plugins, /marketplace)
/reload-plugins                            # activate pending changes in-session
ur --plugin-dir ./dev-plugin               # session-only plugin load
```
Settings: `enabledPlugins`, `pluginConfigs`, `extraKnownMarketplaces`,
`strictKnownMarketplaces`, `blockedMarketplaces`, `strictPluginOnlyCustomization`.

## Local helper tools (`/toolsmith`)

Scaffolds a small custom tool under `.ur/tools/<name>/` in python/bash/node/go/rust; UR
runs it with approval like any command:
```
/toolsmith csv-differ python
```

## Automations (`/automation`)

Project-local scheduled prompts (`.ur/automations/`), separate from skills:
```
/automation create nightly-tests --schedule "0 3 * * *" --prompt "run tests; open an issue on failure"
/automation run-due                      # execute anything due now
ur automation install --platform launchd --interval 300   # host scheduler integration
```
