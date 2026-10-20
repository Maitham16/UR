/** Public native releases. No npm, Bun installation, or source tree is needed. */
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, open, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { getUserBinDir, getXDGDataHome } from './xdg.js'

export const NATIVE_RELEASE_REPOSITORY = 'Maitham16/UR'
export const NATIVE_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'] as const
export type NativePlatform = typeof NATIVE_PLATFORMS[number]
export type NativeArtifact = { file: string; sha256: string; size: number; executable: 'ur' | 'ur.exe' }
export type NativeManifest = { schemaVersion: 1; version: string; sourceCommit: string; platforms: Partial<Record<NativePlatform, NativeArtifact>> }
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/
const MAX_ARCHIVE_SIZE = 1024 * 1024 * 1024
type FileRetryOptions = { timeoutMs?: number; now?: () => number; wait?: (milliseconds: number) => Promise<void> }

export function getNativeInstallDirectories(overrides: { binDir?: string; dataDir?: string } = {}): { binDir: string; dataDir: string } {
  function directory(value: string, name: string): string {
    if (!isAbsolute(value) || /[\0\r\n"]/.test(value) || (process.platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(value))) {
      throw new Error(`${name} must be an absolute native installation directory`)
    }
    return resolve(value)
  }
  return {
    binDir: directory(overrides.binDir ?? process.env.UR_NATIVE_BIN_DIR ?? getUserBinDir(), 'UR_NATIVE_BIN_DIR'),
    dataDir: directory(overrides.dataDir ?? process.env.UR_NATIVE_DATA_DIR ?? join(getXDGDataHome(), 'ur'), 'UR_NATIVE_DATA_DIR'),
  }
}

/** Windows scanners can retain handles briefly after verification or writes. */
export async function retryWindowsFileOperation<T>(operation: () => Promise<T>, windows: boolean, options: FileRetryOptions = {}): Promise<T> {
  if (!windows) return operation()
  const now = options.now ?? (() => performance.now())
  const wait = options.wait ?? (milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds)))
  const timeout = options.timeoutMs ?? 15_000
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('Invalid Windows filesystem retry timeout')
  const deadline = now() + Math.min(timeout, 15_000)
  let attempts = 0
  for (;;) {
    try { return await operation() }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      const remaining = deadline - now()
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(String(code)) || remaining <= 0) throw error
      await wait(Math.min(50 * ++attempts, 250, remaining))
    }
  }
}

/** Releasing the install lock must not depend on successful staging cleanup. */
export async function cleanupNativeInstallation(staging: string, lock: string, windows: boolean, options: FileRetryOptions & { remove?: (path: string) => Promise<void> } = {}): Promise<void> {
  const remove = options.remove ?? (path => rm(path, { recursive: true, force: true }))
  let stagingError: unknown
  try { await retryWindowsFileOperation(() => remove(staging), windows, options) }
  catch (error) { stagingError = error }
  try { await retryWindowsFileOperation(() => remove(lock), windows, options) }
  catch (error) {
    if (stagingError) throw new AggregateError([stagingError, error], 'Native staging cleanup and install lock removal failed')
    throw error
  }
  if (stagingError) throw stagingError
}

export function validateNativeVersion(value: unknown): string {
  if (typeof value !== 'string' || !VERSION.test(value) || value.length > 100) throw new Error('Invalid native release version')
  return value
}

export function nativePlatform(platform = process.platform, arch = process.arch): NativePlatform {
  const key = `${platform}-${arch}`
  if (!NATIVE_PLATFORMS.includes(key as NativePlatform)) throw new Error(`Native releases do not support ${key}`)
  if (platform === 'linux' && typeof process.report?.getReport === 'function') {
    const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
    if (!report.header?.glibcVersionRuntime) throw new Error('Native Linux releases currently require glibc; musl is not yet supported')
  }
  return key as NativePlatform
}

export function parseNativeManifest(value: unknown, version: string): NativeManifest {
  validateNativeVersion(version)
  const manifest = value as NativeManifest
  if (!manifest || manifest.schemaVersion !== 1 || manifest.version !== version || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) throw new Error('Invalid native release manifest')
  for (const [platform, artifact] of Object.entries(manifest.platforms)) {
    if (!NATIVE_PLATFORMS.includes(platform as NativePlatform) || !artifact || typeof artifact !== 'object') throw new Error('Unsupported manifest platform')
    const windows = platform.startsWith('win32-')
    const expected = `ur-${version}-${platform}.${windows ? 'zip' : 'tar.gz'}`
    if (artifact.file !== expected || artifact.executable !== (windows ? 'ur.exe' : 'ur') || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > MAX_ARCHIVE_SIZE) throw new Error(`Invalid native artifact for ${platform}`)
  }
  if (Object.keys(manifest.platforms).length === 0) throw new Error('Native release has no artifacts')
  return manifest
}

export async function fetchNativeVersion(target = 'latest', request: typeof fetch = fetch): Promise<string> {
  if (target !== 'latest' && target !== 'stable') return validateNativeVersion(target.replace(/^v/, ''))
  // Both public channels select GitHub's latest non-prerelease release.
  const response = await request(`https://api.github.com/repos/${NATIVE_RELEASE_REPOSITORY}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Unable to check native releases (HTTP ${response.status})`)
  const body = await response.json() as { tag_name?: unknown; draft?: boolean; prerelease?: boolean }
  if (body.draft || body.prerelease || typeof body.tag_name !== 'string' || !body.tag_name.startsWith('v')) throw new Error('Invalid stable release response')
  return validateNativeVersion(body.tag_name.slice(1))
}

export function nativeAssetUrl(version: string, file: string): string {
  validateNativeVersion(version)
  if (basename(file) !== file || !/^[A-Za-z0-9._-]+$/.test(file)) throw new Error('Invalid release asset name')
  return `https://github.com/${NATIVE_RELEASE_REPOSITORY}/releases/download/v${version}/${file}`
}

export async function fetchNativeManifest(version: string, request: typeof fetch = fetch): Promise<NativeManifest> {
  const response = await request(nativeAssetUrl(version, 'manifest.json'), { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Native manifest unavailable for ${version} (HTTP ${response.status})`)
  return parseNativeManifest(await response.json(), version)
}

export function validateArchiveEntry(entry: string): string {
  const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  const unsafeComponent = normalized.split('/').some(part => {
    const deviceName = part.split('.')[0]!.replace(/ +$/, '')
    return !part || part === '..' || part === '.' || /[<>:"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(deviceName)
  })
  if (!normalized || normalized.startsWith('/') || unsafeComponent || !(normalized === 'ur' || normalized === 'ur.exe' || normalized === 'resources' || normalized.startsWith('resources/'))) throw new Error(`Unsafe native archive entry: ${entry}`)
  return normalized
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Native installation command failed: ${command}: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}

export async function extractNativeArchive(archive: string, destination: string, windows: boolean): Promise<void> {
  await mkdir(destination, { recursive: true })
  if (windows) {
    let expanded = 0
    const entries = unzipSync(new Uint8Array(await readFile(archive)), { filter: entry => {
      validateArchiveEntry(entry.name)
      expanded += entry.originalSize
      if (!Number.isSafeInteger(expanded) || expanded > 2 * MAX_ARCHIVE_SIZE) throw new Error('Native archive exceeds extraction size limit')
      return true
    } }) as Record<string, Uint8Array>
    for (const [name, bytes] of Object.entries(entries)) {
      const relative = validateArchiveEntry(name)
      const path = join(destination, relative)
      if (name.endsWith('/')) await mkdir(path, { recursive: true })
      else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }
    }
  } else {
    for (const entry of run('tar', ['-tzf', archive]).trim().split('\n')) validateArchiveEntry(entry)
    // Releases contain regular files/directories only. Reject links/devices before extraction.
    if (run('tar', ['-tvzf', archive]).trim().split('\n').some(line => !/^[-d]/.test(line))) throw new Error('Native archive contains unsupported file types')
    run('tar', ['-xzf', archive, '-C', destination, '--no-same-owner'])
  }
  // Do not trust archive layout alone: all resources must stay within the release.
  async function inspect(path: string): Promise<void> {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Native release contains a link or special file')
    if (entry.isDirectory()) for (const child of await readdir(path)) await inspect(join(path, child))
  }
  await inspect(destination)
}

/** Atomically replace launcher. Keeping the old name until rename also handles equal-sized binaries. */
export async function activateNativeRelease(executable: string, launcher: string, windows: boolean, dataDir?: string): Promise<void> {
  await mkdir(dirname(launcher), { recursive: true })
  const temporary = `${launcher}.tmp.${randomUUID()}`
  try {
    if (windows) {
      const directories = getNativeInstallDirectories({ binDir: dirname(launcher), dataDir: dataDir ?? dirname(dirname(dirname(executable))) })
      if (/[\0\r\n"]/.test(executable)) throw new Error('Unsupported installation path')
      const escape = (value: string) => value.replace(/%/g, '%%')
      await writeFile(temporary, `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@"%SystemRoot%\\System32\\chcp.com" 65001 >nul\r\n@set "UR_NATIVE_BIN_DIR=${escape(directories.binDir)}"\r\n@set "UR_NATIVE_DATA_DIR=${escape(directories.dataDir)}"\r\n"${escape(executable)}" %*\r\n`, { mode: 0o755 })
    } else await symlink(executable, temporary)
    await retryWindowsFileOperation(() => rename(temporary, launcher), windows)
  } finally { await retryWindowsFileOperation(() => rm(temporary, { force: true }), windows).catch(() => {}) }
}

async function acquireInstallLock(lock: string, windows: boolean): Promise<void> {
  try { await mkdir(lock) }
  catch { throw new Error(`Another native installation is active. If no installer is running, remove ${lock} and retry.`) }
  try { await writeFile(join(lock, 'owner.pid'), `${process.pid}\n`) }
  catch (error) { await retryWindowsFileOperation(() => rm(lock, { recursive: true, force: true }), windows).catch(() => {}); throw error }
}

async function activeNativeExecutable(launcher: string, windows: boolean): Promise<string | null> {
  try {
    if (!windows) return resolve(dirname(launcher), await readlink(launcher))
    const match = (await readFile(launcher, 'utf8')).match(/^"([^"\r\n]+)" %\*\r?$/m)
    return match ? resolve(match[1]!.replace(/%%/g, '%')) : null
  } catch { return null }
}

export async function installNativeRelease(target = 'latest', options: { force?: boolean; dataDir?: string; binDir?: string; platform?: NativePlatform; request?: typeof fetch; verify?: (executable: string, version: string) => void } = {}): Promise<{ latestVersion: string; wasUpdated: boolean }> {
  const request = options.request ?? fetch
  const version = await fetchNativeVersion(target, request)
  const platform = options.platform ?? nativePlatform()
  const { binDir, dataDir } = getNativeInstallDirectories(options)
  const versions = join(dataDir, 'versions')
  const windows = platform.startsWith('win32-')
  const executableName = windows ? 'ur.exe' : 'ur'
  const launcher = join(binDir, windows ? 'ur.cmd' : 'ur')
  if (windows) for (const name of ['ur.exe', 'ur.ps1']) {
    const conflict = join(dirname(launcher), name)
    try { await lstat(conflict) } catch { continue }
    throw new Error(`Existing ${conflict} would hide the native launcher. Move that previous installation aside and retry.`)
  }
  const canonicalDirectory = join(versions, `${version}-${platform}`)
  let releaseDir = canonicalDirectory
  let executable = join(releaseDir, executableName)
  const verify = options.verify ?? ((path: string, expected: string) => {
    if (run(path, ['--version']).trim() !== `${expected} (UR-Nexus)`) throw new Error('Downloaded executable failed version verification')
    const result = JSON.parse(run(path, ['--ur-native-self-test'])) as { passed?: boolean }
    if (result.passed !== true) throw new Error('Downloaded executable failed resource verification')
  })
  await mkdir(versions, { recursive: true })
  const lock = join(versions, '.install-lock')
  await acquireInstallLock(lock, windows)
  const staging = join(versions, `.staging-${randomUUID()}`)
  let installationFailed = false
  try {
    const previousExecutable = await activeNativeExecutable(launcher, windows)
    let installed = false
    // A repaired immutable release is a valid cache too. Avoid repeatedly
    // downloading when its original canonical directory was corrupt.
    if (previousExecutable) {
      const path = relative(versions, previousExecutable).split(/[\\/]/)
      if (path.length === 2 && path[1] === executableName && (path[0] === `${version}-${platform}` || path[0]!.startsWith(`${version}-${platform}-repair-`))) {
        try {
          await lstat(previousExecutable)
          await lstat(join(dirname(previousExecutable), 'resources', 'manifest.json'))
          verify(previousExecutable, version)
          releaseDir = dirname(previousExecutable)
          executable = previousExecutable
          installed = true
        } catch { /* try the canonical cached version below */ }
      }
    }
    try {
      if (!installed) {
        await lstat(executable)
        await lstat(join(releaseDir, 'resources', 'manifest.json'))
        verify(executable, version)
        installed = true
      }
    } catch { /* download missing/invalid version */ }
    if (!installed || options.force) {
      const manifest = await fetchNativeManifest(version, request)
      const artifact = manifest.platforms[platform]
      if (!artifact) throw new Error(`Release ${version} does not include ${platform}`)
      // Preserve any existing release, including a running executable. Repair
      // and force installs get a fresh immutable directory.
      try {
        await lstat(canonicalDirectory)
        releaseDir = `${canonicalDirectory}-repair-${randomUUID()}`
        executable = join(releaseDir, artifact.executable)
      } catch { /* new release */ }
      await mkdir(staging)
      const response = await request(nativeAssetUrl(version, artifact.file), { signal: AbortSignal.timeout(300_000) })
      if (!response.ok) throw new Error(`Native download failed (HTTP ${response.status})`)
      if (!response.body) throw new Error('Native download has no response body')
      const reader = response.body.getReader()
      const archive = join(staging, artifact.file)
      const output = await open(archive, 'wx', 0o600)
      const hash = createHash('sha256')
      let downloaded = 0
      try {
        for (;;) {
          const result = await reader.read()
          if (result.done) break
          downloaded += result.value.byteLength
          if (downloaded > artifact.size) throw new Error('Native download exceeds declared size')
          hash.update(result.value)
          let offset = 0
          while (offset < result.value.byteLength) {
            const written = await output.write(result.value, offset, result.value.byteLength - offset)
            if (written.bytesWritten === 0) throw new Error('Native download could not be written to disk')
            offset += written.bytesWritten
          }
        }
      } finally { await output.close(); await reader.cancel().catch(() => {}) }
      if (downloaded !== artifact.size || hash.digest('hex') !== artifact.sha256) throw new Error('Native release checksum or size mismatch')
      const extracted = join(staging, 'release')
      await extractNativeArchive(archive, extracted, windows)
      const stagedExecutable = join(extracted, artifact.executable)
      await chmod(stagedExecutable, 0o755)
      await lstat(join(extracted, 'resources', 'manifest.json'))
      verify(stagedExecutable, version)
      // Unique immutable version directories; no active binary is overwritten.
      await retryWindowsFileOperation(() => rename(extracted, releaseDir), windows)
    }
    await activateNativeRelease(executable, launcher, windows, dataDir)
    if (!windows && resolve(dirname(launcher), await readlink(launcher)) !== resolve(executable)) throw new Error('Native launcher activation failed')
    return { latestVersion: version, wasUpdated: !installed || !!options.force || previousExecutable !== executable }
  } catch (error) {
    installationFailed = true
    throw error
  } finally {
    try { await cleanupNativeInstallation(staging, lock, windows) }
    catch (error) { if (!installationFailed) throw error }
  }
}
