---
description: Improve or extend an existing skill — sharpen triggers, add steps, scripts, or success criteria.
argument-hint: "<skill-name> : <what to change or add>"
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
---

Refine an existing skill.

1. Split `$ARGUMENTS` into a skill name and the change request (separated by
   `:`). If the name is missing, list the skills under `~/.ur/skills` and
   `./.ur/skills` and ask which one to refine.
2. Locate its `SKILL.md` — project `./.ur/skills/<name>/` takes precedence over
   global `~/.ur/skills/<name>/`. If none exists, say so and offer `/forge-skill`.
3. Read it, then apply the requested change while keeping the `skill-authoring`
   conventions: a sharp `when_to_use`, minimal `allowed-tools`, and a
   **Success criteria** on every step. Preserve everything not being changed.
4. Show the updated `SKILL.md` (or a diff of the changed sections) and confirm
   with one AskUserQuestion before writing.
5. Save in place and report exactly what changed.
