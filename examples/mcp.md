# MCP

- `/mcp` lists configured MCP servers and lets you add/manage them.
- Servers are configured in your settings (`.mcp.json` / UR settings); UR maps
  their tools into the registry and runs them through the same approval +
  evidence-ledger path as built-in tools (so MCP calls appear in `/evidence`).
- Risky MCP tools require approval before they run.
- `ur mcp serve` exposes the fail-closed stdio server. The separate
  `UR_MCP_HTTP_TOKEN='<secret>' ur mcp serve-http` command starts the opt-in
  stateless MCP 2026 HTTP surface with negotiated Tasks and a self-contained
  App; off-loopback use requires bearer authentication.
