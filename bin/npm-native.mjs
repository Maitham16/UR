// Published npm distributions launch a verified native release; no install hook.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createGunzip } from 'node:zlib'

const TARGETS = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
const MAX_ARCHIVE = 1024 * 1024 * 1024
const MAX_EXPANDED = 2 * MAX_ARCHIVE
const RECEIPT = '.ur-npm-install.json'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseNativeReleaseManifest(value, version) {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || version.length > 100 ||
      !plain(value) || value.schemaVersion !== 1 || value.version !== version ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !plain(value.platforms)) throw new Error('Invalid packaged native release manifest')
  const entries = Object.entries(value.platforms)
  if (!entries.length || entries.length > TARGETS.size) throw new Error('Packaged native release has no supported platforms')
  for (const [target, asset] of entries) {
    if (!TARGETS.has(target) || !plain(asset) || asset.file !== `ur-${version}-${target}.tar.gz` ||
        asset.executable !== 'ur' || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ARCHIVE) throw new Error(`Invalid packaged native artifact: ${target}`)
  }
  return value
}

export function nativeNpmPlatform() {
  const target = `${process.platform}-${process.arch}`
  if (!TARGETS.has(target)) throw new Error('UR native npm releases support macOS and Linux on x64 or arm64; standalone Windows is unavailable')
  if (process.platform === 'linux' && !process.report?.getReport().header.glibcVersionRuntime) {
    throw new Error('UR native npm releases require glibc on Linux; musl/Alpine is not supported')
  }
  return target
}

function archivePath(name) {
  const path = name.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  const invalid = path.split('/').some(part => !part || part === '.' || part === '..' ||
    /[<>:"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) ||
    /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(part.split('.')[0].replace(/ +$/, '')))
  if (!path || path.length > 16384 || invalid || !(path === 'ur' || path === 'resources' || path.startsWith('resources/'))) {
    throw new Error(`Unsafe native archive entry: ${name}`)
  }
  return path
}

const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
function tarText(bytes) {
  const end = bytes.indexOf(0)
  if (end >= 0 && bytes.subarray(end).some(byte => byte !== 0)) throw new Error('Invalid NUL-padded tar field')
  return utf8(end < 0 ? bytes : bytes.subarray(0, end))
}
function tarNumber(bytes) {
  const value = bytes.toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar numeric field')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Tar numeric field exceeds supported range')
  return number
}
function paxFields(bytes) {
  const fields = Object.create(null)
  const seen = new Set()
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset)
    const digits = bytes.subarray(offset, space < 0 ? offset : space).toString('ascii')
    if (!/^[1-9][0-9]{0,8}$/.test(digits)) throw new Error('Invalid PAX record length')
    const length = Number(digits), end = offset + length
    if (end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) throw new Error('Truncated PAX record')
    const record = bytes.subarray(space + 1, end - 1), equal = record.indexOf(61)
    if (equal < 1 || record.subarray(0, equal).some(byte => byte < 33 || byte > 126)) throw new Error('Invalid PAX record')
    const key = record.subarray(0, equal).toString('ascii')
    if (key === 'linkpath' || key.includes('sparse') || seen.has(key)) throw new Error('Unsupported PAX metadata')
    seen.add(key)
    // BSD tar can attach binary xattrs. Never apply these attributes; only
    // pathname/size affect our own extraction, and both are parsed strictly.
    if (key === 'path' || key === 'size') fields[key] = utf8(record.subarray(equal + 1))
    offset = end
  }
  return fields
}

class TarReader {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.chunk = Buffer.alloc(0); this.offset = 0; this.total = 0 }
  async read(size, allowEnd = false) {
    const output = Buffer.allocUnsafe(size)
    let written = 0
    while (written < size) {
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next()
        if (next.done) {
          if (!written && allowEnd) return null
          throw new Error('Truncated native tar archive')
        }
        this.chunk = next.value; this.offset = 0
      }
      const count = Math.min(size - written, this.chunk.length - this.offset)
      this.chunk.copy(output, written, this.offset, this.offset + count)
      this.offset += count; written += count; this.total += count
      if (this.total > MAX_EXPANDED) throw new Error('Native archive exceeds extraction limit')
    }
    return output
  }
}

/** Extract only regular files/directories. PAX/GNU name records never touch disk. */
export async function extractNativeTarGz(archive, destination, signal) {
  signal?.throwIfAborted()
  await mkdir(destination, { mode: 0o700 })
  const input = createReadStream(archive), stream = input.pipe(createGunzip())
  input.on('error', error => stream.destroy(error))
  const timeout = setTimeout(() => stream.destroy(new Error('Native extraction exceeded 120 seconds')), 120_000)
  timeout.unref()
  const abort = () => stream.destroy(new Error('Native installation interrupted'))
  signal?.addEventListener('abort', abort, { once: true })
  const reader = new TarReader(stream), files = Object.create(null), seen = new Set()
  let local = Object.create(null), global = Object.create(null), longName, ended = false
  try {
    for (;;) {
      const header = await reader.read(512, true)
      if (!header) break
      if (header.every(byte => byte === 0)) {
        if (!(await reader.read(512)).every(byte => byte === 0)) throw new Error('Invalid native tar terminator')
        for (let padding; (padding = await reader.read(512, true));) if (padding.some(byte => byte !== 0)) throw new Error('Unexpected data after native tar terminator')
        ended = true; break
      }
      const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
      if (checksum !== tarNumber(header.subarray(148, 156))) throw new Error('Native tar header checksum mismatch')
      const magic = header.subarray(257, 263).toString('ascii')
      if (magic !== 'ustar\0' && magic !== 'ustar ') throw new Error('Unsupported native tar format')
      const type = String.fromCharCode(header[156]), headerSize = tarNumber(header.subarray(124, 136))
      if (['x', 'g', 'L'].includes(type)) {
        if (headerSize > 1024 * 1024) throw new Error('Native tar metadata exceeds size limit')
        const bytes = await reader.read(headerSize)
        if (type === 'L') longName = tarText(bytes)
        else if (type === 'g') Object.assign(global, paxFields(bytes))
        else Object.assign(local, paxFields(bytes))
        if (headerSize % 512) await reader.read(512 - headerSize % 512)
        continue
      }
      if (!['0', '\0', '5'].includes(type) || header.subarray(157, 257).some(byte => byte !== 0)) throw new Error('Native archive contains a link or special file')
      const metadata = { ...global, ...local }, prefix = magic === 'ustar\0' ? tarText(header.subarray(345, 500)) : ''
      const path = archivePath(metadata.path ?? longName ?? (prefix ? `${prefix}/` : '') + tarText(header.subarray(0, 100)))
      const size = metadata.size === undefined ? headerSize : Number(metadata.size)
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED || (metadata.size !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(metadata.size))) throw new Error('Invalid native file size')
      if (seen.has(path) || seen.size >= 50_000) throw new Error('Duplicate or excessive native archive entries')
      seen.add(path); local = Object.create(null); longName = undefined
      const output = join(destination, path)
      if (type === '5') {
        if (size || path === 'ur') throw new Error('Invalid native directory entry')
        await mkdir(output, { recursive: true, mode: 0o755 })
      } else {
        if (path === 'resources') throw new Error('Native resources must be a directory')
        await mkdir(dirname(output), { recursive: true, mode: 0o755 })
        const mode = tarNumber(header.subarray(100, 108)) & 0o111 ? 0o755 : 0o644
        const file = await open(output, 'wx', mode), hash = createHash('sha256')
        try {
          for (let left = size; left > 0;) {
            const bytes = await reader.read(Math.min(left, 64 * 1024))
            await file.writeFile(bytes); hash.update(bytes); left -= bytes.length
          }
          await file.chmod(mode)
        } finally { await file.close() }
        files[path] = { size, sha256: hash.digest('hex'), mode }
      }
      if (size % 512) await reader.read(512 - size % 512)
    }
    if (!ended || Object.keys(local).length || longName !== undefined || !files.ur || !files['resources/manifest.json']) throw new Error('Incomplete native release archive')
    return files
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort); input.destroy(); stream.destroy()
  }
}

function downloadUrl(version, file) {
  const override = process.env.UR_NPM_NATIVE_BASE_URL
  if (!override) return new URL(`https://github.com/Maitham16/UR/releases/download/v${version}/${file}`)
  const base = new URL(override)
  if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) {
    throw new Error('UR_NPM_NATIVE_BASE_URL is restricted to an HTTP loopback test server')
  }
  return new URL(`${base.href.replace(/\/$/, '')}/v${version}/${file}`)
}

async function download(url, asset, destination, signal) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(180_000)])
  let response
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(url, { signal: deadline, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (process.env.UR_NPM_NATIVE_BASE_URL || !location || redirects === 5) throw new Error('Invalid native release download redirect')
    url = new URL(location, url)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Native release download must use HTTPS')
  }
  if (!response.ok || !response.body) throw new Error(`Native release download failed (HTTP ${response.status})`)
  const file = await open(destination, 'wx', 0o600), hash = createHash('sha256')
  let size = 0
  try {
    for await (const bytes of response.body) {
      size += bytes.length
      if (size > asset.size) throw new Error('Native release exceeds its packaged size')
      hash.update(bytes); await file.writeFile(bytes)
    }
  } finally { await file.close(); await response.body.cancel().catch(() => {}) }
  if (size !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Native release checksum or size mismatch')
}

async function cacheRoot() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  if (!isAbsolute(base)) throw new Error('XDG_CACHE_HOME must be an absolute directory')
  await mkdir(base, { recursive: true, mode: 0o700 })
  let directory = await realpath(base)
  for (const part of ['ur', 'npm']) {
    directory = join(directory, part)
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Native npm cache must be an owned directory, not a link')
    await chmod(directory, 0o700)
  }
  return directory
}

async function validCache(directory, manifest, target) {
  try {
    const root = await lstat(directory), receiptStat = await lstat(join(directory, RECEIPT))
    if (!root.isDirectory() || root.isSymbolicLink() || !receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 8 * 1024 * 1024) return false
    const receipt = JSON.parse(await readFile(join(directory, RECEIPT), 'utf8'))
    if (receipt.schemaVersion !== 1 || receipt.version !== manifest.version || receipt.platform !== target || receipt.sourceCommit !== manifest.sourceCommit || receipt.archiveSha256 !== manifest.platforms[target].sha256 || !plain(receipt.files)) return false
    const expected = new Set(Object.keys(receipt.files))
    if (!expected.has('ur') || !expected.has('resources/manifest.json') || expected.size > 50_000) return false
    async function inspect(path, relative = '') {
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || stat.mode & 0o022) throw new Error('Unsafe native cache file')
      if (stat.isDirectory()) {
        for (const name of await readdir(path)) await inspect(join(path, name), relative ? `${relative}/${name}` : name)
      } else {
        if (!stat.isFile()) throw new Error('Native cache contains a special file')
        if (relative === RECEIPT) return
        archivePath(relative)
        const entry = receipt.files[relative]
        if (!expected.delete(relative) || !plain(entry) || entry.size !== stat.size || !/^[a-f0-9]{64}$/.test(entry.sha256) || ![0o644, 0o755].includes(entry.mode) || (stat.mode & 0o777) !== entry.mode) throw new Error('Native cache content does not match its receipt')
        const hash = createHash('sha256')
        for await (const bytes of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(bytes)
        if (hash.digest('hex') !== entry.sha256) throw new Error('Native cache checksum mismatch')
      }
    }
    await inspect(directory)
    return expected.size === 0
  } catch { return false }
}

async function acquireLock(path, signal) {
  const deadline = Date.now() + 360_000, token = randomUUID()
  for (;;) {
    signal.throwIfAborted()
    try {
      const file = await open(path, 'wx', 0o600)
      let owned
      try {
        owned = await file.stat()
        await file.writeFile(JSON.stringify({ pid: process.pid, token }))
        await file.close()
      } catch (error) {
        await file.close().catch(() => {})
        if (owned) {
          try {
            const current = await lstat(path)
            if (current.ino === owned.ino && current.dev === owned.dev) await rm(path)
          } catch { /* Preserve the initialization error; never remove another lock. */ }
        }
        throw error
      }
      return async () => {
        try { if (JSON.parse(await readFile(path, 'utf8')).token === token) await rm(path) } catch { /* Do not remove another owner's lock. */ }
      }
    } catch (error) { if (error.code !== 'EEXIST') throw error }
    let stat
    try { stat = await lstat(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe native installation lock')
    try {
      const owner = JSON.parse(await readFile(path, 'utf8'))
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid lock owner')
      try { process.kill(owner.pid, 0) } catch (error) {
        if (error.code !== 'ESRCH') throw error
        const current = await lstat(path)
        if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs) await rm(path)
        continue
      }
    } catch (error) {
      if (error.code === 'ENOENT') continue
      if (Date.now() - stat.mtimeMs > 360_000) throw new Error('Native npm installation lock is invalid; remove it only when no UR installation is running')
    }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for another UR native download; retry after it finishes')
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 150)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}

async function verifyNative(executable, version, config, signal) {
  const env = { ...process.env, UR_CONFIG_DIR: config, DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
  const deadline = Date.now() + 120_000
  const run = args => new Promise((resolve, reject) => {
    signal.throwIfAborted()
    // Verification has no terminal input. Its own group lets cancellation
    // clean up any native self-test helpers together with the verifier.
    const child = spawn(executable, args, { env, cwd: dirname(config), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const output = [], errors = []
    let outputSize = 0, errorSize = 0, failure, killTimer, finished = false
    const stop = signal => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') child.kill(signal) }
    }
    const fail = error => {
      if (failure || finished) return
      failure = error
      stop('SIGTERM')
      killTimer = setTimeout(() => stop('SIGKILL'), 2_000)
      killTimer.unref()
    }
    const abort = () => fail(signal.reason ?? new Error('Native verification interrupted'))
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => fail(new Error('Native verification exceeded 120 seconds')), Math.max(0, deadline - Date.now()))
    timer.unref()
    const cleanup = () => { finished = true; clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort) }
    child.stdout.on('data', bytes => {
      outputSize += bytes.length
      if (outputSize > 2 * 1024 * 1024) fail(new Error('Native verification stdout exceeded its limit'))
      else output.push(bytes)
    })
    child.stderr.on('data', bytes => {
      errorSize += bytes.length
      if (errorSize > 2 * 1024 * 1024) fail(new Error('Native verification stderr exceeded its limit'))
      else errors.push(bytes)
    })
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', (code, childSignal) => {
      if (finished) return
      // The root can exit before a helper that ignored SIGTERM. Do not clear
      // the escalation timer until the remaining verification group is stopped.
      if (failure) stop('SIGKILL')
      cleanup()
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Native release verification failed (${childSignal ?? code}): ${Buffer.concat(errors).toString('utf8').slice(0, 4000)}`))
      else resolve(Buffer.concat(output).toString('utf8'))
    })
    if (signal.aborted) abort()
  })
  if ((await run(['--version'])).replace(/\r?\n$/, '') !== `${version} (UR-Nexus)`) throw new Error('Native release returned the wrong version')
  if (JSON.parse(await run(['--ur-native-self-test'])).passed !== true) throw new Error('Native release failed its resource self-test')
}

export async function ensureNpmNative(packageRoot, metadata, signal = new AbortController().signal) {
  const manifest = parseNativeReleaseManifest(JSON.parse(await readFile(join(packageRoot, 'bin', 'native-release.json'), 'utf8')), metadata.version)
  const target = nativeNpmPlatform(), asset = manifest.platforms[target]
  if (!asset) throw new Error(`UR ${metadata.version} does not include a native release for ${target}`)
  const root = await cacheRoot(), directory = join(root, `${metadata.version}-${target}`)
  if (await validCache(directory, manifest, target)) return join(directory, 'ur')
  const release = await acquireLock(`${directory}.lock`, signal)
  let stage, previous, activated = false
  try {
    if (await validCache(directory, manifest, target)) return join(directory, 'ur')
    stage = await mkdtemp(join(root, '.install-'))
    console.error(`UR-Nexus: downloading native ${metadata.version} for ${target}...`)
    const archive = join(stage, asset.file), extracted = join(stage, 'release')
    await download(downloadUrl(metadata.version, asset.file), asset, archive, signal)
    const files = await extractNativeTarGz(archive, extracted, signal)
    const resources = JSON.parse(await readFile(join(extracted, 'resources', 'manifest.json'), 'utf8'))
    if (resources.schemaVersion !== 1 || resources.version !== metadata.version || resources.platform !== target) throw new Error('Native executable resources have the wrong release identity')
    await chmod(join(extracted, 'ur'), 0o755)
    files.ur.mode = 0o755
    await verifyNative(join(extracted, 'ur'), metadata.version, join(stage, 'verification-config'), signal)
    signal.throwIfAborted()
    await writeReceipt(extracted, { schemaVersion: 1, version: metadata.version, platform: target, sourceCommit: manifest.sourceCommit, archiveSha256: asset.sha256, files })
    try { await lstat(directory); previous = `${directory}.corrupt-${randomUUID()}`; await rename(directory, previous) } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await rename(extracted, directory) } catch (error) {
      if (previous) await rename(previous, directory).catch(() => {})
      throw error
    }
    activated = true
    return join(directory, 'ur')
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {})
    if (previous && activated) await rm(previous, { recursive: true, force: true }).catch(() => {})
    await release()
  }
}

async function writeReceipt(directory, receipt) {
  const file = await open(join(directory, RECEIPT), 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(receipt)) } finally { await file.close() }
}

export async function launchNpmNative(packageRoot, metadata, args) {
  const controller = new AbortController()
  let interrupted
  const installing = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
    interrupted = signal
    controller.abort(new Error('Native installation interrupted'))
  }]))
  for (const [signal, handler] of installing) process.on(signal, handler)
  let executable
  try {
    executable = await ensureNpmNative(packageRoot, metadata, controller.signal)
    controller.signal.throwIfAborted()
  } catch (error) {
    for (const [signal, handler] of installing) process.off(signal, handler)
    if (interrupted) process.kill(process.pid, interrupted)
    throw error
  } finally { for (const [signal, handler] of installing) process.off(signal, handler) }
  const realRoot = await realpath(packageRoot)
  const child = spawn(executable, args, { cwd: process.cwd(), stdio: 'inherit', env: {
    ...process.env, UR_NPM_PACKAGE_ROOT: realRoot, UR_NPM_LAUNCHER_PATH: await realpath(join(realRoot, 'bin', 'ur.js')),
    UR_NPM_NODE_EXECUTABLE: await realpath(process.execPath), UR_NPM_NATIVE_EXECUTABLE: await realpath(executable),
    ...((process.env.OLLAMA_MODEL || process.env.UR_MODEL) ? { OLLAMA_MODEL: process.env.OLLAMA_MODEL || process.env.UR_MODEL } : {}),
  } })
  const signals = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      if (signal !== 'SIGINT' || !process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) child.kill(signal)
    }
    signals.set(signal, handler); process.on(signal, handler)
  }
  const cleanup = () => { for (const [signal, handler] of signals) process.off(signal, handler) }
  return await new Promise((resolve, reject) => {
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      cleanup()
      if (signal) process.kill(process.pid, signal)
      resolve(code ?? 1)
    })
  })
}
