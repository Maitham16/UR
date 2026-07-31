/**
 * Executable skill directories: a skill becomes a workflow.
 *
 * A directory under `.ur/skills/<name>/` containing a `skill.yaml` is treated as
 * an executable skill. The YAML declares metadata, allowed tools, and a DAG of
 * steps that compile directly into the existing `WorkflowSpec`, so skills get
 * validation, topological ordering, checkpoints, gates, and execution for free.
 *
 * The directory may also contain `instructions.md`, `scripts/`, `templates/`,
 * and `checklists/` referenced by step prompts via `${UR_SKILL_DIR}`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep as pathSep } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { safeParseJSON } from '../utils/json.js'
import type { WorkflowSpec, WorkflowStep } from '../services/agents/workflows.js'

export const SKILL_YAML_FILE = 'skill.yaml'
export const SKILL_INSTRUCTIONS_FILE = 'instructions.md'

export type SkillSpec = {
  version: 1
  name: string
  description?: string
  instructions?: string
  allowedTools?: string[]
  argumentHint?: string
  templates?: string[]
  scripts?: string[]
  checklists?: string[]
  steps: SkillStep[]
}

export type SkillStep = {
  id: string
  name: string
  agent: string
  prompt: string
  dependsOn?: string[]
  gate?: 'approval' | 'verification'
  checkpoint?: boolean
}

export type SkillDirectoryInfo = {
  name: string
  path: string
  spec: SkillSpec
  files: {
    instructions?: string
    templates: string[]
    scripts: string[]
    checklists: string[]
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return undefined
  }
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name)
    .sort()
}

function normalizeSkillStep(raw: unknown, index: number): SkillStep {
  const step = (raw ?? {}) as Partial<SkillStep>
  const gate =
    step.gate === 'approval' || step.gate === 'verification' ? step.gate : undefined
  return {
    id: String(step.id ?? `step-${index + 1}`),
    name: String(step.name ?? step.id ?? `Step ${index + 1}`),
    agent: String(step.agent ?? 'general-purpose'),
    prompt: String(step.prompt ?? ''),
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
    gate,
    checkpoint: step.checkpoint === true,
  }
}

/** Parse `skill.yaml` text into a `SkillSpec`. */
export function parseSkillYaml(text: string): SkillSpec {
  const trimmed = text.trim()
  const parsed = trimmed.startsWith('{')
    ? safeParseJSON(trimmed, false)
    : (parseYaml(trimmed) as unknown)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Skill spec is not an object')
  }
  const spec = parsed as Partial<SkillSpec>
  if (!spec.name || !Array.isArray(spec.steps)) {
    throw new Error('Skill spec must have a name and a steps array')
  }
  return {
    version: 1,
    name: String(spec.name),
    description: spec.description ? String(spec.description) : undefined,
    instructions: spec.instructions ? String(spec.instructions) : undefined,
    allowedTools: Array.isArray(spec.allowedTools)
      ? spec.allowedTools.map(String)
      : undefined,
    argumentHint: spec.argumentHint ? String(spec.argumentHint) : undefined,
    templates: Array.isArray(spec.templates) ? spec.templates.map(String) : undefined,
    scripts: Array.isArray(spec.scripts) ? spec.scripts.map(String) : undefined,
    checklists: Array.isArray(spec.checklists) ? spec.checklists.map(String) : undefined,
    steps: spec.steps.map(normalizeSkillStep),
  }
}

/** Validate a parsed skill spec. Returns errors (empty when valid). */
export function validateSkillSpec(spec: SkillSpec): string[] {
  const errors: string[] = []
  if (!NAME_RE.test(spec.name)) {
    errors.push(`invalid skill name "${spec.name}"`)
  }
  if (spec.steps.length === 0) {
    errors.push('skill has no steps')
  }
  const seen = new Set<string>()
  for (const step of spec.steps) {
    if (seen.has(step.id)) errors.push(`duplicate step id "${step.id}"`)
    seen.add(step.id)
    if (!NAME_RE.test(step.id)) errors.push(`invalid step id "${step.id}"`)
  }
  for (const step of spec.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!seen.has(dep)) {
        errors.push(`step "${step.id}" depends on missing step "${dep}"`)
      }
      if (dep === step.id) errors.push(`step "${step.id}" depends on itself`)
    }
  }
  return errors
}

function findInstructions(dir: string): string | undefined {
  for (const name of [SKILL_INSTRUCTIONS_FILE, 'README.md']) {
    const path = join(dir, name)
    const content = readTextFile(path)
    if (content !== undefined) return content
  }
  return undefined
}

/** Load a skill directory by name from a skills root (e.g. `.ur/skills`). */
export function loadSkillDir(skillsRoot: string, name: string): SkillDirectoryInfo | null {
  const dir = join(skillsRoot, name)
  if (!existsSync(dir)) return null
  const specPath = join(dir, SKILL_YAML_FILE)
  const specText = readTextFile(specPath)
  if (specText === undefined) return null

  const spec = parseSkillYaml(specText)
  const errors = validateSkillSpec(spec)
  if (errors.length > 0) {
    throw new Error(`Invalid skill "${name}": ${errors.join('; ')}`)
  }

  const templatesDir = join(dir, 'templates')
  const scriptsDir = join(dir, 'scripts')
  const checklistsDir = join(dir, 'checklists')

  return {
    name,
    path: dir,
    spec,
    files: {
      instructions: findInstructions(dir),
      templates: listFiles(templatesDir),
      scripts: listFiles(scriptsDir),
      checklists: listFiles(checklistsDir),
    },
  }
}

/** List executable skill directory names under a skills root. */
export function listSkillDirs(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(skillsRoot, e.name, SKILL_YAML_FILE)))
    .map(e => e.name)
    .sort()
}

/** Search multiple skills roots and return unique skill infos (project wins). */
export function loadAllSkillDirs(roots: string[]): SkillDirectoryInfo[] {
  const byName = new Map<string, SkillDirectoryInfo>()
  for (const root of roots) {
    for (const name of listSkillDirs(root)) {
      const info = loadSkillDir(root, name)
      if (info) byName.set(name, info)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Compile a `SkillSpec` into a `WorkflowSpec`, injecting skill args. */
export function skillToWorkflow(
  skill: SkillSpec,
  args: string,
  options?: {
    skillDir?: string
    instructionText?: string
  },
): WorkflowSpec {
  const skillDir = options?.skillDir
  const instructions = options?.instructionText ?? ''

  const prefixParts: string[] = []
  if (skillDir) {
    prefixParts.push(`Base directory for this skill: ${skillDir}`)
  }
  if (instructions) {
    prefixParts.push(`\n${instructions}`)
  }
  const prefix = prefixParts.length > 0 ? `${prefixParts.join('\n')}\n\n` : ''

  const substitutedSteps: WorkflowStep[] = skill.steps.map(step => ({
    ...step,
    prompt: substituteSkillArgs(`${prefix}${step.prompt}`, args, skill.argumentHint),
  }))

  return {
    version: 1,
    name: skill.name,
    description: skill.description,
    steps: substitutedSteps,
  }
}

/** Substitute $ARGUMENTS / indexed / named placeholders into a prompt. */
export function substituteSkillArgs(
  content: string,
  args: string,
  argumentHint?: string,
): string {
  const parsedArgs = parseSkillArgs(args)

  let result = content

  // Replace $ARGUMENTS[index] before bare $ARGUMENTS so indexes don't collide.
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    return parsedArgs[index] ?? ''
  })

  // Replace $ARGUMENTS with the full args string
  result = result.replaceAll('$ARGUMENTS', args)

  // Replace $0, $1, ...
  result = result.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10)
    return parsedArgs[index] ?? ''
  })

  // Replace ${UR_SKILL_DIR}
  // This is intentionally left to the caller to set via options.skillDir;
  // we don't know it at parse time.

  // If no placeholders were found and args are non-empty, append them.
  if (result === content && args.trim()) {
    result = `${result}\n\nARGUMENTS: ${args}`
  }

  return result
}

/** Parse a skill argument string. Mirrors the shell-quote based parser lightly. */
export function parseSkillArgs(args: string): string[] {
  if (!args || !args.trim()) return []
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!
    if (quote) {
      if (ch === quote) {
        quote = null
        out.push(current)
        current = ''
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) out.push(current)
  return out
}

export function formatSkillStatus(info: SkillDirectoryInfo): string {
  const lines = [
    `Skill: ${info.name}`,
    info.spec.description ? info.spec.description : '',
    `Path: ${info.path}`,
    info.files.instructions ? 'Instructions: instructions.md' : '',
    info.files.templates.length > 0
      ? `Templates: ${info.files.templates.join(', ')}`
      : '',
    info.files.scripts.length > 0 ? `Scripts: ${info.files.scripts.join(', ')}` : '',
    info.files.checklists.length > 0
      ? `Checklists: ${info.files.checklists.join(', ')}`
      : '',
    `Steps: ${info.spec.steps.length}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/** Scaffold a new executable skill directory. */
export function initSkillDir(dir: string, name: string): { path: string; files: string[] } {
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'templates'), { recursive: true })
  mkdirSync(join(dir, 'checklists'), { recursive: true })

  const spec: SkillSpec = {
    version: 1,
    name,
    description: `Executable ${name} skill`,
    instructions: SKILL_INSTRUCTIONS_FILE,
    allowedTools: ['Read', 'Grep', 'Edit', 'Bash', 'Agent'],
    argumentHint: '[target]',
    steps: [
      {
        id: 'prepare',
        name: 'Prepare',
        agent: 'general-purpose',
        prompt:
          'Read the relevant files and prepare a plan for the target: $ARGUMENTS.',
        dependsOn: [],
        checkpoint: true,
      },
      {
        id: 'execute',
        name: 'Execute',
        agent: 'worker',
        prompt: 'Execute the plan from the prepare step for: $ARGUMENTS.',
        dependsOn: ['prepare'],
        checkpoint: true,
      },
      {
        id: 'verify',
        name: 'Verify',
        agent: 'verification',
        prompt:
          'Verify the changes end to end. End with VERDICT: PASS or VERDICT: FAIL.',
        dependsOn: ['execute'],
        gate: 'verification',
      },
    ],
  }

  writeFileSync(join(dir, SKILL_YAML_FILE), stringifySkillYaml(spec))
  writeFileSync(
    join(dir, SKILL_INSTRUCTIONS_FILE),
    `# ${name}\n\nExecutable skill for ${name}.\n`,
  )
  writeFileSync(
    join(dir, 'checklists', 'default.md'),
    '# Default checklist\n\n- [ ] Step completed successfully\n',
  )
  writeFileSync(
    join(dir, 'templates', 'output.md'),
    '# Output template\n\n## Summary\n\n## Details\n',
  )

  return {
    path: dir,
    files: [
      SKILL_YAML_FILE,
      SKILL_INSTRUCTIONS_FILE,
      'scripts/',
      'templates/output.md',
      'checklists/default.md',
    ],
  }
}

function stringifySkillYaml(spec: SkillSpec): string {
  return stringifyYaml(spec)
}
