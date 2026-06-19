/**
 * Verifiable artifacts surface.
 *
 * A reviewable record of what the agent produced — plans, diffs, test runs,
 * screenshots, browser recordings — stored under `.ur/artifacts/` with a status
 * (pending/approved/rejected) and threaded feedback. This gives a human an
 * auditable checkpoint before changes are trusted (Antigravity's Artifacts,
 * local-first) and threads into UR's provenance stack via optional links to the
 * claim ledger and trace. Manifest IO is deterministic; capture helpers take an
 * injectable command runner so they stay testable.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'

export type ArtifactKind =
  | 'plan'
  | 'diff'
  | 'test-run'
  | 'screenshot'
  | 'browser-recording'
  | 'note'

export type ArtifactStatus = 'pending' | 'approved' | 'rejected'

export type ArtifactFeedback = { at: string; text: string }

export type Artifact = {
  id: string
  kind: ArtifactKind
  title: string
  file?: string
  summary?: string
  status: ArtifactStatus
  feedback: ArtifactFeedback[]
  links?: { claims?: string[]; trace?: string }
  createdAt: string
  updatedAt: string
}

type Manifest = { version: 1; artifacts: Artifact[] }

export function artifactsDir(cwd: string): string {
  return join(cwd, '.ur', 'artifacts')
}

function manifestPath(cwd: string): string {
  return join(artifactsDir(cwd), 'manifest.json')
}

export function loadManifest(cwd: string): Manifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, artifacts: [] }
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' && Array.isArray((parsed as Manifest).artifacts)
    ? (parsed as Manifest)
    : { version: 1, artifacts: [] }
}

function saveManifest(cwd: string, manifest: Manifest): void {
  mkdirSync(artifactsDir(cwd), { recursive: true })
  writeFileSync(manifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
}

function nextId(manifest: Manifest): string {
  const max = manifest.artifacts.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0)
  return String(max + 1)
}

function slug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artifact'
}

const EXT: Record<ArtifactKind, string> = {
  plan: 'md',
  diff: 'patch',
  'test-run': 'log',
  screenshot: 'txt',
  'browser-recording': 'txt',
  note: 'md',
}

export type RecordArtifactInput = {
  kind: ArtifactKind
  title: string
  body?: string
  file?: string
  summary?: string
  links?: Artifact['links']
}

export function recordArtifact(cwd: string, input: RecordArtifactInput): Artifact {
  const manifest = loadManifest(cwd)
  const id = nextId(manifest)
  const now = new Date().toISOString()
  let file = input.file
  if (input.body !== undefined && !file) {
    const dir = join(artifactsDir(cwd), 'files')
    mkdirSync(dir, { recursive: true })
    const rel = join('files', `${id}-${slug(input.title)}.${EXT[input.kind]}`)
    writeFileSync(join(artifactsDir(cwd), rel), input.body)
    file = rel
  }
  const artifact: Artifact = {
    id,
    kind: input.kind,
    title: input.title,
    file,
    summary: input.summary,
    status: 'pending',
    feedback: [],
    links: input.links,
    createdAt: now,
    updatedAt: now,
  }
  manifest.artifacts.push(artifact)
  saveManifest(cwd, manifest)
  return artifact
}

export function listArtifacts(cwd: string): Artifact[] {
  return loadManifest(cwd).artifacts
}

export function getArtifact(cwd: string, id: string): Artifact | null {
  return loadManifest(cwd).artifacts.find(a => a.id === id) ?? null
}

export function readArtifactBody(cwd: string, id: string): string | null {
  const artifact = getArtifact(cwd, id)
  if (!artifact?.file) return null
  const path = join(artifactsDir(cwd), artifact.file)
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function mutate(cwd: string, id: string, fn: (a: Artifact) => void): Artifact | null {
  const manifest = loadManifest(cwd)
  const artifact = manifest.artifacts.find(a => a.id === id)
  if (!artifact) return null
  fn(artifact)
  artifact.updatedAt = new Date().toISOString()
  saveManifest(cwd, manifest)
  return artifact
}

export function setStatus(cwd: string, id: string, status: ArtifactStatus): Artifact | null {
  return mutate(cwd, id, a => {
    a.status = status
  })
}

export function addFeedback(cwd: string, id: string, text: string): Artifact | null {
  return mutate(cwd, id, a => {
    a.feedback.push({ at: new Date().toISOString(), text })
  })
}

export function deleteArtifact(cwd: string, id: string): boolean {
  const manifest = loadManifest(cwd)
  const artifact = manifest.artifacts.find(a => a.id === id)
  if (!artifact) return false
  if (artifact.file) rmSync(join(artifactsDir(cwd), artifact.file), { force: true })
  manifest.artifacts = manifest.artifacts.filter(a => a.id !== id)
  saveManifest(cwd, manifest)
  return true
}

export type CommandExec = (file: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>

const defaultExec: CommandExec = async (file, args, cwd) => {
  const r = await execFileNoThrowWithCwd(file, args, {
    cwd,
    timeout: 10 * 60 * 1000,
    preserveOutputOnError: true,
  })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr }
}

export async function captureDiff(
  cwd: string,
  title = 'Working tree diff',
  exec: CommandExec = defaultExec,
): Promise<Artifact | null> {
  const diff = await exec('git', ['diff', 'HEAD'], cwd)
  if (!diff.stdout.trim()) return null
  const files = (diff.stdout.match(/^\+\+\+ /gm) ?? []).length
  return recordArtifact(cwd, {
    kind: 'diff',
    title,
    body: diff.stdout,
    summary: `${files} file(s) changed`,
  })
}

export async function captureTestRun(
  cwd: string,
  command: string,
  exec: CommandExec = defaultExec,
): Promise<Artifact> {
  const parts = (command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map(p =>
    p.replace(/^["']|["']$/g, ''),
  )
  const run = await exec(parts[0] ?? '', parts.slice(1), cwd)
  return recordArtifact(cwd, {
    kind: 'test-run',
    title: `Test run: ${command}`,
    body: `$ ${command}\n\n${run.stdout}\n${run.stderr}`,
    summary: run.code === 0 ? 'passed' : `failed (exit ${run.code})`,
  })
}

const MARK: Record<ArtifactStatus, string> = { pending: '○', approved: '✓', rejected: '✗' }

export function formatArtifactList(artifacts: Artifact[], json: boolean): string {
  if (json) return JSON.stringify({ artifacts }, null, 2)
  if (artifacts.length === 0) {
    return 'No artifacts yet. Capture one with `ur artifacts capture-diff` or `ur artifacts add ...`.'
  }
  const lines = ['Artifacts', '']
  for (const a of artifacts) {
    lines.push(
      `${MARK[a.status]} ${a.id} [${a.kind}] ${a.title}${a.summary ? `  — ${a.summary}` : ''}${
        a.feedback.length ? `  (${a.feedback.length} note${a.feedback.length > 1 ? 's' : ''})` : ''
      }`,
    )
  }
  return lines.join('\n')
}

export function formatArtifact(artifact: Artifact, body: string | null, json: boolean): string {
  if (json) return JSON.stringify(artifact, null, 2)
  const lines = [
    `Artifact ${artifact.id} [${artifact.kind}]`,
    `Title:  ${artifact.title}`,
    `Status: ${artifact.status}`,
  ]
  if (artifact.summary) lines.push(`Summary: ${artifact.summary}`)
  if (artifact.file) lines.push(`File:   .ur/artifacts/${artifact.file}`)
  if (artifact.links?.claims?.length) lines.push(`Claims: ${artifact.links.claims.join(', ')}`)
  if (artifact.feedback.length) {
    lines.push('', 'Feedback:')
    for (const f of artifact.feedback) lines.push(`  - ${f.text}`)
  }
  if (body) {
    lines.push('', '---', body.slice(0, 2000))
  }
  return lines.join('\n')
}
