# skill-forge

Have the agent build skills for you. Describe what you want and the **currently
selected model** authors a complete, ready-to-use `SKILL.md` — frontmatter,
triggers, steps, and success criteria — then saves it to your skills directory.

This complements the built-in `/create-skill`, which only scaffolds an empty
template. `skill-forge` writes the real content.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/forge-skill` | `<what it should do> [--project]` | Author a full skill from your description and save it. |
| `/skill-refine` | `<name> : <change>` | Improve or extend an existing skill. |

A bundled `skill-authoring` skill defines the conventions both commands follow
(frontmatter, trigger design, step structure, tool scoping).

## Setup

```sh
/plugin install skill-forge@ur-plugins-official
/forge-skill a skill that drafts release notes from the git log since the last tag
```

The commands run as prompts, so they use whatever model your session is on — no
configuration. Skills are saved to `~/.ur/skills/<name>/` by default, or
`./.ur/skills/<name>/` with `--project`. Existing skills are never overwritten.

## How it works

`/forge-skill` reads your brief, designs the skill (name, `when_to_use` triggers,
arguments, minimal `allowed-tools`, inline vs fork, steps with success criteria),
shows you the `SKILL.md` for a one-tap confirmation, then writes it — adding
helper scripts beside it when the task warrants. After saving, invoke it like any
skill: `/<name>`.
