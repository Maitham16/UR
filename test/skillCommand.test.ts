import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/skill/skill.ts'
import { runWithCwdOverride } from '../src/utils/cwd.ts'

test('ur skill init scaffolds expected files', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-cmd-'))
  const name = `my-skill-${Date.now()}`
  const result = await runWithCwdOverride(tmp, () => call(`init ${name}`, {} as never))
  expect(result.type).toBe('text')
  expect((result as Extract<typeof result, { type: 'text' }>).value).toContain(`Initialized skill "${name}"`)
  expect((result as Extract<typeof result, { type: 'text' }>).value).toContain('skill.yaml')
  expect((result as Extract<typeof result, { type: 'text' }>).value).toContain(join(tmp, '.ur', 'skills', name))
  rmSync(tmp, { recursive: true, force: true })
})

test('ur skill list returns executable skills', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-cmd-'))
  const skillDir = join(tmp, '.ur', 'skills', 'audit')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'skill.yaml'),
    'name: audit\ndescription: Audit code\nsteps:\n  - id: a\n    name: A\n    agent: worker\n    prompt: a\n',
  )
  const result = await runWithCwdOverride(tmp, () => call(`list`, {} as never))
  expect(result.type).toBe('text')
  expect((result as Extract<typeof result, { type: 'text' }>).value).toContain('Executable skills:')
  expect((result as Extract<typeof result, { type: 'text' }>).value).toContain('audit')
  rmSync(tmp, { recursive: true, force: true })
})

test('ur skill show prints compiled workflow with executable assets and args', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-cmd-'))
  const skillDir = join(tmp, '.ur', 'skills', 'demo')
  mkdirSync(join(skillDir, 'scripts'), { recursive: true })
  mkdirSync(join(skillDir, 'templates'), { recursive: true })
  mkdirSync(join(skillDir, 'checklists'), { recursive: true })
  writeFileSync(
    join(skillDir, 'skill.yaml'),
    'name: demo\ndescription: Demo skill\nscripts:\n  - scripts/run.sh\ntemplates:\n  - templates/template.txt\nchecklists:\n  - checklists/review.md\nsteps:\n  - id: a\n    name: A\n    agent: worker\n    prompt: Process $ARGUMENTS with $ARGUMENTS[0]\n',
  )
  writeFileSync(join(skillDir, 'instructions.md'), 'Follow the skill instructions.\n')
  writeFileSync(join(skillDir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\n')
  writeFileSync(join(skillDir, 'templates', 'template.txt'), 'template\n')
  writeFileSync(join(skillDir, 'checklists', 'review.md'), '- verify\n')

  const result = await runWithCwdOverride(tmp, () =>
    call(`show demo src/auth.ts --json`, {} as never),
  )
  expect(result.type).toBe('text')
  const parsed = JSON.parse((result as Extract<typeof result, { type: 'text' }>).value)
  expect(parsed.skill).toBe('demo')
  expect(parsed.files.scripts).toContain('run.sh')
  expect(parsed.files.templates).toContain('template.txt')
  expect(parsed.files.checklists).toContain('review.md')
  expect(parsed.workflow.steps[0].prompt).toContain('Follow the skill instructions.')
  expect(parsed.workflow.steps[0].prompt).toContain('Process src/auth.ts with src/auth.ts')
  expect(parsed.validation.valid).toBe(true)
  rmSync(tmp, { recursive: true, force: true })
})
