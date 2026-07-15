---
name: skill-authoring
display-name: Skill Authoring
description: Conventions for writing a high-quality UR skill — frontmatter fields, trigger design, step structure with success criteria, tool scoping, and storage locations. Use when authoring, generating, or refining a SKILL.md.
when_to_use: Use when creating or improving a skill — e.g. "make a skill that…", "turn this into a skill", "forge a skill", or editing a SKILL.md.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(mkdir:*), AskUserQuestion
---

# Skill Authoring

A skill is a reusable prompt UR auto-invokes when its triggers match. Quality
lives in two places: a `when_to_use` sharp enough to fire at the right time, and
steps concrete enough to execute without re-deriving the process.

## Storage

- **Project**: `./.ur/skills/<name>/SKILL.md` — workflows specific to this repo.
- **Personal**: `~/.ur/skills/<name>/SKILL.md` — follows the user across repos.

`<name>` is kebab-case. The file is `SKILL.md`. Supporting scripts and reference
files live beside it in the same directory.

## Frontmatter

```yaml
---
name: <kebab-case-name>
description: <one line: what it does>
when_to_use: Use when <situation>. Examples: "<trigger phrase>", "<another>".
allowed-tools: Read, Write, Bash(gh:*)        # minimum, narrow patterns
argument-hint: "<arg placeholders>"           # only if it takes arguments
arguments:                                    # only if it takes arguments
  - <arg_name>
context: fork                                 # omit for inline (the default)
---
```

- **`when_to_use` is the most important field.** It tells the model when to
  auto-invoke. Start with "Use when…" and include real trigger phrases and
  example user messages. A vague `when_to_use` means the skill never fires.
- **`allowed-tools`**: grant the minimum. Prefer scoped patterns like
  `Bash(gh:*)` over bare `Bash`.
- **`context: fork`** only for self-contained skills that need no mid-run input;
  otherwise leave it inline so the user can steer.
- **`arguments` / `argument-hint`**: include only if the skill takes parameters.
  Reference them in the body as `$arg_name`.

## Body structure

```markdown
# <Skill Title>
One-line statement of what this skill accomplishes.

## Inputs
- `$arg_name`: what it is.

## Goal
The end state, with concrete artifacts or criteria for "done".

## Steps

### 1. <Step name>
What to do — specific and actionable, with commands where useful.
**Success criteria**: how we know this step is done. REQUIRED on every step.
```

### Per-step annotations (optional, add only when they matter)

- **Success criteria** — required on every step; the signal it is safe to move on.
- **Execution** — `Direct` (default), `Task agent`, `Teammate` (parallel), or
  `[human]` when the user must act.
- **Artifacts** — data a step produces that later steps consume (PR number, SHA).
- **Human checkpoint** — pause for confirmation before irreversible actions
  (merging, sending messages, deleting).
- **Rules** — hard constraints; the user's mid-session corrections belong here.

Steps that can run concurrently use sub-numbers (3a, 3b).

## Principles

- Keep simple skills simple — a two-step skill needs no annotations.
- Be concrete: name commands, paths, and success signals, not vague advice.
- Progressive disclosure: put long references or scripts in sibling files and
  link them, rather than bloating the SKILL.md.
- Don't over-interview the user; infer a strong draft, then confirm once.
