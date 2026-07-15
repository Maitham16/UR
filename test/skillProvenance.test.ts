import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  assertSkillIntegrity,
  computeSkillTree,
  inspectSkillProvenance,
  signSkillDirectory,
  SKILL_INTEGRITY_MANIFEST,
  validateAgentSkill,
} from '../src/skills/skillProvenance.js'
import { getOriginalCwd } from '../src/bootstrap/state.js'
import {
  DANGEROUS_DIRECTORIES,
  getURSkillScope,
} from '../src/utils/permissions/filesystem.js'

const temporaryDirectories: string[] = []

function createSkill(name = 'safe-skill'): string {
  const root = mkdtempSync(join(tmpdir(), 'ur-skill-provenance-'))
  temporaryDirectories.push(root)
  const path = join(root, name)
  mkdirSync(join(path, 'scripts'), { recursive: true })
  writeFileSync(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A safe test skill.\nlicense: Apache-2.0\ncompatibility: UR 1.47 or newer\nmetadata:\n  author: tests\nallowed-tools: Read Grep\n---\n\n# Test\n\nFollow the instructions.\n`,
  )
  writeFileSync(join(path, 'scripts', 'check.sh'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  })
  return path
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('Agent Skills validation and provenance', () => {
  test('strictly validates required Agent Skills fields and directory identity', () => {
    const valid = validateAgentSkill(
      '---\nname: code-review\ndescription: Reviews code.\n---\nDo it.\n',
      'code-review',
    )
    expect(valid.valid).toBe(true)

    const invalid = validateAgentSkill(
      '---\nname: Code Review\ndescription: ""\ncompatibility: 42\nmetadata:\n  owner: 7\n---\n',
      'code-review',
    )
    expect(invalid.valid).toBe(false)
    expect(invalid.diagnostics.map(item => item.code)).toEqual(
      expect.arrayContaining([
        'name.format',
        'name.directory_mismatch',
        'description.required',
        'compatibility.format',
        'metadata.values',
      ]),
    )
  })

  test('builds deterministic tree and permission digests without recording content', () => {
    const path = createSkill()
    const first = inspectSkillProvenance({
      skillDir: path,
      source: 'projectSettings',
      loadedFrom: 'skills',
      trustedKeys: {},
    })
    const second = computeSkillTree(path)

    expect(first.validation.valid).toBe(true)
    expect(first.signature.status).toBe('unsigned')
    expect(first.tree.digest).toBe(second.digest)
    expect(first.tree.files).toBe(2)
    expect(first.permissions.allowedTools).toEqual(['Grep', 'Read'])
    expect(first.tree.entries.some(entry => 'content' in entry)).toBe(false)
  })

  test('signs with Ed25519, verifies trust, and detects later tampering', () => {
    const path = createSkill()
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    const signed = signSkillDirectory({
      skillDir: path,
      keyId: 'release-test',
      privateKey: privatePem,
      signedAt: '2026-07-15T00:00:00.000Z',
    })
    expect(signed.signature.status).toBe('verified')
    expect(statSync(join(path, SKILL_INTEGRITY_MANIFEST)).mode & 0o077).toBe(0)

    const untrusted = inspectSkillProvenance({
      skillDir: path,
      source: 'projectSettings',
      loadedFrom: 'skills',
      trustedKeys: {},
    })
    expect(untrusted.signature.status).toBe('verified-untrusted')
    const trusted = inspectSkillProvenance({
      skillDir: path,
      source: 'projectSettings',
      loadedFrom: 'skills',
      trustedKeys: { 'release-test': publicPem },
    })
    expect(trusted.signature.status).toBe('verified')
    assertSkillIntegrity(trusted)

    writeFileSync(join(path, 'scripts', 'check.sh'), '#!/bin/sh\nexit 1\n')
    expect(() => assertSkillIntegrity(trusted)).toThrow('changed after load')
    expect(
      inspectSkillProvenance({
        skillDir: path,
        source: 'projectSettings',
        loadedFrom: 'skills',
        trustedKeys: { 'release-test': publicPem },
      }).signature.status,
    ).toBe('invalid')
  })

  test('refuses to sign symlinked resources', () => {
    const path = createSkill()
    const outside = join(path, '..', 'outside.txt')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(path, 'linked.txt'))
    const { privateKey } = generateKeyPairSync('ed25519')

    expect(() =>
      signSkillDirectory({
        skillDir: path,
        keyId: 'release-test',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
    ).toThrow('symlinks')
    expect(readFileSync(join(path, 'SKILL.md'), 'utf8')).toContain('safe-skill')
  })

  test('protects cross-client skill roots with a narrow session scope', () => {
    const path = join(
      getOriginalCwd(),
      '.agents',
      'skills',
      'review-code',
      'SKILL.md',
    )
    expect(getURSkillScope(path)).toEqual({
      skillName: 'review-code',
      pattern: '/.agents/skills/review-code/**',
    })
    expect(DANGEROUS_DIRECTORIES).toContain('.agents')
  })
})
