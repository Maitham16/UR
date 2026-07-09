# 08 — Skills, Plugins & Workflows

Source of truth: `src/skills/`, `src/utils/plugins/`, `src/plugins/`,
`src/services/agents/{workflows,patterns}.ts`, `src/tools/WorkflowTool/`.

## Skills

Two skill formats coexist:

### 1. Prompt skills (SKILL.md)
Directory format `skill-name/SKILL.md` with YAML frontmatter (`description`,
`argumentHint`, `allowed-tools`, …). Loaded from:
- project: `.ur/skills/<name>/SKILL.md`
- user: `~/.ur/skills/<name>/SKILL.md`
- plugins and MCP servers (MCP skills never execute inline `!command` shell blocks — untrusted)
- bundled skills compiled into the binary (`src/skills/bundled/`, list in doc 03 §13)

Body supports `${UR_SKILL_DIR}` (skill directory path) and `${UR_SESSION_ID}` substitution,
plus `!`-prefixed inline shell execution for trusted (non-MCP) skills.

```
/create-skill release-notes "draft release notes from git log" --project
# → .ur/skills/release-notes/SKILL.md, then invoke with:
/release-notes v2.1
```
`/skills` lists them; the model can also self-invoke via the `Skill` tool.
`/skillify` (bundled) converts the current session's workflow into a skill.

### 2. Executable skills (skill.yaml) — skills as workflows
`.ur/skills/<name>/skill.yaml` (`src/skills/skillSpec.ts`) compiles into a `WorkflowSpec`:

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
The directory may include `instructions.md`, `scripts/`, `templates/`, `checklists/`
referenced via `${UR_SKILL_DIR}`.

```
/skill list · /skill show deploy-checklist · /skill run deploy-checklist · /skill init <name>
```

## Workflows (`/workflow`, aliases `/wf`, `/workflows`)

Declarative, checkpointed DAGs of agent steps (`src/services/agents/workflows.ts`).
Each step: `id`, `name`, `agent` (subagent type), `prompt`, `dependsOn`, optional
`gate: approval|verification`, `checkpoint: true`. Stored under `.ur/workflows/`.

```
/workflow init release             # scaffold
/workflow validate release        # cycle/agent checks
/workflow graph release --ascii   # Mermaid or ASCII rendering
/workflow plan release            # topological dry-run
/workflow run release             # execute; gates pause for approval
/workflow run release --resume    # resume from last checkpoint
/workflow next release            # show/advance the next step manually
/workflow done release step-id    # mark a step complete
/workflow reset release
```
Runs surface as `LocalWorkflowTask` background tasks in `/tasks`.

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
