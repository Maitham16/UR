# UR for JetBrains (experimental scaffold)

Connects JetBrains IDEs to a running UR-Nexus agent over the local ACP server
(`ur acp serve --port 9100`). This is a build scaffold — it compiles with the
IntelliJ Platform Gradle plugin but has not been published; treat it as the
starting point for the JetBrains integration, mirroring what
`extensions/vscode-ur-inline-diffs` does for VS Code.

## What it wires up

- A tool window ("UR Agent") that connects to the ACP endpoint and streams
  session events.
- An action (Tools → UR: Send Selection) that posts the current selection as
  a prompt to the active UR session.

## Build

```
cd extensions/jetbrains-ur
gradle buildPlugin   # requires JDK 17 + IntelliJ Platform Gradle plugin
```

The heavy lifting stays in UR's ACP server — the plugin is intentionally a
thin client, so protocol changes land on the CLI side.
