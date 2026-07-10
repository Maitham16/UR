import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyFix } from '../src/security/fix.ts'
import { createLab } from '../src/security/lab.ts'

describe('security lab containment', () => {
  test('accepts only known lab kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-lab-'))
    try {
      expect(createLab('pcap', dir).created.length).toBe(2)
      expect(() => createLab('../escape', dir)).toThrow('unknown lab kind')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses an existing labs symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-lab-'))
    const outside = mkdtempSync(join(tmpdir(), 'ur-lab-outside-'))
    try {
      symlinkSync(outside, join(dir, 'labs'))
      expect(() => createLab('pcap', dir)).toThrow('symbolic link')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('security fix application', () => {
  test('requires approval and rolls back a failed verifier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-fix-'))
    const file = join(dir, 'app.ts')
    try {
      writeFileSync(file, 'const unsafe = true\n')
      expect((await applyFix({ cwd: dir, file: 'app.ts', find: 'true', replace: 'false', approved: false })).applied).toBe(false)
      const result = await applyFix({
        cwd: dir,
        file: 'app.ts',
        find: 'true',
        replace: 'false',
        approved: true,
        verify: async () => false,
      })
      expect(result).toMatchObject({ applied: false, reverted: true })
      expect(readFileSync(file, 'utf8')).toBe('const unsafe = true\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects a file symlink that resolves outside the workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-fix-'))
    const outside = mkdtempSync(join(tmpdir(), 'ur-fix-outside-'))
    try {
      const target = join(outside, 'target.txt')
      writeFileSync(target, 'before')
      symlinkSync(target, join(dir, 'linked.txt'))
      const result = await applyFix({ cwd: dir, file: 'linked.txt', find: 'before', replace: 'after', approved: true })
      expect(result.reason).toContain('symbolic link')
      expect(readFileSync(target, 'utf8')).toBe('before')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
