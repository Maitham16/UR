# UR redteam execution contract

These rules apply to every skill in this plugin.

1. Confirm UR redteam mode is active. Plugin gating normally guarantees this; never suggest bypassing the gate.
2. Separate offline research from target operations. Reading, decompiling, documenting, and authoring local research artifacts may proceed under normal file/tool permissions.
3. Before network access, sample execution, exploitation, credential testing, radio transmission, device mutation, or any other target operation, inspect `/scope show`. Require a scope approved in the current UR session. Mode activation and warning acceptance are not target authorization.
4. Use only the hosts, ports, tools, and intensity recorded in scope. Stop when a discovered pivot or target is outside it; ask the user to update and reapprove scope.
5. Continue to honor UR permission prompts, sandboxing, secrets handling, and action-specific confirmations. Never weaken these controls or silently elevate privileges.
6. Prefer reproducible case directories, hashes, timestamps, commands, raw evidence, and findings that distinguish observation from inference.
7. Do not auto-install tools or alter another AI client's configuration. If a dependency is absent, report it and propose an UR-native installation or MCP setup for explicit approval.
8. The selected model/provider is independent. If it declines a request, state that accurately; do not imply UR redteam mode can override provider policy.

Recommended case layout:

```text
case/
  scope.md
  timeline.md
  evidence/
  artifacts/
  notes/
  findings.md
  report.md
```

Preserve originals. Work on hashed copies for mutation, patching, dynamic execution, or fuzzing.
