import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** A registry exception is usable only for the exact reviewed installed code. */
export function verifyForgePatch({ directory = root, now = new Date(), runBehavior = true } = {}) {
  const metadata = JSON.parse(readFileSync(join(directory, 'patches/node-forge-security.json'), 'utf8'))
  const packageJson = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (metadata.package !== 'node-forge' || metadata.version !== '1.4.0' ||
      metadata.advisory !== 'GHSA-86w9-cpqp-85rv' ||
      metadata.advisoryUrl !== 'https://github.com/advisories/GHSA-86w9-cpqp-85rv' ||
      metadata.patch !== 'patches/node-forge@1.4.0.patch') {
    throw new Error('Unrecognized node-forge security backport metadata')
  }
  const reviewDeadline = Date.parse(`${metadata.reviewBy}T00:00:00Z`)
  if (!Number.isFinite(reviewDeadline) || now.getTime() >= reviewDeadline) {
    throw new Error('node-forge security backport review expired; update to an upstream fix or renew review')
  }
  if (packageJson.patchedDependencies?.['node-forge@1.4.0'] !== metadata.patch) {
    throw new Error('node-forge security backport is not registered in patchedDependencies')
  }
  const require = createRequire(join(directory, 'package.json'))
  const installed = JSON.parse(readFileSync(require.resolve('node-forge/package.json'), 'utf8'))
  if (installed.version !== metadata.version) throw new Error('Unexpected installed node-forge version')
  if (sha256(readFileSync(join(directory, metadata.patch))) !== metadata.patchSha256 ||
      sha256(readFileSync(require.resolve('node-forge/lib/rsa.js'))) !== metadata.patchedRsaSha256) {
    throw new Error('node-forge patch or installed RSA source failed SHA-256 verification')
  }
  if (runBehavior) {
    const result = spawnSync(process.env.BUN_BIN || 'bun', [
      '-e', 'import { assertForgeRsaSecurity } from "./src/utils/forgeSecurity.ts"; console.log(JSON.stringify({passed:true,checks:assertForgeRsaSecurity()}))',
    ], { cwd: directory, encoding: 'utf8', timeout: 30_000 })
    let report
    try { report = JSON.parse(result.stdout) } catch { /* Fail closed below. */ }
    if (result.error || result.status !== 0 || report?.passed !== true || report.checks?.length !== 7) {
      throw new Error(`Installed node-forge RSA behavioral regression failed: ${result.stderr || result.error || result.stdout}`)
    }
  }
  return metadata
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyForgePatch()
    console.log(`Verified node-forge ${result.version} canonical DER backport: source/patch SHA-256 and 7 RSA behavior checks; review before ${result.reviewBy}.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
