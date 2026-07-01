# UR-AGENT plugin examples

This directory contains templates for local UR-AGENT plugins. Copy an example
directory, edit its `.ur-plugin/plugin.json`, and install it with:

```bash
ur --plugin-dir ./plugins/examples/command-template
```

Production first-party plugins live in `plugins/core/`. Community plugins can
be staged under `plugins/community/` before being promoted into the official
marketplace manifest.
