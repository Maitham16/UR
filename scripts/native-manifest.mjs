#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
const directory = resolve(process.argv[2] ?? 'dist-release/native')
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const manifest = { schemaVersion: 1, version, sourceCommit, platforms: {} }
for (const name of readdirSync(directory).filter(name => /^manifest-.+\.json$/.test(name))) {
  const part = JSON.parse(readFileSync(join(directory, name), 'utf8'))
  if (part.schemaVersion !== 1 || part.version !== version || part.sourceCommit !== sourceCommit) throw new Error(`Invalid manifest ${name}`)
  for (const [platform, artifact] of Object.entries(part.platforms)) {
    if (!platforms.includes(platform) || manifest.platforms[platform]) throw new Error(`Unexpected or duplicate platform ${platform}`)
    if (artifact.file !== `ur-${version}-${platform}.tar.gz` || artifact.executable !== 'ur') throw new Error(`Invalid artifact ${platform}`)
    const bytes = readFileSync(join(directory, artifact.file))
    if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Artifact integrity check failed: ${platform}`)
    manifest.platforms[platform] = artifact
  }
}
for (const platform of platforms) if (!manifest.platforms[platform]) throw new Error(`Missing tested native target ${platform}`)
writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(directory, 'SHA256SUMS'), Object.values(manifest.platforms).map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n')
