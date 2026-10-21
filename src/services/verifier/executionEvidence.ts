import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const MAX_FILES = 20_000
const MAX_BYTES = 128 * 1024 * 1024

export type VerificationState = {
  root: string
  sha256: string
  files: Record<string, string>
  scope: 'git-visible' | 'workspace'
}

export type VerificationExecution = {
  version: 1
  id: string
  runId: string
  toolUseId: string
  command: string
  cwd: string
  startedAt: string
  finishedAt: string
  exitCode: number | null
  interrupted: boolean
  stdout: string
  stderr: string
  beforeStateSha256?: string
  afterStateSha256?: string
  changedFiles: string[]
  observationError?: string
}

export type VerificationEvidence = {
  version: 1
  runId: string
  cwd: string
  stateSha256?: string
  executions: VerificationExecution[]
  observationError?: string
}

// Runtime state is not implementation input. Spec inputs and verification
// policy are added explicitly below, including when Git ignores .ur entirely.
function excluded(path: string): boolean {
  const parts = path.split(/[\\/]/u)
  if (parts.includes('.git') || parts.includes('node_modules')) return true
  const ur = parts.indexOf('.ur')
  if (ur < 0) return false
  if (parts[ur + 1] === 'verify.json') return false
  return parts[ur + 1] !== 'specs' ||
    !['spec.json', 'requirements.md', 'design.md', 'tasks.md'].includes(parts.at(-1) ?? '')
}

async function walk(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const rel = relative(root, path)
    // .ur directories need traversal only for explicit specification inputs.
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      if (rel.split(/[\\/]/u).includes('.ur') &&
          !/^\.ur(?:[/\\]specs(?:[/\\][^/\\]+)?)?$/u.test(rel)) continue
      files.push(...await walk(root, path))
    } else if (!excluded(rel)) files.push(rel)
    if (files.length > MAX_FILES) throw new Error(`Verification state exceeds ${MAX_FILES} files`)
  }
  return files
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  return result.stdout
}

/** Exact content fingerprints, not mtimes or porcelain status alone. No writes. */
export async function captureVerificationState(cwd: string): Promise<VerificationState> {
  const directory = await realpath(cwd)
  let root = directory
  let scope: VerificationState['scope'] = 'workspace'
  let paths: string[]
  let revision = ''
  try {
    root = (await git(directory, ['rev-parse', '--show-toplevel'])).trim()
    root = await realpath(root)
    scope = 'git-visible'
  } catch { /* Non-Git workspaces are supported through a bounded tree scan. */ }
  if (scope === 'git-visible') {
    const [listed, head, flags] = await Promise.all([
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
      git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => 'unborn'),
      git(root, ['ls-files', '-v', '-z']),
    ])
    paths = listed.split('\0').filter(path => path && !excluded(path))
    revision = `${head}\0${flags.split('\0').filter(line => !excluded(line.slice(2))).join('\0')}`
    for (const extra of ['.ur/verify.json', '.ur/specs']) {
      const path = join(root, extra)
      try {
        if ((await lstat(path)).isDirectory()) paths.push(...await walk(root, path))
        else paths.push(extra)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  } else paths = await walk(root)
  paths = [...new Set(paths)].sort()
  if (paths.length > MAX_FILES) throw new Error(`Verification state exceeds ${MAX_FILES} files`)
  let bytes = 0
  const files: Record<string, string> = {}
  for (let offset = 0; offset < paths.length; offset += 32) {
    await Promise.all(paths.slice(offset, offset + 32).map(async path => {
      const absolute = resolve(root, path)
      const rel = relative(root, absolute)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
        throw new Error('Verification source escapes workspace')
      }
      try {
        const before = await lstat(absolute)
        if (before.isSymbolicLink()) {
          files[path] = `link:${hash(await readlink(absolute))}`
          return
        }
        if (!before.isFile()) throw new Error(`Unsupported verification source: ${path}`)
        bytes += before.size
        if (bytes > MAX_BYTES) throw new Error(`Verification state exceeds ${MAX_BYTES} bytes`)
        const content = await readFile(absolute)
        const after = await lstat(absolute)
        if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new Error(`Verification source changed while reading: ${path}`)
        }
        files[path] = `${before.mode & 0o111}:${hash(content)}`
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') files[path] = 'missing'
        else throw error
      }
    }))
  }
  const ordered = paths.map(path => [path, files[path]])
  return { root, files, scope, sha256: hash(JSON.stringify({ root, scope, revision, files: ordered })) }
}

export function changedVerificationFiles(before: VerificationState, after: VerificationState): string[] {
  if (before.root !== after.root) return []
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter(path => before.files[path] !== after.files[path])
    .map(path => join(after.root, path)).sort()
}

export function newVerificationEvidence(cwd: string): VerificationEvidence {
  return { version: 1, runId: randomUUID(), cwd: resolve(cwd), executions: [] }
}

export function isVerificationExecution(value: unknown): value is VerificationExecution {
  if (!value || typeof value !== 'object') return false
  const v = value as VerificationExecution
  return v.version === 1 && typeof v.id === 'string' && typeof v.runId === 'string' &&
    typeof v.toolUseId === 'string' && typeof v.command === 'string' &&
    typeof v.cwd === 'string' && typeof v.startedAt === 'string' && typeof v.finishedAt === 'string' &&
    (v.exitCode === null || Number.isInteger(v.exitCode)) && typeof v.interrupted === 'boolean' &&
    typeof v.stdout === 'string' && typeof v.stderr === 'string' && Array.isArray(v.changedFiles) &&
    v.changedFiles.every(path => typeof path === 'string')
}

export type PendingVerificationExecution = {
  runId: string
  toolUseId: string
  command: string
  cwd: string
  startedAt: string
  before?: VerificationState
  observationError?: string
}

/** Opt-in instrumentation for the existing verification child, never a gate. */
export async function beginVerificationExecution(
  toolName: string, toolUseId: string, input: unknown, cwd: string,
): Promise<PendingVerificationExecution | undefined> {
  const runId = process.env.UR_VERIFICATION_RUN_ID
  if (!runId || !['Bash', 'PowerShell'].includes(toolName)) return undefined
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return undefined
  const pending: PendingVerificationExecution = {
    runId, toolUseId, command, cwd: resolve(cwd), startedAt: new Date().toISOString(),
  }
  try {
    pending.cwd = await realpath(cwd)
    pending.before = await captureVerificationState(cwd)
  } catch (error) { pending.observationError = String(error) }
  return pending
}

export async function finishVerificationExecution(
  pending: PendingVerificationExecution | undefined,
  data: unknown,
  failed = false,
): Promise<VerificationExecution | undefined> {
  if (!pending) return undefined
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  let after: VerificationState | undefined
  let observationError = pending.observationError
  try { after = await captureVerificationState(pending.cwd) }
  catch (error) { observationError = String(error) }
  const exit = result.exitCode ?? result.code
  return {
    version: 1, id: pending.toolUseId, runId: pending.runId,
    toolUseId: pending.toolUseId, command: pending.command, cwd: pending.cwd,
    startedAt: pending.startedAt, finishedAt: new Date().toISOString(),
    exitCode: Number.isInteger(exit) ? exit as number : null,
    interrupted: failed || result.interrupted === true || Boolean(result.backgroundTaskId),
    stdout: typeof result.stdout === 'string' ? result.stdout.slice(-16_000) : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.slice(-8_000) : '',
    beforeStateSha256: pending.before?.sha256, afterStateSha256: after?.sha256,
    changedFiles: pending.before && after ? changedVerificationFiles(pending.before, after) : [],
    ...(observationError ? { observationError } : {}),
  }
}
