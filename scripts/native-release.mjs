#!/usr/bin/env node
// Archive exactly the directory tested on its native runner. Never rebuild here.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { zipSync } from 'fflate'

const args = process.argv.slice(2)
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']
// Windows packaging remains available only for explicit development builds.
const developmentPlatforms = [...platforms, 'win32-x64']
const input = resolve(arg('--input', join(root, 'dist-native')))
const output = resolve(arg('--out-dir', join(root, 'dist-release', 'native')))
mkdirSync(output, { recursive: true })
const selected = arg('--target', null)
if (selected && !developmentPlatforms.includes(selected)) throw new Error(`Unsupported target ${selected}`)
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('Cannot identify native release source commit')
const manifest = { schemaVersion: 1, version, sourceCommit, platforms: {} }
for (const platform of selected ? [selected] : readdirSync(input).filter(name => platforms.includes(name))) {
  const directory = join(input, platform)
  const executable = platform.startsWith('win32-') ? 'ur.exe' : 'ur'
  lstatSync(join(directory, executable))
  const resourceManifest = JSON.parse(readFileSync(join(directory, 'resources', 'manifest.json'), 'utf8'))
  if (resourceManifest.schemaVersion !== 1 || resourceManifest.version !== version || resourceManifest.platform !== platform) throw new Error(`Stale or mismatched native build for ${platform}`)
  const file = `ur-${version}-${platform}.${platform.startsWith('win32-') ? 'zip' : 'tar.gz'}`
  const archive = join(output, file)
  const files = {}
  function inspect(path) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Release contains link/special file: ${path}`)
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) inspect(join(path, child))
    else if (platform.startsWith('win32-')) files[relative(directory, path).replaceAll('\\', '/')] = readFileSync(path)
  }
  inspect(directory)
  if (platform.startsWith('win32-')) writeFileSync(archive, zipSync(files, { level: 6 }))
  else execFileSync('tar', ['-czf', archive, '-C', directory, executable, 'resources'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  const bytes = readFileSync(archive)
  manifest.platforms[platform] = { file, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, executable }
}
if (!Object.keys(manifest.platforms).length) throw new Error('No native release directories found')
// Per-platform manifests are merged only after every runner has passed.
const manifestName = selected ? `manifest-${selected}.json` : 'manifest.json'
writeFileSync(join(output, manifestName), `${JSON.stringify(manifest, null, 2)}\n`)
if (!selected) writeFileSync(join(output, 'SHA256SUMS'), Object.values(manifest.platforms).map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n')
console.log(`Packaged ${Object.keys(manifest.platforms).join(', ')} in ${output}`)
