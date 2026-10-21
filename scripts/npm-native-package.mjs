#!/usr/bin/env node
// Build the public npm bootstrap package from an already verified source pack.
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']

export function validateNpmNativeManifest(manifest, version, sourceCommit, target) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.version !== version || manifest.sourceCommit !== sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit) || !manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) throw new Error('Invalid npm native release manifest identity')
  if (target && !supported.includes(target)) throw new Error(`Unsupported npm qualification target ${target}`)
  const required = target ? [target] : supported
  const actual = Object.keys(manifest.platforms).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...required].sort())) throw new Error(`npm native package requires exactly ${required.join(', ')}`)
  for (const platform of required) {
    const artifact = manifest.platforms[platform]
    if (!artifact || artifact.file !== `ur-${version}-${platform}.tar.gz` || artifact.executable !== 'ur' || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 1024 * 1024 * 1024) throw new Error(`Invalid npm native artifact ${platform}`)
  }
  return required
}

function safeSourceArchive(archive) {
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n')
  if (!names.length || names.length > 100_000) throw new Error('Invalid source package file count')
  for (const entry of names) {
    const name = entry.replace(/\/$/, '')
    if (!(name === 'package' || name.startsWith('package/')) || /[\\\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe source package entry ${entry}`)
  }
  const types = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n')
  if (types.some(line => !/^[-d]/.test(line))) throw new Error('Source package contains links or special files')
}

function pack(directory, destination, env) {
  const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
    cwd: directory, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const results = JSON.parse(output)
  if (!Array.isArray(results) || results.length !== 1 || typeof results[0].filename !== 'string' || basename(results[0].filename) !== results[0].filename) throw new Error('npm pack returned invalid package metadata')
  return join(destination, results[0].filename)
}

export function assembleNativeNpmPackage({ manifestPath, outDir, sourceTarball, target }) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const targets = validateNpmNativeManifest(manifest, version, sourceCommit, target)
  for (const platform of targets) {
    const artifact = manifest.platforms[platform]
    const path = join(dirname(resolve(manifestPath)), artifact.file)
    if (!lstatSync(path).isFile()) throw new Error(`Native archive is not a regular file: ${platform}`)
    const bytes = readFileSync(path)
    if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Native archive integrity failed: ${platform}`)
  }
  const work = mkdtempSync(join(tmpdir(), 'ur-native-npm-package-'))
  let temporaryOutput
  try {
    const userConfig = join(work, 'empty-user.npmrc')
    const globalConfig = join(work, 'empty-global.npmrc')
    writeFileSync(userConfig, '')
    writeFileSync(globalConfig, '')
    const env = { ...process.env, npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: join(work, 'npm-cache') }
    const sourceOutput = join(work, 'source')
    const packageOutput = join(work, 'packed')
    mkdirSync(sourceOutput)
    mkdirSync(packageOutput)
    const archive = sourceTarball ? resolve(sourceTarball) : pack(root, sourceOutput, env)
    safeSourceArchive(archive)
    execFileSync('tar', ['-xzf', archive, '-C', work], { env: { ...env, COPYFILE_DISABLE: '1' } })
    const directory = join(work, 'package')
    const metadataPath = join(directory, 'package.json')
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    if (metadata.name !== 'ur-agent' || metadata.version !== version || metadata.bin?.ur !== 'bin/ur.js') throw new Error('Source npm package identity does not match the release')
    const launcher = readFileSync(join(directory, 'bin', 'ur.js'), 'utf8')
    if (!launcher.includes('urDistribution') || !launcher.includes('./npm-native.mjs') || !lstatSync(join(directory, 'bin', 'npm-native.mjs')).isFile()) throw new Error('Source package is missing the native npm bootstrap')
    metadata.urDistribution = 'native'
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'scripts', 'overrides', 'patchedDependencies', 'packageManager', 'bundledDependencies', 'bundleDependencies']) delete metadata[key]
    metadata.engines = { node: metadata.engines?.node ?? '>=22.12' }
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    writeFileSync(join(directory, 'bin', 'native-release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const packed = pack(directory, packageOutput, env)
    const expectedName = `ur-agent-${version}.tgz`
    if (basename(packed) !== expectedName) throw new Error('Unexpected public npm package filename')
    const publishedMetadata = JSON.parse(execFileSync('tar', ['-xOf', packed, 'package/package.json'], { encoding: 'utf8' }))
    const publishedManifest = JSON.parse(execFileSync('tar', ['-xOf', packed, 'package/bin/native-release.json'], { encoding: 'utf8' }))
    if (publishedMetadata.urDistribution !== 'native' || JSON.stringify(publishedManifest) !== JSON.stringify(manifest)) throw new Error('Packed npm bootstrap metadata is missing or altered')
    execFileSync('tar', ['-xOf', packed, 'package/bin/npm-native.mjs'], { stdio: 'pipe' })
    mkdirSync(outDir, { recursive: true })
    temporaryOutput = join(outDir, `.ur-native-npm-${randomUUID()}.tgz`)
    copyFileSync(packed, temporaryOutput)
    const tarball = resolve(outDir, expectedName)
    renameSync(temporaryOutput, tarball)
    return { tarball, version, sourceCommit, targets, qualificationOnly: !!target }
  } finally {
    if (temporaryOutput && existsSync(temporaryOutput)) rmSync(temporaryOutput, { force: true })
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {}
  const names = { '--manifest': 'manifestPath', '--out-dir': 'outDir', '--source-tarball': 'sourceTarball', '--target': 'target' }
  for (let index = 0; index < args.length; index += 2) {
    if (!names[args[index]] || !args[index + 1] || args[index + 1].startsWith('--') || options[names[args[index]]]) throw new Error(`Invalid npm package option ${args[index]}`)
    options[names[args[index]]] = args[index + 1]
  }
  if (!options.manifestPath || !options.outDir) throw new Error('Usage: npm-native-package.mjs --manifest PATH --out-dir DIR [--source-tarball PATH] [--target PLATFORM]')
  console.log(JSON.stringify(assembleNativeNpmPackage(options)))
}
