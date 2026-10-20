import { expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync, sign } from 'node:crypto'
import forge from 'node-forge'
import { assertForgeRsaSecurity } from '../src/utils/forgeSecurity.js'
import { evaluateAuditReport } from '../scripts/dependency-audit.mjs'
import { verifyForgePatch } from '../scripts/forge-security-check.mjs'

const root = join(import.meta.dir, '..')
const advisory = { url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv', severity: 'high' }

test('actual installed RSA accepts canonical signatures and rejects all forgery variants', () => {
  expect(assertForgeRsaSecurity()).toEqual([
    'canonical-null-parameters', 'canonical-absent-parameters', 'reject-nonempty-null',
    'reject-nested-extra-element', 'reject-nonminimal-lengths', 'reject-non-null-parameters',
    'reject-published-low-exponent-forgery',
  ])
})

test('patched verifier interoperates with independently generated standard RSA signatures', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
  const key = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString())
  for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
    const message = Buffer.from('UR dependency security interoperability fixture')
    const signature = sign(algorithm, message, privateKey).toString('binary')
    const digest = forge.md[algorithm].create().update(message.toString('binary')).digest().getBytes()
    expect(key.verify(digest, signature)).toBe(true)
    expect(key.verify('\0'.repeat(digest.length), signature)).toBe(false)
  }
})

test('audit exception requires verified evidence and rejects every unrelated finding', () => {
  let verified = 0
  const verify = () => { verified++; return { reviewBy: '2026-11-20' } }
  expect(evaluateAuditReport({ 'node-forge': [advisory] }, verify).verifiedBackports).toBe(1)
  expect(verified).toBe(1)
  expect(evaluateAuditReport({}, verify).rawFindings).toBe(0)
  expect(verified).toBe(2)
  for (const report of [
    { other: [advisory] },
    { other: [{ ...advisory, name: 'node-forge' }] },
    { 'node-forge': [{ url: 'https://github.com/advisories/GHSA-other' }] },
    { 'node-forge': [advisory], other: [{ url: 'https://example.com/advisory' }] },
    { 'node-forge': [] }, [], null,
  ]) expect(() => evaluateAuditReport(report, verify)).toThrow()
  expect(() => evaluateAuditReport({ 'node-forge': [advisory] }, () => { throw new Error('tampered') })).toThrow('tampered')
})

test('backport gate rejects tampered installed code, patch, registration and expired review', () => {
  expect(verifyForgePatch({ now: new Date('2026-10-20'), runBehavior: false }).version).toBe('1.4.0')
  const directory = mkdtempSync(join(tmpdir(), 'ur-forge-integrity-'))
  try {
    cpSync(join(root, 'patches'), join(directory, 'patches'), { recursive: true })
    cpSync(join(root, 'package.json'), join(directory, 'package.json'))
    mkdirSync(join(directory, 'node_modules'), { recursive: true })
    cpSync(join(root, 'node_modules/node-forge'), join(directory, 'node_modules/node-forge'), { recursive: true })
    const options = { directory, now: new Date('2026-10-20'), runBehavior: false }
    expect(verifyForgePatch(options).version).toBe('1.4.0')
    expect(() => verifyForgePatch({ ...options, now: new Date('2026-11-20') })).toThrow('expired')
    for (const file of ['patches/node-forge@1.4.0.patch', 'node_modules/node-forge/lib/rsa.js']) {
      const path = join(directory, file)
      const original = readFileSync(path)
      writeFileSync(path, Buffer.concat([original, Buffer.from('\n/* tampered */')]))
      expect(() => verifyForgePatch(options)).toThrow('SHA-256')
      writeFileSync(path, original)
    }
    const packagePath = join(directory, 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    delete packageJson.patchedDependencies
    writeFileSync(packagePath, JSON.stringify(packageJson))
    expect(() => verifyForgePatch(options)).toThrow('not registered')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
