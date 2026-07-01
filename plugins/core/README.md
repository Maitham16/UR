# plugins/core/

First-party plugins for the **ur-plugins-official** marketplace.

Each subdirectory here is a self-contained plugin. The marketplace
manifest at `.ur-plugin/marketplace.json` (at the repo root) lists which of
them are published.

## Shipped plugins

| Plugin | Slash command | What it does |
| --- | --- | --- |
| [`hello`](./hello) | `/hello [name]` | Example greeting. Use as a template. |
| [`git-summary`](./git-summary) | `/git-summary` | One-paragraph factual summary of the working tree and recent commits. |
| [`code-review`](./code-review) | `/code-review [base-ref]` | Structured review of the working diff. Correctness, style, test coverage, security, TL;DR verdict. |
| [`explain-error`](./explain-error) | `/explain-error [command]` | Re-runs a failing command and decodes the error in plain English with two next steps. |
| [`release-notes`](./release-notes) | `/release-notes [since-ref]` | Drafts release notes grouped by Features / Fixes / Documentation / Other since the last tag. |
| [`evaluate-response`](./evaluate-response) | `/evaluate-response` | Adversarial self-evaluation of the most recent assistant turn. |
| [`obsidian`](./obsidian) | `/second-brain` (+4) | Operate an Obsidian vault as a second brain — atomic notes, daily notes, MOCs, backlinks, cited search. Direct file edits or the Local REST API MCP server. |
| [`github`](./github) | `/gh-pr-review` (+3) | Review and open pull requests, triage issues, check repo health — via the official GitHub MCP server or the `gh` CLI. |
| [`gitlab`](./gitlab) | `/gl-mr-review` (+3) | Review and open merge requests, triage issues, watch CI/CD pipelines — via the official GitLab MCP server or the `glab` CLI. |
| [`huggingface`](./huggingface) | `/hf-model-search` (+3) | Search, vet, and download Hub models and datasets — via the official Hugging Face MCP server or the `hf` CLI. |
| [`word`](./word) | `/docx-new` (+3) | Create, convert, review, and edit Word documents — via the Office Word MCP server or a pandoc / python-docx fallback. |
| [`powerpoint`](./powerpoint) | `/pptx-new` (+3) | Build, convert, review, and theme PowerPoint decks — via the Office PowerPoint MCP server or a python-pptx fallback. |
| [`miro`](./miro) | `/miro-board` (+3) | Create boards, diagrams, and sticky clusters and summarize boards — via Miro's official MCP server or the REST API. |
| [`skill-forge`](./skill-forge) | `/forge-skill` (+1) | The active model authors a complete `SKILL.md` from your description and saves it to your skills directory. |
| [`engineering-discipline`](./engineering-discipline) | `/discipline-check` | Reference plugin that ships a command, executable skill, agent template, validator, and Markdown language adapter metadata. |

Seven of these are **integration plugins**: each bundles an official MCP server,
several slash commands, and a methodology skill, and prompts for its config
(tokens, vault path, output folders) on enable. The Office plugins run their MCP
server through `uvx` (install `uv`) and fall back to local Python libraries.
Secrets are stored in secure storage, never in plaintext settings.

[`skill-forge`](./skill-forge) is a **meta plugin** (no MCP): its commands run as
prompts, so the active session model authors and saves the skill for you.

[`engineering-discipline`](./engineering-discipline) is a **marketplace
capability reference plugin**. It demonstrates every standard extension surface
UR accepts from marketplace plugins: commands, executable skills, reusable agent
templates, deterministic validators, language adapters, and LSP server metadata.

## Adding a new plugin

1. Copy `hello/` to a new directory, e.g. `plugins/core/my-plugin/`.
2. Edit `my-plugin/.ur-plugin/plugin.json` with the plugin's real metadata.
3. Replace the example command in `my-plugin/commands/` with your own.
4. Add optional extension folders as needed:
   - `skills/<name>/SKILL.md`
   - `templates/<name>.md`
   - `validators/<name>.json`
   - `mcpServers` or `lspServers` in `.ur-plugin/plugin.json`
   - `languageAdapters` in `.ur-plugin/plugin.json`
5. Add an entry to `.ur-plugin/marketplace.json` (sibling to existing
   entries).
6. Set the entry's `capabilities` array so users can see whether it adds MCP
   tools, skills, templates, validators, language adapters, LSP servers,
   commands, agents, or hooks before installation.
7. Open a PR against `Maitham16/UR`.

See [`hello/README.md`](./hello/README.md) for the smallest possible example.

## Schemas

The shapes for `marketplace.json` and `plugin.json` are defined in the
agent source — see `src/utils/plugins/schemas.ts` (`PluginMarketplaceSchema`
and `PluginManifestSchema`). The schemas are strict-by-default but
unknown fields on marketplace entries are silently stripped so future
versions stay forward-compatible.
