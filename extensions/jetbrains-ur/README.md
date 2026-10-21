# UR for JetBrains (experimental scaffold)

Connects JetBrains IDEs to a running UR-Nexus agent over the local UR HTTP
JSON-RPC server (`ur acp serve --port 9100`). This endpoint is a UR-specific
compatibility API, not an Agent Client Protocol transport binding. The plugin
builds with IntelliJ Platform Gradle Plugin 2.18 and IDEA 2024.3. Packaging checks
run `buildPlugin`, `verifyPluginProjectConfiguration`, `verifyPluginStructure`
and official `verifyPlugin` against the declared IDEA 2024.3.7.1 target.
Binary compatibility checks do not prove every IDE's runtime behavior.
Install the `buildPlugin` zip via Settings → Plugins → ⚙ →
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

For an authenticated server, launch the IDE with `UR_ACP_TOKEN` set to the same
secret as the server. `UR_ACP_URL` overrides the default loopback base URL.
Tokens are sent in an Authorization header. JSON-RPC response IDs are validated;
failed or canceled tasks display errors rather than successful result dialogs.
This plugin still uses the synchronous compatibility prompt endpoint; the
Node/Python SDKs expose the newer event-cursor/approval transport.

A reproducible build can also use the official Gradle/JDK container without
installing a system JDK:

```sh
docker run --rm --mount type=bind,source="$PWD",target=/workspace \
  --workdir /workspace gradle:9.4.0-jdk21 \
  gradle --no-daemon --max-workers=2 buildPlugin verifyPluginProjectConfiguration verifyPluginStructure verifyPlugin
```

Publishing to JetBrains Marketplace requires an authorized publisher account
and publishing token; installing the built ZIP from disk does not require
Marketplace publication.
