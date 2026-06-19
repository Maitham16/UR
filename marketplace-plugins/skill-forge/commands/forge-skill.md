---
description: Author a complete, reusable skill from your description and save it to your skills directory.
argument-hint: "<what the skill should do> [--project]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(mkdir:*), AskUserQuestion
---

Author a new UR skill from `$ARGUMENTS`, following the conventions in the
`skill-authoring` skill. You — the active session model — do the writing; this
is not a template scaffold.

**1. Get the brief.**
- If `$ARGUMENTS` describes a skill, treat it as the brief.
- If `$ARGUMENTS` is empty, offer to capture what this session just did, or ask
  for a one-line description. Do not proceed without a brief.
- Note whether `--project` was passed (it controls the save location).

**2. Design it.** From the brief, decide:
- a kebab-case `name` and a one-line `description`;
- `when_to_use` — the trigger phrases and example user messages that should
  auto-invoke it (the most important field; start with "Use when…");
- whether it takes `arguments` (with an `argument-hint`);
- the minimum `allowed-tools`, as narrow patterns (`Bash(gh:*)`, not bare `Bash`);
- `inline` (default) vs `context: fork` (self-contained, no mid-run input);
- the ordered steps, each with an explicit **Success criteria**.

Keep simple skills simple — do not over-engineer a two-step process or
interrogate the user for one. Ask focused AskUserQuestion rounds only when the
brief is genuinely ambiguous.

**3. Draft and confirm.** Output the complete `SKILL.md` as a fenced `yaml`
block so the user can review it, then ask one concise AskUserQuestion — "Save
this skill?" Do not add a "needs tweaking" option; the freeform Other covers
edits.

**4. Save.** Resolve the directory:
- global (default): `~/.ur/skills/<name>/`
- project (`--project`): `./.ur/skills/<name>/`

Never overwrite an existing `SKILL.md` — if one exists, pick a new name or point
the user to `/skill-refine`. Create the directory (`mkdir -p`) and write
`SKILL.md`. If the skill needs helper scripts or reference material, create them
under the skill directory and reference them from the body (progressive
disclosure) rather than inlining everything.

**5. Report.** Print the saved path, how to invoke it (`/<name> [args]`), and
that it can be edited directly. If it does not appear immediately, a new session
will pick it up.
