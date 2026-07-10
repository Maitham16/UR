import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'

export type IdeDiffStatus = 'pending' | 'commented' | 'approved' | 'rejected'

export type IdeDiffComment = {
  at: string
  file?: string
  line?: number
  text: string
}

export type IdeDiffFile = {
  path: string
  additions: number
  deletions: number
  hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number }>
}

export type IdeDiffBundle = {
  id: string
  title: string
  status: IdeDiffStatus
  baseRef?: string
  staged?: boolean
  patchFile: string
  metadataFile: string
  files: IdeDiffFile[]
  comments: IdeDiffComment[]
  createdAt: string
  updatedAt: string
}

type Manifest = { version: 1; diffs: IdeDiffBundle[] }

const DIFF_ID_PATTERN = /^diff-[1-9][0-9]*$/u

export function ideDir(cwd: string): string {
  return join(cwd, '.ur', 'ide')
}

export function ideDiffsDir(cwd: string): string {
  return join(ideDir(cwd), 'diffs')
}

function patchesDir(cwd: string): string {
  return join(ideDiffsDir(cwd), 'patches')
}

function metadataDir(cwd: string): string {
  return join(ideDiffsDir(cwd), 'metadata')
}

function manifestPath(cwd: string): string {
  return join(ideDiffsDir(cwd), 'manifest.json')
}

function bundleArtifactPath(cwd: string, bundle: IdeDiffBundle, kind: 'patch' | 'metadata'): string | null {
  if (!DIFF_ID_PATTERN.test(bundle.id)) return null
  const relative = kind === 'patch' ? bundle.patchFile : bundle.metadataFile
  const expected = kind === 'patch' ? `patches/${bundle.id}.patch` : `metadata/${bundle.id}.json`
  if (relative.replaceAll('\\', '/') !== expected) return null
  const root = resolve(ideDiffsDir(cwd))
  const target = resolve(root, relative)
  return target.startsWith(`${root}${sep}`) ? target : null
}

function isValidBundle(cwd: string, value: unknown): value is IdeDiffBundle {
  if (!value || typeof value !== 'object') return false
  const bundle = value as IdeDiffBundle
  return Boolean(bundleArtifactPath(cwd, bundle, 'patch') && bundleArtifactPath(cwd, bundle, 'metadata'))
}

function now(): string {
  return new Date().toISOString()
}

function ensureDirs(cwd: string): void {
  mkdirSync(patchesDir(cwd), { recursive: true })
  mkdirSync(metadataDir(cwd), { recursive: true })
}

function loadManifest(cwd: string): Manifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, diffs: [] }
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' && Array.isArray((parsed as Manifest).diffs)
    ? { version: 1, diffs: (parsed as Manifest).diffs.filter(bundle => isValidBundle(cwd, bundle)) }
    : { version: 1, diffs: [] }
}

function saveManifest(cwd: string, manifest: Manifest): void {
  ensureDirs(cwd)
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
}

function nextId(manifest: Manifest): string {
  const max = manifest.diffs.reduce((m, diff) => {
    const match = /^diff-(\d+)$/u.exec(diff.id)
    return Math.max(m, match ? Number(match[1]) : 0)
  }, 0)
  return `diff-${max + 1}`
}

function parseHunkHeader(line: string): IdeDiffFile['hunks'][number] | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? '1'),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? '1'),
  }
}

export function parseUnifiedDiffFiles(diff: string): IdeDiffFile[] {
  const files: IdeDiffFile[] = []
  let current: IdeDiffFile | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line)
      current = {
        path: match?.[2] ?? line.replace(/^diff --git /u, ''),
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      files.push(current)
      continue
    }
    if (!current) continue
    const hunk = parseHunkHeader(line)
    if (hunk) {
      current.hunks.push(hunk)
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions++
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions++
  }
  return files
}

async function gitDiff(
  cwd: string,
  options: { baseRef?: string; staged?: boolean },
): Promise<{ diff: string; command: string[]; error?: string }> {
  const args = ['diff']
  if (options.staged) args.push('--cached')
  if (options.baseRef) args.push(`${options.baseRef}...HEAD`)
  else args.push('HEAD')
  const result = await execFileNoThrowWithCwd('git', args, {
    cwd,
    timeout: 60_000,
    preserveOutputOnError: true,
  })
  return {
    diff: result.stdout,
    command: ['git', ...args],
    error: result.code === 0 ? undefined : result.stderr || result.error,
  }
}

export async function createIdeDiffBundle(
  cwd: string,
  options: { title?: string; baseRef?: string; staged?: boolean; diff?: string } = {},
): Promise<{ bundle: IdeDiffBundle | null; command?: string[]; error?: string }> {
  const manifest = loadManifest(cwd)
  const id = nextId(manifest)
  const captured = options.diff
    ? { diff: options.diff, command: undefined, error: undefined }
    : await gitDiff(cwd, options)
  if (captured.error) return { bundle: null, command: captured.command, error: captured.error }
  if (!captured.diff.trim()) return { bundle: null, command: captured.command }

  ensureDirs(cwd)
  const createdAt = now()
  const patchFile = join('patches', `${id}.patch`)
  const metadataFile = join('metadata', `${id}.json`)
  const bundle: IdeDiffBundle = {
    id,
    title: options.title ?? 'Working tree diff',
    status: 'pending',
    baseRef: options.baseRef,
    staged: options.staged || undefined,
    patchFile,
    metadataFile,
    files: parseUnifiedDiffFiles(captured.diff),
    comments: [],
    createdAt,
    updatedAt: createdAt,
  }
  writeFileSync(join(ideDiffsDir(cwd), patchFile), captured.diff)
  writeFileSync(join(ideDiffsDir(cwd), metadataFile), `${JSON.stringify(bundle, null, 2)}\n`)
  manifest.diffs.push(bundle)
  saveManifest(cwd, manifest)
  return { bundle, command: captured.command }
}

export function listIdeDiffBundles(cwd: string): IdeDiffBundle[] {
  return loadManifest(cwd).diffs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getIdeDiffBundle(cwd: string, id: string): IdeDiffBundle | null {
  return loadManifest(cwd).diffs.find(diff => diff.id === id) ?? null
}

export function readIdeDiffPatch(cwd: string, id: string): string | null {
  const bundle = getIdeDiffBundle(cwd, id)
  if (!bundle) return null
  const path = bundleArtifactPath(cwd, bundle, 'patch')
  if (!path) return null
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function mutate(cwd: string, id: string, fn: (bundle: IdeDiffBundle) => void): IdeDiffBundle | null {
  const manifest = loadManifest(cwd)
  const bundle = manifest.diffs.find(diff => diff.id === id)
  if (!bundle) return null
  fn(bundle)
  bundle.updatedAt = now()
  ensureDirs(cwd)
  const metadataPath = bundleArtifactPath(cwd, bundle, 'metadata')
  if (!metadataPath) return null
  writeFileSync(metadataPath, `${JSON.stringify(bundle, null, 2)}\n`)
  saveManifest(cwd, manifest)
  return bundle
}

export function addIdeDiffComment(
  cwd: string,
  id: string,
  comment: { text: string; file?: string; line?: number },
): IdeDiffBundle | null {
  return mutate(cwd, id, bundle => {
    bundle.status = 'commented'
    bundle.comments.push({
      at: now(),
      file: comment.file,
      line: comment.line,
      text: comment.text,
    })
  })
}

export function setIdeDiffStatus(
  cwd: string,
  id: string,
  status: IdeDiffStatus,
): IdeDiffBundle | null {
  return mutate(cwd, id, bundle => {
    bundle.status = status
  })
}

export function deleteIdeDiffBundle(cwd: string, id: string): boolean {
  const manifest = loadManifest(cwd)
  const bundle = manifest.diffs.find(diff => diff.id === id)
  if (!bundle) return false
  const patchPath = bundleArtifactPath(cwd, bundle, 'patch')
  const metadataPath = bundleArtifactPath(cwd, bundle, 'metadata')
  if (!patchPath || !metadataPath) return false
  rmSync(patchPath, { force: true })
  rmSync(metadataPath, { force: true })
  manifest.diffs = manifest.diffs.filter(diff => diff.id !== id)
  saveManifest(cwd, manifest)
  return true
}

export function formatIdeDiffList(bundles: IdeDiffBundle[], json: boolean): string {
  if (json) return JSON.stringify({ diffs: bundles }, null, 2)
  if (bundles.length === 0) return 'No IDE diff bundles yet. Capture one with `ur ide diff capture`.'
  return [
    'IDE inline diff bundles',
    '',
    ...bundles.map(diff => {
      const files = `${diff.files.length} file${diff.files.length === 1 ? '' : 's'}`
      const comments = diff.comments.length ? `, ${diff.comments.length} comment(s)` : ''
      return `- ${diff.id} [${diff.status}] ${diff.title} (${files}${comments})`
    }),
  ].join('\n')
}

export function formatIdeDiffBundle(
  cwd: string,
  bundle: IdeDiffBundle,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify(
      {
        ...bundle,
        patch: readIdeDiffPatch(cwd, bundle.id),
      },
      null,
      2,
    )
  }
  const lines = [
    `IDE diff ${bundle.id}`,
    `Title:  ${bundle.title}`,
    `Status: ${bundle.status}`,
    `Patch:  .ur/ide/diffs/${bundle.patchFile}`,
    `Meta:   .ur/ide/diffs/${bundle.metadataFile}`,
  ]
  if (bundle.baseRef) lines.push(`Base:   ${bundle.baseRef}`)
  if (bundle.files.length) {
    lines.push('', 'Files:')
    for (const file of bundle.files) {
      lines.push(`  - ${file.path} (+${file.additions}/-${file.deletions}, ${file.hunks.length} hunk(s))`)
    }
  }
  if (bundle.comments.length) {
    lines.push('', 'Comments:')
    for (const comment of bundle.comments) {
      const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ''}: ` : ''
      lines.push(`  - ${where}${comment.text}`)
    }
  }
  return lines.join('\n')
}

export function formatIdeDiffSchema(): string {
  return JSON.stringify(
    {
      manifest: '.ur/ide/diffs/manifest.json',
      patchRoot: '.ur/ide/diffs/patches',
      metadataRoot: '.ur/ide/diffs/metadata',
      bundle: {
        id: 'diff-1',
        title: 'Working tree diff',
        status: 'pending | commented | approved | rejected',
        patchFile: 'patches/diff-1.patch',
        metadataFile: 'metadata/diff-1.json',
        files: [{ path: 'src/file.ts', additions: 1, deletions: 1, hunks: [] }],
        comments: [{ at: 'ISO-8601', file: 'src/file.ts', line: 12, text: 'Review note' }],
      },
    },
    null,
    2,
  )
}
