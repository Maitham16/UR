# UR for JetBrains (experimental scaffold)

Connects JetBrains IDEs to a running UR-Nexus agent over the local UR HTTP
JSON-RPC server (`ur acp serve --port 9100`). This endpoint is a UR-specific
compatibility API, not an Agent Client Protocol transport binding. The plugin
builds with IntelliJ Platform Gradle Plugin 2.18 and IDEA 2024.3. The official
Plugin Verifier reports the artifact compatible with IntelliJ IDEA 2024.3,
2025.1, and 2025.2. Install the `buildPlugin` zip via Settings → Plugins → ⚙ →
Install Plugin from Disk.

## What it wires up

- A tool window ("UR Agent") that checks the loopback UR endpoint without
  blocking the IDE event thread.
- An action (Tools → UR: Send Selection) that posts the current selection as
  a prompt to a project-scoped JSON-RPC session at `/acp`. The current server
  returns a completed synchronous task result; token streaming is not claimed.
  The IDE progress action is cancelable and forwards cancellation to the active
  server-side session instead of merely dismissing the progress UI.

## Build

```
cd extensions/jetbrains-ur
JAVA_HOME=$(brew --prefix openjdk@21) gradle buildPlugin   # → build/distributions/*.zip
```

The heavy lifting stays in UR's HTTP server — the plugin is intentionally a
thin client, so protocol changes land on the CLI side.
