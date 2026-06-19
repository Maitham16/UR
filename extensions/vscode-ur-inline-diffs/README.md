# UR Inline Diffs for VS Code

Native VS Code surface for UR inline diff bundles.

## Workflow

Create a bundle from the UR CLI:

```sh
ur ide diff capture --title "Parser fix"
```

Open VS Code in the same workspace. The UR activity-bar view lists bundles from
`.ur/ide/diffs/manifest.json`.

Supported actions:

- refresh the bundle list
- open a patch preview with metadata and comments
- add a comment that writes back to the UR metadata and manifest

The extension is local-only. It reads and writes files under the current
workspace and does not call any model provider or network service.
