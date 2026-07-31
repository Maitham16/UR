import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initSkillDir,
  listSkillDirs,
  loadAllSkillDirs,
  loadSkillDir,
  parseSkillYaml,
  skillToWorkflow,
  substituteSkillArgs,
  validateSkillSpec,
} from '../src/skills/skillSpec.ts'

test('parseSkillYaml reads name, description, and steps', () => {
  const yaml = `
name: security-review
description: Audit for security issues
allowedTools: [Read, Grep, Edit, Bash]
argumentHint: '[target]'
steps:
  - id: audit
    name: Audit
    agent: security-auditor
    prompt: Grep dangerous patterns in $ARGUMENTS.
    dependsOn: []
    checkpoint: true
  - id: fix
    name: Fix
    agent: worker
    prompt: Fix low-risk issues.
    dependsOn: [audit]
`
  const spec = parseSkillYaml(yaml)
  expect(spec.name).toBe('security-review')
  expect(spec.description).toBe('Audit for security issues')
  expect(spec.allowedTools).toEqual(['Read', 'Grep', 'Edit', 'Bash'])
  expect(spec.steps.length).toBe(2)
  expect(spec.steps[0]!.id).toBe('audit')
  expect(spec.steps[1]!.dependsOn).toEqual(['audit'])
})

test('validateSkillSpec catches duplicate and self-dependent steps', () => {
  const spec = {
    version: 1 as const,
    name: 'bad-skill',
    steps: [
      { id: 'a', name: 'A', agent: 'worker', prompt: 'do a', dependsOn: ['a'] },
      { id: 'a', name: 'A2', agent: 'worker', prompt: 'do a2' },
      { id: 'b', name: 'B', agent: 'worker', prompt: 'do b', dependsOn: ['missing'] },
    ],
  }
  const errors = validateSkillSpec(spec)
  expect(errors).toContain('duplicate step id "a"')
  expect(errors).toContain('step "a" depends on itself')
  expect(errors).toContain('step "b" depends on missing step "missing"')
})

test('substituteSkillArgs replaces $ARGUMENTS and indexed args', () => {
  expect(substituteSkillArgs('Run $ARGUMENTS', 'foo bar')).toBe('Run foo bar')
  expect(substituteSkillArgs('Run $0 $1', 'foo bar')).toBe('Run foo bar')
  expect(substituteSkillArgs('Run $ARGUMENTS[1]', 'foo bar baz')).toBe('Run bar')
})

test('skillToWorkflow compiles a skill with injected arguments and instructions', () => {
  const spec = {
    version: 1 as const,
    name: 'demo',
    description: 'demo skill',
    instructions: 'instructions.md',
    steps: [
      { id: 's1', name: 'Step 1', agent: 'worker', prompt: 'Process $ARGUMENTS' },
    ],
  }
  const workflow = skillToWorkflow(spec, 'src/main.ts', {
    skillDir: '/skills/demo',
    instructionText: '# Demo instructions',
  })
  expect(workflow.name).toBe('demo')
  expect(workflow.description).toBe('demo skill')
  expect(workflow.steps[0]!.prompt).toContain('Base directory for this skill: /skills/demo')
  expect(workflow.steps[0]!.prompt).toContain('# Demo instructions')
  expect(workflow.steps[0]!.prompt).toContain('Process src/main.ts')
})

test('loadSkillDir and listSkillDirs discover executable skill directories', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-'))
  const skillDir = join(tmp, 'security-review')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'skill.yaml'),
    'name: security-review\ndescription: Audit\nsteps:\n  - id: audit\n    name: Audit\n    agent: worker\n    prompt: audit\n',
  )
  writeFileSync(join(skillDir, 'instructions.md'), '# Security Review\n')

  expect(listSkillDirs(tmp)).toEqual(['security-review'])
  const info = loadSkillDir(tmp, 'security-review')
  expect(info).not.toBeNull()
  expect(info?.spec.name).toBe('security-review')
  expect(info?.files.instructions).toContain('Security Review')
  rmSync(tmp, { recursive: true, force: true })
})

test('loadAllSkillDirs merges roots with project taking precedence', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-'))
  const user = join(tmp, 'user')
  const project = join(tmp, 'project')
  for (const root of [user, project]) {
    const dir = join(root, 'shared')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'skill.yaml'), `name: shared\ndescription: ${root}\nsteps:\n  - id: a\n    name: A\n    agent: worker\n    prompt: a\n`)
  }
  const all = loadAllSkillDirs([user, project])
  expect(all.length).toBe(1)
  expect(all[0]!.spec.description).toBe(project)
  rmSync(tmp, { recursive: true, force: true })
})

test('initSkillDir scaffolds skill.yaml, instructions, templates, and checklists', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-'))
  const dir = join(tmp, 'new-skill')
  const result = initSkillDir(dir, 'new-skill')
  expect(result.path).toBe(dir)
  expect(result.files).toContain('skill.yaml')
  expect(result.files).toContain('instructions.md')
  expect(result.files).toContain('scripts/')
  expect(result.files).toContain('templates/output.md')
  expect(result.files).toContain('checklists/default.md')

  const info = loadSkillDir(tmp, 'new-skill')
  expect(info).not.toBeNull()
  expect(info?.spec.steps.length).toBe(3)
  rmSync(tmp, { recursive: true, force: true })
})
