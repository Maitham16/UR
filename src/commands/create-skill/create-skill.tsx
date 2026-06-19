import { mkdir, writeFile } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
import { clearCommandsCache } from '../../commands.js'
import { getSkillsPath } from '../../skills/loadSkillsDir.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { getDisplayPath } from '../../utils/file.js'

const USAGE =
  'usage: /create-skill <name> [: <description>] [--project]\n' +
  '  <name>         skill name (spaces become hyphens), e.g. release notes\n' +
  '  : <description>  optional summary used to decide when the skill applies\n' +
  '  --project      write to ./.ur/skills instead of ~/.ur/skills\n' +
  'examples:\n' +
  '  /create-skill release-notes\n' +
  '  /create-skill release notes : Summarize the git log into release notes'

/** Turn arbitrary user text into a safe kebab-case skill directory name. */
function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildSkillTemplate(name: string, description: string): string {
  const title = name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return `---
name: ${name}
description: ${description}
when_to_use: Describe the situations where UR should reach for this skill.
---

# ${title}

Replace this body with the instructions UR should follow when this skill runs.

## Steps
1. ...
2. ...

## Notes
- Keep the description above focused — it is what UR reads to decide whether to use this skill.
- Anything in this file below the frontmatter is the prompt that expands when the skill is invoked.
`
}

export const call: LocalCommandCall = async (args: string) => {
  // Strip the optional --project flag, then split the remainder into a name and
  // an optional ": description" tail. Everything before the first colon is the
  // (slugified) name, so multi-word names like "release notes" work naturally.
  const useProject = /(^|\s)--project(\s|$)/.test(args ?? '')
  const cleaned = (args ?? '').replace(/(^|\s)--project(\s|$)/, ' ').trim()

  const colonIndex = cleaned.indexOf(':')
  const rawName = (colonIndex === -1 ? cleaned : cleaned.slice(0, colonIndex)).trim()
  const rawDescription =
    colonIndex === -1 ? '' : cleaned.slice(colonIndex + 1).trim()

  if (!rawName) {
    return { type: 'text', value: USAGE }
  }

  const name = slugify(rawName)
  if (!name) {
    return {
      type: 'text',
      value: `Invalid skill name "${rawName}". Use letters, numbers, and spaces or hyphens.`,
    }
  }

  const humanName = name.replace(/-/g, ' ')
  const description =
    rawDescription ||
    `${humanName.charAt(0).toUpperCase()}${humanName.slice(1)} skill`

  const source = useProject ? 'projectSettings' : 'userSettings'
  const baseDir = getSkillsPath(source, 'skills')
  const resolvedBase = isAbsolute(baseDir)
    ? baseDir
    : resolve(getCwd(), baseDir)
  const skillDir = join(resolvedBase, name)
  const skillFile = join(skillDir, 'SKILL.md')

  try {
    // wx fails if the file already exists, so we never clobber an existing skill.
    await mkdir(skillDir, { recursive: true })
    await writeFile(skillFile, buildSkillTemplate(name, description), {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'EEXIST') {
      return {
        type: 'text',
        value: `A skill already exists at ${getDisplayPath(skillFile)}. Pick a different name or edit it directly.`,
      }
    }
    return {
      type: 'text',
      value: `Failed to create skill: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Drop memoized command/skill caches so the new skill is picked up without a restart.
  clearCommandsCache()

  return {
    type: 'text',
    value:
      `Created skill "${name}" at ${getDisplayPath(skillFile)}.\n` +
      `Edit it to add your instructions, then run /${name} or let UR invoke it automatically.`,
  }
}
