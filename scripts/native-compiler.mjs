// Pin the runtime used by CI and native releases. The verified Windows baseline
// ZIP avoids relying on npm tar extraction for the deferred Windows build path.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { rename as renameDirectory } from 'node:fs/promises'
import { unzipSync } from 'fflate'

export const NATIVE_BUN_VERSION = '1.4.3'
export const WINDOWS_BASELINE_COMPILER = Object.freeze({
  url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-windows-x64-baseline.zip',
  // https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/SHASUMS256.txt
  sha256: 'd7a7d3eb216614544aab0cde2d8d9f2e4e87839bf5a30a1cd11d077f02d84e0c',
  entry: 'bun-windows-x64-baseline/bun.exe',
  identity: 'bun-windows-x64-baseline-v1.4.3',
  revision: '1.4.3+c6da4a4d3',
})
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Windows scanners can retain a handle briefly after the version probe exits. */
export async function renameNativeBuildStage(source, destination, {
  platform = process.platform, rename = renameDirectory,
  now = Date.now, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  timeoutMs = 15000, retryDelayMs = 100, onRetry,
} = {}) {
  const deadline = now() + timeoutMs
  let attempts = 0
  while (true) {
    try { await rename(source, destination); return }
    catch (error) {
      const remaining = deadline - now()
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || remaining <= 0) throw error
      onRetry?.(error, ++attempts)
      await pause(Math.min(retryDelayMs, remaining))
    }
  }
}

export async function stagePinnedCompiler(artifact, cache, { request = fetch, verifyExecutable } = {}) {
  mkdirSync(cache, { recursive: true, mode: 0o700 })
  const archivePath = join(cache, `${artifact.identity}.zip`)
  let archive = existsSync(archivePath) ? readFileSync(archivePath) : undefined
  if (!archive || sha256(archive) !== artifact.sha256) {
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await request(artifact.url, { signal: AbortSignal.timeout(30_000) })
        if (!response.ok || !response.body) throw new Error(`Compiler download failed: HTTP ${response.status}`)
        if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) throw new Error('Compiler archive is too large')
        const chunks = []
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > MAX_ARCHIVE_BYTES) throw new Error('Compiler archive is too large')
          chunks.push(Buffer.from(chunk))
        }
        const downloaded = Buffer.concat(chunks)
        if (sha256(downloaded) !== artifact.sha256) throw new Error('Pinned compiler archive checksum mismatch')
        archive = downloaded
        const temporary = `${archivePath}.${randomUUID()}.tmp`
        writeFileSync(temporary, archive, { flag: 'wx', mode: 0o600 })
        renameSync(temporary, archivePath)
        break
      } catch (error) {
        lastError = error
        if (attempt === 3) throw new Error(`Unable to stage verified ${artifact.identity} after 3 attempts`, { cause: lastError })
        console.warn(`Retrying pinned compiler download (${attempt}/3): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const entries = unzipSync(new Uint8Array(archive), { filter: entry => {
    if (entry.name !== artifact.entry) return false
    if (entry.originalSize > MAX_EXECUTABLE_BYTES) throw new Error('Compiler executable is too large')
    return true
  } })
  const bytes = entries[artifact.entry]
  if (!bytes || bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('Compiler archive is missing its Windows executable')
  const binary = Buffer.from(bytes)
  const peOffset = binary.readUInt32LE(0x3c)
  if (peOffset < 64 || peOffset + 6 > binary.length || binary.readUInt32LE(peOffset) !== 0x00004550 || binary.readUInt16LE(peOffset + 4) !== 0x8664) throw new Error('Pinned compiler is not a Windows x64 PE executable')
  const executable = join(cache, `${artifact.identity}.exe`)
  if (!existsSync(executable) || sha256(readFileSync(executable)) !== sha256(bytes)) {
    const temporary = `${executable}.${randomUUID()}.tmp`
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o700 })
    renameSync(temporary, executable)
  }
  if (verifyExecutable) await verifyExecutable(executable, artifact)
  return executable
}

export async function prepareNativeCompileExecutable(target, cache) {
  if (target !== 'win32-x64') return undefined
  return stagePinnedCompiler(WINDOWS_BASELINE_COMPILER, cache, {
    verifyExecutable(executable, artifact) {
      const revision = execFileSync(executable, ['--revision'], { encoding: 'utf8', timeout: 30_000 }).trim()
      if (revision !== artifact.revision) throw new Error(`Unexpected baseline compiler revision: ${revision}`)
    },
  })
}
