#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyZodSecurity } from './zod-security-check.mjs'
import { verifyForgePatch } from './forge-security-check.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const advisoryUrl = 'https://github.com/advisories/GHSA-86w9-cpqp-85rv'

/** Reject every finding except the exact backport covered by verified evidence. */
export function evaluateAuditReport(report, verifyPatch = verifyForgePatch, verifyZod = verifyZodSecurity) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Invalid Bun audit JSON report')
  const findings = []
  for (const [name, entries] of Object.entries(report)) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error(`Invalid audit findings for ${name}`)
    for (const finding of entries) {
      if (!finding || typeof finding !== 'object' || typeof finding.url !== 'string') throw new Error(`Invalid advisory for ${name}`)
      findings.push({ ...finding, name })
    }
  }
  const unexpected = findings.filter(finding => !((finding.name === 'node-forge' && finding.url === advisoryUrl) ||
    (finding.name === 'zod' && finding.url === 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5')))
  if (unexpected.length) {
    throw new Error(`Unpatched dependency advisories:\n${unexpected.map(finding => `${finding.name}: ${finding.url}`).join('\n')}`)
  }
  // Verify even when the registry returns no findings: cached/incorrect registry
  // responses cannot let an absent or damaged backport enter shipped bundles.
  const patch = verifyPatch()
  const zodPatch = verifyZod()
  return { rawFindings: findings.length, verifiedBackports: findings.length, patch, zodPatch }
}

export function runDependencyAudit() {
  const result = spawnSync(process.env.BUN_BIN || 'bun', ['audit', '--json'], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`Bun registry audit failed: ${result.error || result.stderr || result.status}`)
  }
  let report
  try { report = JSON.parse(result.stdout) } catch { throw new Error(`Bun registry audit did not return valid JSON: ${result.stderr || result.stdout}`) }
  if (result.status === 1 && Object.keys(report).length === 0) throw new Error('Bun registry audit failed without advisory details')
  const verified = evaluateAuditReport(report)
  console.log(`Registry audit: ${verified.rawFindings} finding(s); ${verified.verifiedBackports} covered by SHA-256 and behavior-verified dependency backports. All other advisories fail this gate.`)
  if (verified.rawFindings) console.log(`The registry findings remain open: ${advisoryUrl} and legacy Zod GHSA-mrhx-c7xc-m3w5; reviewed backports expire ${verified.patch.reviewBy}/${verified.zodPatch.reviewBy}. This is not a clean raw registry scan.`)
  return verified
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runDependencyAudit() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
