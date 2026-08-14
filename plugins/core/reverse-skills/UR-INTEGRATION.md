# UR redteam execution contract

These rules apply to every skill in this plugin.

1. Confirm UR redteam mode is active. Plugin gating normally guarantees this; never suggest bypassing the gate.
2. Keep UR's task lifecycle ahead of mutations. Read-only inspection may happen first. If the request has multiple outcomes, sequencing, verification/reporting deliverables, or any workspace-changing action, call `TaskList` and create 2–8 concrete outcome tasks with `TaskCreate` when no actionable board exists. Mark the active task `in_progress` before Bash/Edit/Write or delegation, and update every task through completion, failure, or an explicit skip. Never wait for a `TaskListRequired` rejection and never disable the task gate as a workflow shortcut.
3. Separate offline research from target operations. Reading, decompiling, documenting, and authoring local research artifacts may proceed under normal file/tool permissions.
4. Before network access, sample execution, exploitation, credential testing, radio transmission, device mutation, or any other target operation, inspect `/scope show`. Require a scope approved in the current UR session. Mode activation and warning acceptance are not target authorization.
5. Use only the hosts, ports, tools, and intensity recorded in scope. Stop when a discovered pivot or target is outside it; ask the user to update and reapprove scope.
6. Continue to honor UR permission prompts, sandboxing, secrets handling, action-specific confirmations, and task tracking. Never weaken these controls or silently elevate privileges.
7. Prefer reproducible case directories, hashes, timestamps, commands, raw evidence, and findings that distinguish observation from inference.
8. Do not auto-install tools or alter another AI client's configuration. If a dependency is absent, report it and propose an UR-native installation or MCP setup for explicit approval.
9. The selected model/provider is independent. If it declines a request, state that accurately; do not imply UR redteam mode can override provider policy.

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
