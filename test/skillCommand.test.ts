import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from '../src/commands/skill/skill.ts'
import { runWithCwdOverride } from '../src/utils/cwd.ts'
import { getCrossClientSkillDirsUpToHome } from '../src/utils/markdownConfigLoader.ts'
import {
  clearSkillCaches,
  getSkillDirCommands,
} from '../src/skills/loadSkillsDir.ts'

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

test('ur skill discovers cross-client .agents skills with native precedence', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-cmd-'))
  const crossClientDir = join(tmp, '.agents', 'skills', 'shared')
  const nativeDir = join(tmp, '.ur', 'skills', 'shared')
  for (const [dir, description] of [
    [crossClientDir, 'Cross-client'],
    [nativeDir, 'Native'],
  ] as const) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'skill.yaml'),
      `name: shared\ndescription: ${description}\nsteps:\n  - id: a\n    name: A\n    agent: worker\n    prompt: a\n`,
    )
  }

  const listed = await runWithCwdOverride(tmp, () =>
    call('list --json', {} as never),
  )
  const listPayload = JSON.parse(
    (listed as Extract<typeof listed, { type: 'text' }>).value,
  )
  expect(listPayload.skills).toHaveLength(1)
  expect(listPayload.skills[0].path).toBe(nativeDir)

  rmSync(nativeDir, { recursive: true, force: true })
  const crossClient = await runWithCwdOverride(tmp, () =>
    call('show shared --json', {} as never),
  )
  expect(
    JSON.parse(
      (crossClient as Extract<typeof crossClient, { type: 'text' }>).value,
    ).path,
  ).toBe(crossClientDir)
  rmSync(tmp, { recursive: true, force: true })
})

test('cross-client skill discovery stops at the repository boundary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-boundary-'))
  const repo = join(tmp, 'repo')
  const nested = join(repo, 'packages', 'app')
  const repoSkills = join(repo, '.agents', 'skills')
  const parentSkills = join(tmp, '.agents', 'skills')
  mkdirSync(join(repo, '.git'), { recursive: true })
  mkdirSync(nested, { recursive: true })
  mkdirSync(repoSkills, { recursive: true })
  mkdirSync(parentSkills, { recursive: true })

  expect(getCrossClientSkillDirsUpToHome(nested)).toEqual([repoSkills])
  rmSync(tmp, { recursive: true, force: true })
})

test('slash-skill catalog loads .agents/skills and orders native collisions first', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-catalog-'))
  const name = `cross-client-${Date.now()}`
  for (const [root, description] of [
    [join(tmp, '.agents', 'skills'), 'Cross-client skill'],
    [join(tmp, '.ur', 'skills'), 'Native skill'],
  ] as const) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\nFollow these instructions.\n`,
    )
  }

  clearSkillCaches()
  const commands = await getSkillDirCommands(tmp)
  const collisions = commands.filter(command => command.name === name)
  expect(collisions).toHaveLength(2)
  expect(collisions[0]?.description).toBe('Native skill')
  expect(collisions[1]?.description).toBe('Cross-client skill')
  clearSkillCaches()
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

test('ur skill verify and sign expose strict provenance verdicts', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ur-skill-cmd-'))
  const skillDir = join(tmp, '.ur', 'skills', 'review-code')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: review-code\ndescription: Review code safely.\nallowed-tools: Read Grep\n---\nReview it.\n',
  )

  const unsigned = await runWithCwdOverride(tmp, () =>
    call('verify review-code', {} as never),
  )
  expect((unsigned as Extract<typeof unsigned, { type: 'text' }>).value).toContain(
    'Signature: unsigned',
  )
  expect((unsigned as Extract<typeof unsigned, { type: 'text' }>).value).toContain(
    'VERDICT: PASS',
  )

  const required = await runWithCwdOverride(tmp, () =>
    call('verify review-code --require-trusted', {} as never),
  )
  expect((required as Extract<typeof required, { type: 'text' }>).value).toContain(
    'VERDICT: FAIL',
  )

  const { privateKey } = generateKeyPairSync('ed25519')
  const keyPath = join(tmp, 'signing.pem')
  writeFileSync(
    keyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  )
  chmodSync(keyPath, 0o600)
  const signed = await runWithCwdOverride(tmp, () =>
    call(
      `sign review-code --key ${keyPath} --key-id local-release`,
      {} as never,
    ),
  )
  expect((signed as Extract<typeof signed, { type: 'text' }>).value).toContain(
    'Signature: verified',
  )
  expect((signed as Extract<typeof signed, { type: 'text' }>).value).toContain(
    'VERDICT: PASS',
  )
  rmSync(tmp, { recursive: true, force: true })
})
