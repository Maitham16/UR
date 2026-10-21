#!/usr/bin/env node
// Run only this committed updater; never execute code downloaded from a release.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateHomebrewManifest, writeHomebrewTap } from './homebrew-tap.mjs'

const repository = 'Maitham16/UR'
export function stableReleaseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('A stable release version is required')
  return value
}

async function limitedBytes(response) {
  if (!response.ok || !response.body) throw new Error(`Public release request failed: HTTP ${response.status}`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('Public release metadata exceeds its size limit')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export function verifyReleaseManifest(path, version, commit) {
  const result = spawnSync('gh', [
    'attestation', 'verify', path, '--repo', repository,
    '--signer-workflow', `${repository}/.github/workflows/release.yml`,
    '--source-ref', `refs/tags/v${version}`, '--source-digest', commit,
    '--deny-self-hosted-runners', '--format', 'json',
  ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Native manifest provenance verification failed: ${result.error?.message ?? result.stderr}`)
}

export async function updateHomebrewTap({ version, directory = '.', request = fetch, verify = verifyReleaseManifest } = {}) {
  if (version) stableReleaseVersion(version)
  const api = `https://api.github.com/repos/${repository}/releases/${version ? `tags/v${version}` : 'latest'}`
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ur-homebrew-tap-updater' }
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  const release = JSON.parse((await limitedBytes(await request(api, { headers, signal: AbortSignal.timeout(30_000) }))).toString('utf8'))
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) throw new Error('Only published stable GitHub releases can update the tap')
  const selected = stableReleaseVersion(release.tag_name.slice(1))
  if (version && version !== selected) throw new Error('GitHub release version mismatch')
  const url = `https://github.com/${repository}/releases/download/v${selected}/manifest.json`
  const bytes = await limitedBytes(await request(url, { signal: AbortSignal.timeout(30_000) }))
  const manifest = validateHomebrewManifest(JSON.parse(bytes.toString('utf8')), { expectedVersion: selected })
  const work = mkdtempSync(join(tmpdir(), 'ur-tap-provenance-'))
  try {
    const path = join(work, 'manifest.json')
    writeFileSync(path, bytes, { mode: 0o600 })
    await verify(path, selected, manifest.sourceCommit)
    writeHomebrewTap(manifest, directory, { expectedVersion: selected, expectedCommit: manifest.sourceCommit, updateOnly: true })
    return { version: selected, sourceCommit: manifest.sourceCommit }
  } finally { rmSync(work, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--version')) throw new Error('Usage: node scripts/update-homebrew-tap.mjs [--version <stable version>]')
    console.log(JSON.stringify(await updateHomebrewTap({ version: args[1] || undefined })))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
