#!/usr/bin/env node
// Qualify a real npm installation against the exact native archive from CI.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleNativeNpmPackage } from './npm-native-package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index !== -1 && (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))) throw new Error(`Missing ${name} value`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const platform = option('--target', `${process.platform}-${process.arch}`)
assert.equal(platform, `${process.platform}-${process.arch}`, 'npm qualification must run on its real native target')
assert(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform), 'Unsupported public npm target')
const artifacts = resolve(option('--artifact-dir', 'dist-release/native'))
const manifestPath = join(artifacts, `manifest-${platform}.json`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const artifact = manifest.platforms[platform]
const temporaryBase = realpathSync.native(process.env.RUNNER_TEMP || tmpdir())
const work = mkdtempSync(join(temporaryBase, 'ur npm native smoke '))
const home = join(work, 'private home')
const workspace = join(work, 'workspace')
const tools = join(work, 'node only tools')
const prefix = join(work, 'npm prefix')
const cache = join(home, '.cache')
for (const directory of [home, workspace, tools, prefix]) mkdirSync(directory, { recursive: true })
symlinkSync(process.execPath, join(tools, 'node'))
const npm = (process.env.PATH ?? '').split(delimiter).map(path => join(path, 'npm')).find(path => existsSync(path))
if (!npm) throw new Error('npm is required by the npm installation qualification harness')
const npmCli = realpathSync(npm)
const emptyUserConfig = join(work, 'empty-user.npmrc')
const emptyGlobalConfig = join(work, 'empty-global.npmrc')
writeFileSync(emptyUserConfig, '')
writeFileSync(emptyGlobalConfig, '')
const env = {
  PATH: `${join(prefix, 'bin')}:${tools}:/usr/bin:/bin`, HOME: home, USERPROFILE: home,
  USER: 'ur-npm-smoke', LOGNAME: 'ur-npm-smoke', SHELL: '/bin/sh', TMPDIR: work,
  UR_CONFIG_DIR: join(home, '.ur'), XDG_CACHE_HOME: cache, XDG_DATA_HOME: join(home, '.local/share'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local/state'),
  UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
  TERM: 'dumb', NO_COLOR: '1', CI: '1', npm_config_cache: join(work, 'npm-cache'),
  npm_config_userconfig: emptyUserConfig, npm_config_globalconfig: emptyGlobalConfig,
}
const trace = []
const requests = []
function run(command, args, allowFailure = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timeout = false
    const timer = setTimeout(() => { timeout = true; try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 300_000)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (status, signal) => {
      clearTimeout(timer)
      const result = { command, args, status, signal, stdout, stderr, timeout }
      trace.push(result)
      writeFileSync(join(work, 'commands.json'), `${JSON.stringify(trace, null, 2)}\n`)
      if (timeout || signal || (!allowFailure && status !== 0)) reject(new Error(`npm native qualification failed: ${JSON.stringify(result)}`))
      else resolveRun(result)
    })
  })
}
let server
let passed = false
try {
  const packageInfo = assembleNativeNpmPackage({ manifestPath, outDir: join(work, 'package'), sourceTarball: option('--source-tarball'), target: platform })
  const installed = await run(process.execPath, [npmCli, 'install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--prefix', prefix, packageInfo.tarball])
  assert(!/protobufjs|requires Bun|install Bun/i.test(installed.stdout + installed.stderr), 'npm installed a runtime dependency or required Bun')
  const packageRoot = join(prefix, 'lib/node_modules/ur-agent')
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.urDistribution, 'native')
  assert.equal(packageJson.engines.bun, undefined)
  assert.equal(typeof packageJson.engines.node, 'string')
  assert.deepEqual(packageJson.os, ['darwin', 'linux'])
  assert.deepEqual(packageJson.cpu, ['arm64', 'x64'])
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'scripts', 'packageManager']) assert.equal(packageJson[field], undefined, `Public npm metadata includes ${field}`)
  assert.deepEqual(readdirSync(join(prefix, 'lib/node_modules')).filter(name => !name.startsWith('.')), ['ur-agent'])
  assert(!existsSync(join(packageRoot, 'node_modules')), 'Public npm package installed a dependency tree')
  const absentBun = await run('/bin/sh', ['-c', 'if command -v bun >/dev/null 2>&1; then exit 1; fi'])
  assert.equal(absentBun.status, 0)
  server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url })
    writeFileSync(join(work, 'requests.json'), `${JSON.stringify(requests, null, 2)}\n`)
    if (request.method !== 'GET' || request.url !== `/v${manifest.version}/${artifact.file}`) { response.writeHead(404).end(); return }
    const bytes = readFileSync(join(artifacts, artifact.file))
    response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': bytes.length })
    response.end(bytes)
  })
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  env.UR_NPM_NATIVE_BASE_URL = `http://127.0.0.1:${server.address().port}`
  const launcher = join(prefix, 'bin/ur')
  const first = await run(launcher, ['--version'])
  assert.equal(first.stdout, `${manifest.version} (UR-Nexus)\n`)
  assert.match(first.stderr, /downloading native/)
  assert.equal(requests.length, 1, 'First npm launch must download exactly one native archive')
  assert.match((await run(launcher, ['--help'])).stdout, /Usage: ur/)
  assert.equal(JSON.parse((await run(launcher, ['--ur-native-self-test'])).stdout).passed, true)
  const security = JSON.parse((await run(launcher, ['--ur-security-self-test'])).stdout)
  assert.equal(security.passed, true)
  assert.equal(security.checks.length, 7)
  const install = await run(launcher, ['install', 'latest'], true)
  assert.equal(install.status, 1, 'npm-owned explicit install must refuse with a failure status')
  assert.match(install.stdout + install.stderr, /npm install -g ur-agent@latest/)
  assert(!existsSync(join(home, '.local/bin/ur')), 'npm-owned explicit install created a second launcher')
  assert(!existsSync(join(home, '.local/share/ur/versions')), 'npm-owned explicit install created native versions')
  assert.equal(requests.length, 1, 'Cached npm commands downloaded the native payload again')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  server = undefined
  const offline = await run(launcher, ['--version'])
  assert.equal(offline.stdout, `${manifest.version} (UR-Nexus)\n`)
  assert(!/downloading/.test(offline.stderr), 'Offline cache launch attempted another download')
  assert.equal(JSON.parse((await run(launcher, ['--ur-native-self-test'])).stdout).passed, true)
  console.log(JSON.stringify({ passed: true, version: manifest.version, platform, nativeDownloads: requests.length,
    npmIgnoreScripts: true, runtimeDependencies: 0, bunOnPATH: false, offlineCachedLaunch: true, nativeResources: true, rsaChecks: 7,
    npmOwnsUpdates: true }))
  passed = true
} finally {
  if (server) await new Promise(resolveClose => server.close(resolveClose))
  if (passed) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  else console.error(`npm native qualification evidence retained at ${work}`)
}
