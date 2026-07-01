---
name: Reproducible Release
description: Use when preparing a UR-style engineering change for release. Enforces spec -> plan -> patch -> test -> verify -> document -> benchmark -> reproduce, with explicit command evidence and rollback notes.
version: 0.1.0
---

# Reproducible Release

Use this skill when a change must be ready for production, npm packaging, or a
research/demo artifact.

## Workflow

1. State the intended release surface and affected commands.
2. Inspect the diff and list public API, generated-file, and safety risks.
3. Run the smallest relevant compile/test/lint checks, then broaden to the full
   release gate when risk warrants it.
4. Record command evidence exactly: command, exit code, stdout/stderr summary,
   and next action.
5. Confirm documentation and marketplace files are updated when user-facing
   behavior changes.
6. Produce a PR-style report with summary, changed files, tests run, risks,
   rollback command, and remaining TODOs.

## Hard Rules

- Never claim tests passed without command evidence.
- Never hide a failed command or skipped gate.
- Never edit generated/vendor files unless the task explicitly requires it.
- Never publish or tag until the release gate passes and the user explicitly
  asks for publishing.
