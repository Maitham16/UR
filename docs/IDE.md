# IDE Integration

UR integrates with editors through three mechanisms, chosen per editor and stated
honestly — nothing claims support it does not have:

- **Native extension** — a UR extension/plugin runs inside the editor (VS Code
  family, JetBrains). UR connects to it via the `/ide` flow.
- **Stdio ACP** — the editor launches UR as an [Agent Client Protocol](ACP.md)
  agent over stdio (`ur acp stdio`). Used by Zed and ACP-capable Neovim clients.
- **Manual** — no auto-config; install a plugin and connect via `/ide`.

## Supported targets

| Editor | Mechanism | Auto config | Apply/reject | Notes |
| --- | --- | --- | --- | --- |
| VS Code | native extension | `.vscode/settings.json` | via UR extension | Install the UR Inline Diffs extension. |
| Cursor | native extension (VS Code fork) | `.vscode/settings.json` | via UR extension | Same extension as VS Code. |
| Windsurf | native extension (VS Code fork) | `.vscode/settings.json` | via UR extension | Same extension as VS Code. |
| Zed | stdio ACP | `.zed/settings.json` | in-editor (ACP) | Real Agent Client Protocol over stdio. |
| JetBrains | manual plugin | none | via plugin | Install the UR JetBrains plugin, then `/ide`. |
| Neovim | stdio ACP | snippet | client-dependent | Requires a third-party ACP client plugin. |
| Generic ACP | stdio ACP / HTTP | snippet | client-dependent | `ur acp stdio` (native ACP) or `ur acp serve` (HTTP JSON-RPC). |

## Commands

```sh
ur ide status               # workspace, ACP server, provider/model, plugin count, warnings
ur ide doctor               # pass/warn/fail checks; reports missing config clearly
ur ide config <editor>      # print setup + config snippet for the chosen editor
ur ide open                 # open the current project/worktree in a detected IDE
ur ide diff capture         # capture the current diff as a review bundle
ur ide diff list|show <id>  # inspect captured bundles
ur ide diff approve|reject <id>
```

`ur ide config` targets: `vscode`, `cursor`, `windsurf`, `zed`, `jetbrains`,
`neovim`, `generic-acp` (aliases like `nvim`, `intellij`, `code` also resolve).

`ur ide status` reports the active workspace, whether the ACP server is running
and on which port, the active provider/model and runtime backend, the number of
loaded plugins, and any warnings. Add `--json` for machine-readable output.

## Patch / diff workflow

UR never writes to your files silently. Proposed changes are captured as bundles
under `.ur/ide/diffs/` (`ur ide diff capture`), then previewed and explicitly
applied or rejected:

- **CLI:** `ur ide diff show <id>`, `ur ide diff approve <id>`, `ur ide diff reject <id>`.
- **VS Code:** the UR Inline Diffs view lists bundles; right-click a bundle to
  Open (preview), Apply (`git apply`, with a confirmation prompt), Reject, or
  Comment. Applying is always an explicit, confirmed action.

## VS Code extension

The bundled `UR Inline Diffs` extension (`extensions/vscode-ur-inline-diffs`)
provides:

- a tree view of captured diff bundles;
- a read-only webview preview of each patch and its comments;
- **Apply** (confirmed `git apply`) and **Reject** actions;
- **UR: Show Status**, which runs `ur ide status` and prints provider/model and
  plugin information to the UR output channel.

Install it with `ur ide install` (offers the bundled VSIX) or from the packaged
`.vsix`. Apply/reject and status require the UR CLI on your `PATH`.

## Troubleshooting

- **`ur ide status` shows "ACP server: not running":** start it with
  `ur acp serve` (HTTP) or `ur acp stdio` (for ACP editors).
- **No IDE detected:** ensure the editor is running with the UR extension/plugin
  installed, or generate config with `ur ide config <editor>`.
- **Zed doesn't see UR:** confirm `.zed/settings.json` contains the
  `agent_servers.UR` block from `ur ide config zed`, then reload Zed.
- **Apply fails in VS Code:** the patch may not match the current tree; re-capture
  with `ur ide diff capture`.
