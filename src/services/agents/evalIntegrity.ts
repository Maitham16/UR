import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { strictSubprocessEnv } from '../../utils/subprocessEnv.js'

export function validateEvalVerification(files: Record<string, string> = {}): [string, string][] {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Verification files must be a path/content object')
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length > 100) throw new Error('At most 100 verification files are supported')
  for (const [name, content] of entries) {
    if (!name || isAbsolute(name) || name.includes('\\') || name.includes('\0') || name.split('/').some(part => part === '..' || part === '.git' || part === '.' || !part) || normalize(name) !== name || typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new Error(`Invalid verification file: ${name}`)
  }
  return entries
}

/** Materialize the evaluator's original checks after the candidate has exited. */
export function prepareEvalVerification(files: Record<string, string> = {}) {
  const entries = validateEvalVerification(files)
  const directory = mkdtempSync(join(tmpdir(), 'ur-eval-verifier-'))
  const digest = createHash('sha256')
  try {
    for (const [name, content] of entries) {
      const path = join(directory, name)
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      writeFileSync(path, content, { mode: 0o600 })
      digest.update(JSON.stringify([name, content]))
    }
    return { directory, sha256: digest.digest('hex'), cleanup: () => rmSync(directory, { recursive: true, force: true }) }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
}

export function explicitCompletionClaim(output: string): 'pass' | 'fail' | 'partial' | 'unspecified' {
  const matches = [...output.matchAll(/^\s*VERDICT:\s*(PASS|FAIL|PARTIAL)\s*$/gim)]
  return matches.length ? matches[matches.length - 1][1].toLowerCase() as 'pass' | 'fail' | 'partial' : 'unspecified'
}

/** Snapshot the candidate's actual final diff, including new source files. */
export async function measureEvalDiff(cwd: string): Promise<{ filesChanged: number; insertions: number; deletions: number; patchSha256: string } | undefined> {
  const git = (args: string[]) => execFileNoThrowWithCwd('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', ...args], { cwd, timeout: 30000, preserveOutputOnError: true, env: strictSubprocessEnv(), extendEnv: false, maxBuffer: 16 * 1024 * 1024, audit: false })
  const diff = await git(['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', 'HEAD', '--'])
  const patch = await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z'])
  if (diff.code !== 0 || patch.code !== 0 || untracked.code !== 0) return undefined
  let filesChanged = 0, insertions = 0, deletions = 0
  const digest = createHash('sha256').update(patch.stdout)
  for (const record of diff.stdout.split('\0')) {
    const match = record.match(/^(\d+|-)\t(\d+|-)\t/)
    if (!match) continue
    filesChanged++
    if (match[1] !== '-') insertions += Number(match[1])
    if (match[2] !== '-') deletions += Number(match[2])
  }
  for (const name of untracked.stdout.split('\0').filter(Boolean).sort()) {
    if (name.startsWith('.ur/') || name.startsWith('.ur-eval-metrics-')) continue
    const path = join(cwd, name)
    let content: Buffer
    try {
      const stat = lstatSync(path)
      // Preserve unknown coverage instead of silently underreporting large or
      // concurrently removed files. Never follow links outside the candidate.
      if (stat.isSymbolicLink()) content = Buffer.from(readlinkSync(path))
      else if (stat.isFile() && stat.size <= 16 * 1024 * 1024) content = readFileSync(path)
      else return undefined
      digest.update(stat.isSymbolicLink() ? 'symlink' : 'file')
    } catch { return undefined }
    filesChanged++
    digest.update(JSON.stringify(name)).update(content)
    if (!content.includes(0) && content.length) insertions += content.toString('utf8').split('\n').length - (content[content.length - 1] === 10 ? 1 : 0)
  }
  return { filesChanged, insertions, deletions, patchSha256: digest.digest('hex') }
}
