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
