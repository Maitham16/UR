# UR-AGENT plugins

UR-AGENT plugins are trusted local extension bundles. They can contribute slash
commands, MCP servers, executable skills, templates, validators, language
adapters, LSP servers, hooks, output styles, and agents.

## Repository layout

```text
plugins/
  core/        # first-party plugins shipped with UR-AGENT
  community/   # contributed plugins staged for review
  examples/    # templates users can copy
src/plugins/   # built-in plugin registration code
```

The official marketplace manifest lives at `.ur-plugin/marketplace.json` and
uses local paths such as `./plugins/core/hello`. It does not depend on previous
repositories.

## Create a plugin

Copy the command template:

```bash
cp -R plugins/examples/command-template plugins/community/my-plugin
```

Edit:

```text
plugins/community/my-plugin/.ur-plugin/plugin.json
plugins/community/my-plugin/commands/example.md
```

Then run it locally:

```bash
ur --plugin-dir ./plugins/community/my-plugin
```

## Add a first-party marketplace plugin

1. Put the plugin under `plugins/core/<name>/`.
2. Keep its manifest at `plugins/core/<name>/.ur-plugin/plugin.json`.
3. Add an entry to `.ur-plugin/marketplace.json` with `source` set to
   `./plugins/core/<name>`.
4. Set `capabilities` accurately so users know what the plugin enables.
5. Run `bun test test/marketplaceTree.test.ts` before submitting.

Plugins are loaded from local UR-AGENT paths first. Network marketplace installs
remain explicit user actions and are subject to plugin policy checks.

## Manifest reference

A plugin is a directory containing `.ur-plugin/plugin.json`. UR uses a
**declarative component model** — a manifest points at markdown/JSON components
rather than a JS entry point.

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | string (required) | Unique plugin id. |
| `version` | string | Semver; recommended for updates. |
| `description` | string | Shown in `ur plugin list`. |
| `author` | object | `{ name, url, email }`. |
| `commands` | string \| string[] \| object | Path(s) to markdown commands. |
| `agents` | string \| string[] | Path(s) to agent definitions. |
| `skills` | string \| string[] | Path(s) to `SKILL.md` skills. |
| `templates` | string \| string[] | Path(s) to templates. |
| `validators` | string \| string[] | Path(s) to JSON validators. |
| `outputStyles` | string \| string[] | Path(s) to output styles. |
| `hooks` | object | Lifecycle hooks (see below). |
| `mcpServers` | object | MCP servers the plugin registers. |
| `lspServers` | object | LSP servers for language adapters. |
| `languageAdapters` | object | Language → engine/LSP metadata. |
| `dependencies` | object | Other plugins that must be enabled. |

Validate a manifest strictly at any time:

```sh
ur plugin validate <path-to-plugin-or-manifest>
ur plugin doctor                 # validate all installed/project/bundled plugins
ur plugin doctor --path plugins/core --json
```

`ur plugin doctor` reports, per plugin, whether the manifest is valid, its
version, the declared components, and the **capability surface** it touches
(commands, skills, templates, validators, hooks, mcpServers, lspServers,
languageAdapters). A broken plugin is reported but never crashes the scan or UR.

## Hooks

Hooks run on lifecycle events and are ordered, isolated, and load-error safe:
`BeforeEdit`, `AfterEdit`, `BeforeCommand`, `AfterCommand`, `BeforeCommit`, and
`OnFailure`. Declare them under `hooks` in the manifest. A hook failure is
isolated to that plugin.

## Plugin commands

```sh
ur plugin list [--json]          # installed plugins
ur plugin doctor [--json]        # validate manifests + capability report
ur plugin validate <path>        # validate a single manifest
ur plugin install <name>         # install from a marketplace
ur plugin enable <name>          # enable an installed plugin
ur plugin disable <name>         # disable (not loaded until re-enabled)
ur plugin uninstall <name>
```

Disabled plugins are not loaded. Enable/disable state persists in user settings.

## Permissions

UR's declarative model grants only what a plugin declares. Components run in the
same trust model as the CLI: commands/skills/templates are content, MCP and LSP
servers are launched only when the plugin is enabled, and network marketplace
installs are always explicit user actions gated by plugin policy. `ur plugin
doctor` surfaces the capability surface so you can review what a plugin touches
before enabling it.

## Troubleshooting

- **Plugin not loaded:** run `ur plugin list` to confirm it is installed and
  enabled; `ur plugin doctor` to confirm the manifest validates.
- **Manifest rejected:** `ur plugin doctor` prints the exact schema errors
  (field path + message).
- **Command not found after install:** ensure the manifest `commands` path
  points at existing markdown files; re-run `ur plugin doctor`.

