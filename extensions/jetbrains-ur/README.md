# UR for JetBrains (experimental scaffold)

Connects JetBrains IDEs to a running UR-Nexus agent over the local ACP server
(`ur acp serve --port 9100`). Builds with the IntelliJ Platform Gradle Plugin 2.x (verified: `gradle buildPlugin` produces `build/distributions/jetbrains-ur-<version>.zip` against IDEA 2024.2). Install via Settings → Plugins → ⚙ → Install Plugin from Disk. Mirrors what `extensions/vscode-ur-inline-diffs` does for VS Code.

## What it wires up

- A tool window ("UR Agent") that checks the loopback ACP endpoint without
  blocking the IDE event thread.
- An action (Tools → UR: Send Selection) that posts the current selection as
  a prompt to a project-scoped JSON-RPC session at `/acp`. The current server
  returns a completed synchronous task result; token streaming is not claimed.

## Build

```
cd extensions/jetbrains-ur
JAVA_HOME=$(brew --prefix openjdk@17) gradle buildPlugin   # → build/distributions/*.zip
```

The heavy lifting stays in UR's ACP server — the plugin is intentionally a
thin client, so protocol changes land on the CLI side.
