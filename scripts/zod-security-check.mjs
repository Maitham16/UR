import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'jsonc-parser'
import { gte } from 'semver'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Verify the actual root validator and both legacy runtime consumers. */
export function verifyZodSecurity({ directory = root, now = new Date(), runBehavior = true } = {}) {
  const metadata = JSON.parse(readFileSync(join(directory, 'patches/zod-security.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (metadata.package !== 'zod' || metadata.version !== '3.25.76' ||
      metadata.advisory !== 'GHSA-mrhx-c7xc-m3w5' || metadata.patch !== 'patches/zod@3.25.76.patch') throw new Error('Unrecognized Zod security backport metadata')
  assert.deepEqual(metadata.consumers, ['@ag-ui/core', '@anthropic-ai/sandbox-runtime'], 'Unexpected Zod backport consumers')
  assert.deepEqual(Object.keys(metadata.files).sort(), ['src/v3/types.ts', 'v3/types.cjs', 'v3/types.js'], 'Incomplete Zod source hash record')
  const deadline = Date.parse(`${metadata.reviewBy}T00:00:00Z`)
  if (!Number.isFinite(deadline) || now.getTime() >= deadline) throw new Error('Zod security backport review expired')
  if (manifest.patchedDependencies?.['zod@3.25.76'] !== metadata.patch) throw new Error('Zod backport is not registered')
  if (sha256(readFileSync(join(directory, metadata.patch))) !== metadata.patchSha256) throw new Error('Zod patch SHA-256 mismatch')
  const require = createRequire(join(directory, 'package.json'))
  const current = JSON.parse(readFileSync(require.resolve('zod/package.json'), 'utf8'))
  if (!gte(current.version, '4.6.6')) throw new Error('Root Zod must contain the upstream 4.6.6 collection fix')
  const lock = parse(readFileSync(join(directory, 'bun.lock'), 'utf8'))
  const legacyKeys = Object.entries(lock.packages).flatMap(([key, entry]) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].startsWith('zod@')) return []
    const version = entry[0].slice(4)
    if (gte(version, '4.6.6')) return []
    if (version !== metadata.version) throw new Error(`Unreviewed Zod version: ${version}`)
    return [key]
  }).sort()
  assert.deepEqual(legacyKeys, metadata.consumers.map(name => `${name}/zod`).sort(), 'Unexpected legacy Zod consumer in lockfile')
  const validators = [require('zod').z]
  for (const consumer of metadata.consumers) {
    const scoped = createRequire(require.resolve(consumer))
    const packagePath = scoped.resolve('zod/package.json')
    const installed = JSON.parse(readFileSync(packagePath, 'utf8'))
    if (installed.version !== metadata.version) throw new Error(`Unexpected ${consumer} Zod version`)
    for (const [file, hash] of Object.entries(metadata.files)) {
      if (sha256(readFileSync(join(dirname(packagePath), file))) !== hash) throw new Error(`Zod installed source SHA-256 mismatch: ${consumer}/${file}`)
    }
    validators.push(scoped('zod').z)
  }
  if (runBehavior) for (const z of validators) assertZodCollectionSecurity(z)
  return metadata
}

/** Size limits must reject before touching any invalid element or refinement. */
export function assertZodCollectionSecurity(z) {
  let walked = 0
  const element = z.string().superRefine(() => { walked++ })
  for (const schema of [z.array(element).max(2), z.array(element).length(2), z.set(element).max(2)]) {
    const input = schema instanceof z.ZodSet ? new Set(['a', 'b', 'c']) : ['a', 'b', 'c']
    const rejected = schema.safeParse(input)
    assert.equal(rejected.success, false)
    assert.equal(rejected.error.issues.length, 1)
    assert.equal(rejected.error.issues[0].code, 'too_big')
    assert.equal(walked, 0)
  }
  const map = z.map(element, element)
  if (typeof map.max === 'function') {
    const rejected = map.max(1).safeParse(new Map([['a', 'a'], ['b', 'b']]))
    assert.equal(rejected.success, false); assert.equal(rejected.error.issues.length, 1); assert.equal(walked, 0)
  }
  assert.deepEqual(z.array(z.string()).max(2).parse(['a', 'b']), ['a', 'b'])
  assert.equal(z.array(z.string()).max(2).safeParse([1]).success, false)
  assert.equal(z.array(z.string()).min(2).safeParse(['a']).success, false)
  assert.equal(z.set(z.string()).max(2).safeParse(new Set(['a'])).success, true)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const metadata = verifyZodSecurity()
    console.log(`Verified upstream Zod >=4.6.6 and both patched legacy ${metadata.version} consumers: hashes and bounded collection behavior; review before ${metadata.reviewBy}.`)
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
