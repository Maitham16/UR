# UR-Nexus plugins

UR-Nexus plugins are trusted local extension bundles. They can contribute slash
commands, MCP servers, executable skills, templates, validators, language
adapters, LSP servers, hooks, output styles, and agents.

## Repository layout

```text
plugins/
  core/        # first-party plugins shipped with UR-Nexus
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

Plugins are loaded from local UR-Nexus paths first. Network marketplace installs
remain explicit user actions and are subject to plugin policy checks.

## Marketplace sources

UR accepts GitHub shorthand, Git URLs, direct marketplace JSON URLs, npm
packages, local files/directories, and inline settings manifests. Add an npm
marketplace with the explicit `npm:` prefix:

```sh
ur plugin marketplace add npm:acme-ur-marketplace
ur plugin marketplace add npm:@acme/ur-marketplace@latest
ur plugin marketplace add npm:@acme/ur-marketplace@^2.0.0
ur plugin marketplace update <marketplace-name>
```

The package must ship `.ur-plugin/marketplace.json`. An omitted version follows
the registry's `latest` dist-tag; a version, semver range, or another dist-tag
can be supplied after the package name, using npm's
[package-spec syntax](https://docs.npmjs.com/cli/v11/using-npm/package-spec/).
Refreshing the marketplace re-resolves
that selector. UR uses the installed npm client, so standard `.npmrc`
authentication, scoped registries, proxies, and registry settings continue to
work. Package lifecycle scripts are disabled during marketplace download, and
only the requested package—not its staging dependency tree—is retained.

For a private registry selected in project or user settings:

```json
{
  "extraKnownMarketplaces": {
    "acme": {
      "source": {
        "source": "npm",
        "package": "@acme/ur-marketplace",
        "version": "^2.0.0",
        "registry": "https://registry.example.com"
      }
    }
  }
}
```

After an install, removal, or external registry-file change,
`/reload-plugins` clears both plugin discovery caches and the installed-plugin
snapshot before reloading.

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
| `requiredMode` | `"redteam"` | Runtime-gate every command/skill in the plugin to an active UR mode. |

`requiredMode` is enforced both during command discovery and again at
invocation, so a command loaded earlier cannot run after the user leaves the
mode. It is a capability gate, not a permission grant: all ordinary tool,
sandbox, scope, and approval checks still run.

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
ur plugin search [query]         # ranked discovery across configured catalogs
ur plugin show <name-or-id>      # provenance, capabilities, status, install hint
ur plugin doctor [--json]        # validate manifests + capability report
ur plugin validate <path>        # validate a single manifest
ur plugin install <name>         # install from a marketplace
ur plugin enable <name>          # enable an installed plugin
ur plugin disable <name>         # disable (not loaded until re-enabled)
ur plugin uninstall <name>
```

Disabled plugins are not loaded. Enable/disable state persists in user settings.

## Discover plugins

Search is read-only and covers every configured marketplace plus installed,
built-in, and `--plugin-dir` session plugins. Marketplace declaration scope is
reported as managed, personal, workspace, or implicit; source kind identifies
whether its catalog came from GitHub, git, URL, npm, a directory, a file, or
settings. Broken catalogs do not hide healthy results and are reported as
bounded warnings.

```sh
ur plugin search
ur plugin search git
ur plugin search review --capability validators
ur plugin search --marketplace ur-plugins-official --limit 50
ur plugin search --installed
ur plugin search mcp --json
ur plugin show obsidian@ur-plugins-official
ur plugin show obsidian --json
```

Queries use case-insensitive AND-token matching over plugin ID, name,
marketplace, category, tags, capabilities, and description. Exact IDs and names
rank first, followed by name, tag, category, capability, marketplace, and
description matches. Ties are deterministic. The default result limit is 20
and the maximum is 100. Unqualified names must resolve to exactly one catalog;
when two catalogs contain the same name, `plugin show` requires the full
`name@marketplace` ID.

Discovery never installs or enables a plugin. Source URLs have embedded HTTP
credentials redacted before display. Use the exact install command printed in
the search/detail output after reviewing the plugin's provenance and capability
surface.

## Permissions

UR's declarative model grants only what a plugin declares. Components run in the
same trust model as the CLI: commands/skills/templates are content, MCP and LSP
servers are launched only when the plugin is enabled, and network marketplace
installs are always explicit user actions gated by plugin policy. `ur plugin
doctor` surfaces the capability surface so you can review what a plugin touches
before enabling it.

The first-party `reverse-skills` plugin demonstrates a mode-gated skill pack.
It is available only in `/mode redteam`; see [Redteam mode](REDTEAM.md).

## Troubleshooting

- **Plugin not loaded:** run `ur plugin list` to confirm it is installed and
  enabled; `ur plugin doctor` to confirm the manifest validates.
- **Manifest rejected:** `ur plugin doctor` prints the exact schema errors
  (field path + message).
- **Command not found after install:** ensure the manifest `commands` path
  points at existing markdown files; re-run `ur plugin doctor`.
