import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { assertZodCollectionSecurity, verifyZodSecurity } from '../scripts/zod-security-check.mjs'
import { evaluateAuditReport } from '../scripts/dependency-audit.mjs'
const root = join(import.meta.dir, '..'), require = createRequire(join(root, 'package.json'))

test('fixed root and both legacy consumers reject oversized collections before traversing elements', async () => {
  expect(verifyZodSecurity().consumers).toHaveLength(2)
  for (const consumer of ['@ag-ui/core', '@anthropic-ai/sandbox-runtime']) {
    const scoped = createRequire(require.resolve(consumer)), directory = dirname(scoped.resolve('zod/package.json'))
    for (const z of [scoped('zod').z, (await import(pathToFileURL(join(directory, 'v3/index.js')).href)).z]) {
      assertZodCollectionSecurity(z)
      let walked = 0
      const element = z.string().superRefine(async () => { walked++ })
      for (const schema of [z.array(element).max(1), z.array(element).length(1), z.set(element).max(1)]) {
        const result = await schema.safeParseAsync(schema instanceof z.ZodSet ? new Set(['a', 'b']) : ['a', 'b'])
        expect(result.success).toBe(false); expect(result.error.issues).toHaveLength(1); expect(walked).toBe(0)
      }
      expect(await z.array(z.string()).max(2).parseAsync(['a', 'b'])).toEqual(['a', 'b'])
    }
  }
})

test('audit permits only the exact Zod advisory after installed-code verification', () => {
  const report = { zod: [{ url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5' }] }
  expect(evaluateAuditReport(report).verifiedBackports).toBe(1)
  expect(() => evaluateAuditReport(report, undefined, () => { throw new Error('tampered Zod') })).toThrow('tampered Zod')
  expect(() => evaluateAuditReport({ zod: [{ url: 'https://github.com/advisories/unknown' }] })).toThrow('Unpatched')
})

test('Zod gate rejects altered hashes, registration, unexpected lock entries and expired review', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ur-zod-integrity-'))
  try {
    cpSync(join(root, 'patches'), join(directory, 'patches'), { recursive: true })
    for (const file of ['package.json', 'bun.lock']) cpSync(join(root, file), join(directory, file))
    mkdirSync(join(directory, 'node_modules'), { recursive: true })
    // Resolution needs only these packages, not an entire development install.
    for (const name of ['zod', '@ag-ui/core', '@anthropic-ai/sandbox-runtime']) cpSync(join(root, 'node_modules', name), join(directory, 'node_modules', name), { recursive: true })
    expect(verifyZodSecurity({ directory, runBehavior: false }).version).toBe('3.25.76')
    expect(() => verifyZodSecurity({ directory, now: new Date('2026-11-20'), runBehavior: false })).toThrow('expired')
    for (const file of ['patches/zod@3.25.76.patch', 'node_modules/@ag-ui/core/node_modules/zod/v3/types.js']) {
      const path = join(directory, file), original = readFileSync(path)
      writeFileSync(path, Buffer.concat([original, Buffer.from('\n/* changed */')]))
      expect(() => verifyZodSecurity({ directory, runBehavior: false })).toThrow('SHA-256')
      writeFileSync(path, original)
    }
    const lock = join(directory, 'bun.lock'), original = readFileSync(lock, 'utf8')
    writeFileSync(lock, original.replace('"zod@4.6.7"', '"zod@4.5.4"'))
    expect(() => verifyZodSecurity({ directory, runBehavior: false })).toThrow('Unreviewed')
    writeFileSync(lock, original)
    const path = join(directory, 'package.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
    delete manifest.patchedDependencies['zod@3.25.76']; writeFileSync(path, JSON.stringify(manifest))
    expect(() => verifyZodSecurity({ directory, runBehavior: false })).toThrow('not registered')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
