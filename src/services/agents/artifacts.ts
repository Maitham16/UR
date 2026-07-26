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
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import { strictSubprocessEnv } from '../../utils/subprocessEnv.js'
import {
  withPrivateStateLock,
  writePrivateTextAtomic,
} from '../../utils/privateState.js'

export type ArtifactKind =
  | 'plan'
  | 'diff'
  | 'test-run'
  | 'screenshot'
  | 'browser-recording'
  | 'note'

export type ArtifactStatus = 'pending' | 'approved' | 'rejected'

export type ArtifactFeedback = { at: string; text: string }

export type ArtifactAttachment = {
  path: string
  role: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export type Artifact = {
  id: string
  kind: ArtifactKind
  title: string
  file?: string
  summary?: string
  status: ArtifactStatus
  feedback: ArtifactFeedback[]
  attachments?: ArtifactAttachment[]
  links?: { claims?: string[]; trace?: string }
  createdAt: string
  updatedAt: string
}

type Manifest = { version: 1; artifacts: Artifact[] }

const ARTIFACT_ID_RE = /^[1-9][0-9]{0,15}$/
const MAX_ARTIFACTS = 100_000
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'plan',
  'diff',
  'test-run',
  'screenshot',
  'browser-recording',
  'note',
])
const ARTIFACT_STATUSES = new Set<ArtifactStatus>([
  'pending',
  'approved',
  'rejected',
])

export function artifactsDir(cwd: string): string {
  return join(cwd, '.ur', 'artifacts')
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validStoredPath(id: string, value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0') ||
    isAbsolute(value)
  ) {
    return false
  }
  const normalized = value.replaceAll('\\', '/')
  const current =
    normalized.startsWith(`files/${id}/`) &&
    !normalized.split('/').some(segment => segment === '..' || segment === '')
  const legacy = new RegExp(
    `^files/${id}-[a-z0-9](?:[a-z0-9-]{0,39})\\.(?:md|patch|log|txt)$`,
    'u',
  ).test(normalized)
  return current || legacy
}

function validAttachment(id: string, value: unknown): value is ArtifactAttachment {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Partial<ArtifactAttachment>
  return (
    validStoredPath(id, attachment.path) &&
    typeof attachment.role === 'string' &&
    attachment.role.length > 0 &&
    attachment.role.length <= 80 &&
    typeof attachment.mimeType === 'string' &&
    attachment.mimeType.length <= 120 &&
    safeArtifactMimeType(attachment.mimeType) === attachment.mimeType &&
    Number.isSafeInteger(attachment.sizeBytes) &&
    (attachment.sizeBytes ?? -1) >= 0 &&
    (attachment.sizeBytes ?? Infinity) <= MAX_ARTIFACT_ATTACHMENT_BYTES &&
    typeof attachment.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(attachment.sha256)
  )
}

function validArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== 'object') return false
  const artifact = value as Partial<Artifact>
  if (
    typeof artifact.id !== 'string' ||
    !ARTIFACT_ID_RE.test(artifact.id) ||
    !ARTIFACT_KINDS.has(artifact.kind as ArtifactKind) ||
    typeof artifact.title !== 'string' ||
    artifact.title.length === 0 ||
    artifact.title.length > 500 ||
    (artifact.summary !== undefined &&
      (typeof artifact.summary !== 'string' || artifact.summary.length > 4_000)) ||
    !ARTIFACT_STATUSES.has(artifact.status as ArtifactStatus) ||
    !Array.isArray(artifact.feedback) ||
    artifact.feedback.length > 1_000 ||
    !artifact.feedback.every(
      item =>
        item &&
        typeof item === 'object' &&
        validDate(item.at) &&
        typeof item.text === 'string' &&
        item.text.length > 0 &&
        item.text.length <= 4_000,
    ) ||
    !validDate(artifact.createdAt) ||
    !validDate(artifact.updatedAt) ||
    (artifact.file !== undefined &&
      !validStoredPath(artifact.id, artifact.file)) ||
    (artifact.attachments !== undefined &&
      (!Array.isArray(artifact.attachments) ||
        artifact.attachments.length > 1_000 ||
        !artifact.attachments.every(item =>
          validAttachment(artifact.id!, item),
        )))
  ) {
    return false
  }
  if (artifact.links !== undefined) {
    if (!artifact.links || typeof artifact.links !== 'object') return false
    const claims = artifact.links.claims
    if (
      claims !== undefined &&
      (!Array.isArray(claims) ||
        claims.length > 1_000 ||
        !claims.every(
          claim => typeof claim === 'string' && claim.length <= 500,
        ))
    ) {
      return false
    }
    if (
      artifact.links.trace !== undefined &&
      (typeof artifact.links.trace !== 'string' ||
        artifact.links.trace.length > 4_096)
    ) {
      return false
    }
  }
  return true
}

function parseManifest(value: unknown): Manifest {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Partial<Manifest>).version !== 1 ||
    !Array.isArray((value as Partial<Manifest>).artifacts) ||
    (value as Partial<Manifest>).artifacts!.length > MAX_ARTIFACTS ||
    !(value as Partial<Manifest>).artifacts!.every(validArtifact)
  ) {
    throw new Error('Artifact manifest failed schema validation')
  }
  const manifest = value as Manifest
  if (new Set(manifest.artifacts.map(artifact => artifact.id)).size !== manifest.artifacts.length) {
    throw new Error('Artifact manifest contains duplicate ids')
  }
  // safeParseJSON memoizes small manifests; mutations must never alter the
  // cached parse when an operation is only previewed or later rolls back.
  return structuredClone(manifest)
}

function ensureArtifactsDirectory(cwd: string): void {
  const urDir = join(cwd, '.ur')
  mkdirSync(urDir, { recursive: true, mode: 0o700 })
  const urInfo = lstatSync(urDir)
  if (urInfo.isSymbolicLink() || !urInfo.isDirectory()) {
    throw new Error(`Unsafe artifact state directory: ${urDir}`)
  }
  const root = artifactsDir(cwd)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootInfo = lstatSync(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`Unsafe artifact state directory: ${root}`)
  }
}

function manifestPath(cwd: string): string {
  return join(artifactsDir(cwd), 'manifest.json')
}

export function loadManifest(cwd: string): Manifest {
  const path = manifestPath(cwd)
  if (!existsSync(path)) return { version: 1, artifacts: [] }
  ensureArtifactsDirectory(cwd)
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Unsafe artifact manifest: ${path}`)
  }
  if (info.size > MAX_MANIFEST_BYTES) {
    throw new Error('Artifact manifest exceeds its 32 MiB safety limit')
  }
  return parseManifest(safeParseJSON(readFileSync(path, 'utf-8'), false))
}

function saveManifest(cwd: string, manifest: Manifest): void {
  ensureArtifactsDirectory(cwd)
  parseManifest(manifest)
  writePrivateTextAtomic(
    artifactsDir(cwd),
    manifestPath(cwd),
    `${JSON.stringify(manifest, null, 2)}\n`,
    MAX_MANIFEST_BYTES,
  )
}

function nextId(manifest: Manifest): string {
  const max = manifest.artifacts.reduce((m, a) => Math.max(m, Number(a.id) || 0), 0)
  return String(max + 1)
}

function reserveArtifactDirectory(cwd: string): { id: string; dir: string } {
  ensureArtifactsDirectory(cwd)
  const root = artifactsDir(cwd)
  return withPrivateStateLock(root, 'manifest', () => {
    const manifest = loadManifest(cwd)
    if (manifest.artifacts.length >= MAX_ARTIFACTS) {
      throw new Error(`Artifact manifest is limited to ${MAX_ARTIFACTS} entries`)
    }
    const filesRoot = join(root, 'files')
    mkdirSync(filesRoot, { recursive: true, mode: 0o700 })
    const filesInfo = lstatSync(filesRoot)
    if (!filesInfo.isDirectory() || filesInfo.isSymbolicLink()) {
      throw new Error('Unsafe artifact files directory')
    }
    let id = nextId(manifest)
    let dir = join(filesRoot, id)
    while (existsSync(dir)) {
      id = String(Number(id) + 1)
      if (!ARTIFACT_ID_RE.test(id)) {
        throw new Error('Artifact id space is exhausted')
      }
      dir = join(filesRoot, id)
    }
    mkdirSync(dir, { mode: 0o700 })
    return { id, dir }
  })
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

const MAX_ARTIFACT_ATTACHMENT_BYTES = 256 * 1024 * 1024
const MAX_ARTIFACT_TOTAL_ATTACHMENT_BYTES = 512 * 1024 * 1024
const MAX_ARTIFACT_PREVIEW_BYTES = 2 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.patch': 'text/x-diff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
}

function inferredMimeType(file: string): string {
  return MIME_BY_EXTENSION[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function safeArtifactMimeType(value: string): string {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(
    value,
  )
    ? value.toLowerCase()
    : 'application/octet-stream'
}

function safeAttachmentName(file: string): string {
  const clean = basename(file)
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return clean.slice(0, 120) || 'attachment.bin'
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  )
}

function hashFile(path: string): string {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export type RecordArtifactInput = {
  kind: ArtifactKind
  title: string
  body?: string
  file?: string
  summary?: string
  links?: Artifact['links']
  attachments?: Array<{
    file: string
    role?: string
    mimeType?: string
  }>
}

export function recordArtifact(cwd: string, input: RecordArtifactInput): Artifact {
  const title = input.title.trim()
  if (!title || title.length > 500) {
    throw new Error('Artifact title must contain 1–500 characters')
  }
  if (input.summary !== undefined && input.summary.length > 4_000) {
    throw new Error('Artifact summary exceeds 4000 characters')
  }
  const { id, dir } = reserveArtifactDirectory(cwd)
  const now = new Date().toISOString()
  const root = artifactsDir(cwd)
  let file: string | undefined
  const attachments: ArtifactAttachment[] = []
  let totalAttachmentBytes = 0

  const copyAttachment = (
    source: string,
    role: string,
    mimeType?: string,
  ): string => {
    const sourcePath = resolve(source)
    const sourceStat = lstatSync(sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`Artifact attachment must be a regular non-symlink file: ${source}`)
    }
    let name = safeAttachmentName(sourcePath)
    let destination = join(dir, name)
    for (let suffix = 2; existsSync(destination); suffix++) {
      const extension = extname(name)
      const stem = name.slice(0, Math.max(0, name.length - extension.length))
      destination = join(dir, `${stem}-${suffix}${extension}`)
    }
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
    const sourceFd = openSync(sourcePath, constants.O_RDONLY | noFollow)
    let destinationFd: number | undefined
    let copiedBytes = 0
    const attachmentHash = createHash('sha256')
    try {
      const openedStat = fstatSync(sourceFd)
      const currentPathStat = lstatSync(sourcePath)
      if (
        !openedStat.isFile() ||
        currentPathStat.isSymbolicLink() ||
        !currentPathStat.isFile() ||
        openedStat.dev !== currentPathStat.dev ||
        openedStat.ino !== currentPathStat.ino
      ) {
        throw new Error(
          `Artifact attachment changed or became unsafe while opening: ${source}`,
        )
      }
      if (openedStat.size > MAX_ARTIFACT_ATTACHMENT_BYTES) {
        throw new Error(`Artifact attachment exceeds 256 MiB: ${source}`)
      }
      destinationFd = openSync(
        destination,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          noFollow,
        0o600,
      )
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      for (;;) {
        const bytes = readSync(sourceFd, buffer, 0, buffer.length, null)
        if (bytes === 0) break
        copiedBytes += bytes
        if (copiedBytes > MAX_ARTIFACT_ATTACHMENT_BYTES) {
          throw new Error(`Artifact attachment exceeds 256 MiB: ${source}`)
        }
        if (
          totalAttachmentBytes + copiedBytes >
          MAX_ARTIFACT_TOTAL_ATTACHMENT_BYTES
        ) {
          throw new Error('Artifact attachments exceed the 512 MiB total limit')
        }
        attachmentHash.update(buffer.subarray(0, bytes))
        let offset = 0
        while (offset < bytes) {
          const written = writeSync(
            destinationFd,
            buffer,
            offset,
            bytes - offset,
          )
          if (written <= 0) throw new Error('Failed to copy artifact attachment')
          offset += written
        }
      }
      fsyncSync(destinationFd)
    } catch (error) {
      if (destinationFd !== undefined) {
        closeSync(destinationFd)
        destinationFd = undefined
      }
      rmSync(destination, { force: true })
      throw error
    } finally {
      closeSync(sourceFd)
      if (destinationFd !== undefined) closeSync(destinationFd)
    }
    totalAttachmentBytes += copiedBytes
    chmodSync(destination, 0o600)
    const rel = relative(root, destination)
    attachments.push({
      path: rel,
      role: role.slice(0, 80) || 'attachment',
      mimeType: safeArtifactMimeType(
        (mimeType ?? inferredMimeType(sourcePath)).slice(0, 120),
      ),
      sizeBytes: copiedBytes,
      sha256: attachmentHash.digest('hex'),
    })
    return rel
  }

  try {
    if (input.file) {
      file = copyAttachment(input.file, 'primary')
    } else if (input.body !== undefined) {
      const bodyBytes = Buffer.byteLength(input.body, 'utf8')
      if (bodyBytes > MAX_ARTIFACT_ATTACHMENT_BYTES) {
        throw new Error('Artifact body exceeds 256 MiB')
      }
      if (
        totalAttachmentBytes + bodyBytes >
        MAX_ARTIFACT_TOTAL_ATTACHMENT_BYTES
      ) {
        throw new Error('Artifact attachments exceed the 512 MiB total limit')
      }
      const rel = join(
        'files',
        id,
        `${slug(title)}.${EXT[input.kind]}`,
      )
      const destination = join(root, rel)
      writeFileSync(destination, input.body, { mode: 0o600 })
      const sizeBytes = statSync(destination).size
      totalAttachmentBytes += sizeBytes
      attachments.push({
        path: rel,
        role: 'primary',
        mimeType: safeArtifactMimeType(inferredMimeType(destination)),
        sizeBytes,
        sha256: hashFile(destination),
      })
      file = rel
    }
    for (const attachment of input.attachments ?? []) {
      const copied = copyAttachment(
        attachment.file,
        attachment.role ?? 'attachment',
        attachment.mimeType,
      )
      file ??= copied
    }
    const artifact: Artifact = {
      id,
      kind: input.kind,
      title,
      file,
      summary: input.summary,
      status: 'pending',
      feedback: [],
      ...(attachments.length ? { attachments } : {}),
      links: input.links,
      createdAt: now,
      updatedAt: now,
    }
    if (!validArtifact(artifact)) {
      throw new Error('Artifact failed schema validation')
    }
    withPrivateStateLock(root, 'manifest', () => {
      const manifest = loadManifest(cwd)
      if (manifest.artifacts.some(existing => existing.id === id)) {
        throw new Error(`Artifact id collision: ${id}`)
      }
      if (manifest.artifacts.length >= MAX_ARTIFACTS) {
        throw new Error(`Artifact manifest is limited to ${MAX_ARTIFACTS} entries`)
      }
      manifest.artifacts.push(artifact)
      saveManifest(cwd, manifest)
    })
    return artifact
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
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
  const opened = openArtifactAttachment(cwd, artifact.file)
  if (!opened) return null
  try {
    const previewBytes = Math.min(opened.sizeBytes, MAX_ARTIFACT_PREVIEW_BYTES)
    const buffer = Buffer.allocUnsafe(previewBytes)
    let bytesRead = 0
    while (bytesRead < previewBytes) {
      const count = readSync(
        opened.fd,
        buffer,
        bytesRead,
        previewBytes - bytesRead,
        bytesRead,
      )
      if (count === 0) break
      bytesRead += count
    }
    const preview = buffer.subarray(0, bytesRead).toString('utf8')
    return opened.sizeBytes > MAX_ARTIFACT_PREVIEW_BYTES
      ? `${preview}\n\n[Preview truncated at ${MAX_ARTIFACT_PREVIEW_BYTES} bytes. Use the raw download for the complete artifact.]`
      : preview
  } finally {
    closeSync(opened.fd)
  }
}

export type OpenArtifactAttachment = {
  fd: number
  path: string
  sizeBytes: number
}

function storedArtifactId(path: string): string | null {
  const normalized = path.replaceAll('\\', '/')
  return (
    /^files\/([1-9][0-9]{0,15})\//u.exec(normalized)?.[1] ??
    /^files\/([1-9][0-9]{0,15})-/u.exec(normalized)?.[1] ??
    null
  )
}

/**
 * Open a stored artifact once and keep using that descriptor. This closes the
 * validate-then-reopen race for the local review server.
 */
export function openArtifactAttachment(
  cwd: string,
  attachmentPath: string,
): OpenArtifactAttachment | null {
  const id = storedArtifactId(attachmentPath)
  if (!id || !validStoredPath(id, attachmentPath)) return null
  ensureArtifactsDirectory(cwd)
  const root = artifactsDir(cwd)
  const candidate = resolve(root, attachmentPath.replaceAll('\\', '/'))
  if (!pathIsWithin(resolve(root), candidate) || !existsSync(candidate)) {
    return null
  }
  const relativePath = relative(root, candidate)
  const segments = relativePath.split(sep)
  let current = root
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]!)
    const info = lstatSync(current)
    if (info.isSymbolicLink()) return null
    if (index < segments.length - 1 && !info.isDirectory()) return null
    if (index === segments.length - 1 && !info.isFile()) return null
  }
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  let fd: number | undefined
  try {
    fd = openSync(candidate, constants.O_RDONLY | noFollow)
    const opened = fstatSync(fd)
    const currentInfo = lstatSync(candidate)
    const realRoot = realpathSync(root)
    const realCandidate = realpathSync(candidate)
    if (
      !opened.isFile() ||
      currentInfo.isSymbolicLink() ||
      !currentInfo.isFile() ||
      opened.dev !== currentInfo.dev ||
      opened.ino !== currentInfo.ino ||
      opened.size > MAX_ARTIFACT_ATTACHMENT_BYTES ||
      !pathIsWithin(realRoot, realCandidate)
    ) {
      closeSync(fd)
      return null
    }
    return { fd, path: realCandidate, sizeBytes: opened.size }
  } catch {
    if (fd !== undefined) closeSync(fd)
    return null
  }
}

export function artifactAttachmentAbsolutePath(
  cwd: string,
  attachmentPath: string,
): string | null {
  const opened = openArtifactAttachment(cwd, attachmentPath)
  if (!opened) return null
  closeSync(opened.fd)
  return opened.path
}

function deletionDirectory(cwd: string, id: string): string | null {
  const root = artifactsDir(cwd)
  const realRoot = realpathSync(root)
  const filesRoot = resolve(root, 'files')
  if (!existsSync(filesRoot)) return null
  const filesInfo = lstatSync(filesRoot)
  if (filesInfo.isSymbolicLink() || !filesInfo.isDirectory()) {
    throw new Error('Unsafe artifact files directory')
  }
  const realFilesRoot = realpathSync(filesRoot)
  if (!pathIsWithin(realRoot, realFilesRoot)) {
    throw new Error('Artifact files directory escapes its storage root')
  }
  const directory = resolve(filesRoot, id)
  if (!pathIsWithin(filesRoot, directory)) {
    throw new Error('Artifact deletion target escapes its storage root')
  }
  if (!existsSync(directory)) return null
  const directoryInfo = lstatSync(directory)
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error('Unsafe artifact deletion directory')
  }
  const realDirectory = realpathSync(directory)
  if (!pathIsWithin(realFilesRoot, realDirectory)) {
    throw new Error('Artifact deletion directory escapes its files root')
  }
  return realDirectory
}

function pathExistsWithoutFollowing(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function assertQuarantinedFile(
  quarantineRoot: string,
  relativePath: string,
): void {
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Artifact file escapes its quarantined directory')
  }
  const segments = relativePath.split(sep).filter(Boolean)
  let current = quarantineRoot
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]!)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new Error('Artifact quarantine contains a symbolic link')
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error('Artifact quarantine contains an invalid directory')
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new Error('Artifact quarantine contains an invalid file')
    }
  }
}

function mutate(cwd: string, id: string, fn: (a: Artifact) => void): Artifact | null {
  ensureArtifactsDirectory(cwd)
  return withPrivateStateLock(artifactsDir(cwd), 'manifest', () => {
    const manifest = loadManifest(cwd)
    const artifact = manifest.artifacts.find(a => a.id === id)
    if (!artifact) return null
    fn(artifact)
    artifact.updatedAt = new Date().toISOString()
    if (!validArtifact(artifact)) {
      throw new Error('Artifact mutation failed schema validation')
    }
    saveManifest(cwd, manifest)
    return structuredClone(artifact)
  })
}

export function setStatus(cwd: string, id: string, status: ArtifactStatus): Artifact | null {
  return mutate(cwd, id, a => {
    a.status = status
  })
}

export function addFeedback(cwd: string, id: string, text: string): Artifact | null {
  const clean = text.trim()
  if (!clean || clean.length > 4_000) {
    throw new Error('Artifact feedback must contain 1–4000 characters')
  }
  return mutate(cwd, id, a => {
    if (a.feedback.length >= 1_000) {
      throw new Error('Artifact feedback is limited to 1000 entries')
    }
    a.feedback.push({ at: new Date().toISOString(), text: clean })
  })
}

export function deleteArtifact(cwd: string, id: string): boolean {
  if (!ARTIFACT_ID_RE.test(id)) {
    throw new Error('Invalid artifact id')
  }
  ensureArtifactsDirectory(cwd)
  const root = artifactsDir(cwd)
  const quarantined = withPrivateStateLock(root, 'manifest', () => {
    const manifest = loadManifest(cwd)
    const found = manifest.artifacts.find(a => a.id === id)
    if (!found) return null
    const artifactDirectory = deletionDirectory(cwd, id)
    const unresolvedFilesRoot = resolve(root, 'files')
    const filesRoot = pathExistsWithoutFollowing(unresolvedFilesRoot)
      ? realpathSync(unresolvedFilesRoot)
      : unresolvedFilesRoot
    const paths = new Set([
      ...(found.file ? [found.file] : []),
      ...(found.attachments?.map(attachment => attachment.path) ?? []),
    ])
    const safeFiles = [...paths].map(path => {
      const absolute = artifactAttachmentAbsolutePath(cwd, path)
      if (!absolute) {
        throw new Error(`Unsafe or missing artifact file: ${path}`)
      }
      return absolute
    })
    const currentFiles = artifactDirectory
      ? safeFiles.filter(path => pathIsWithin(artifactDirectory, path))
      : []
    const legacyFiles = safeFiles.filter(
      path => !artifactDirectory || !pathIsWithin(artifactDirectory, path),
    )
    if (safeFiles.length > 0 && !artifactDirectory && legacyFiles.length === 0) {
      throw new Error('Artifact files have no safe deletion target')
    }
    if (
      legacyFiles.some(
        path =>
          dirname(path) !== filesRoot ||
          !pathIsWithin(filesRoot, path),
      )
    ) {
      throw new Error('Legacy artifact file escapes its files root')
    }

    const nonce = randomUUID()
    const moved: Array<{
      source: string
      destination: string
      recursive: boolean
    }> = []
    try {
      if (artifactDirectory) {
        const destination = join(
          filesRoot,
          `.delete-${id}-${nonce}`,
        )
        renameSync(artifactDirectory, destination)
        moved.push({
          source: artifactDirectory,
          destination,
          recursive: true,
        })
        const directoryStat = lstatSync(destination)
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
          throw new Error('Artifact deletion quarantine is unsafe')
        }
        for (const file of currentFiles) {
          assertQuarantinedFile(
            destination,
            relative(artifactDirectory, file),
          )
        }
      }

      legacyFiles.forEach((source, index) => {
        const destination = join(
          filesRoot,
          `.delete-${id}-${nonce}-${index}`,
        )
        renameSync(source, destination)
        moved.push({ source, destination, recursive: false })
        const fileStat = lstatSync(destination)
        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
          throw new Error('Legacy artifact deletion quarantine is unsafe')
        }
      })

      manifest.artifacts = manifest.artifacts.filter(a => a.id !== id)
      saveManifest(cwd, manifest)
      return moved
    } catch (error) {
      for (const entry of [...moved].reverse()) {
        try {
          if (
            pathExistsWithoutFollowing(entry.destination) &&
            !pathExistsWithoutFollowing(entry.source)
          ) {
            renameSync(entry.destination, entry.source)
          }
        } catch {
          // Preserve the original failure. Quarantined entries remain inside
          // the private artifact files root and are never followed recursively.
        }
      }
      throw error
    }
  })
  if (!quarantined) return false
  for (const entry of quarantined) {
    rmSync(entry.destination, {
      recursive: entry.recursive,
      force: true,
    })
  }
  return true
}

export type CommandExec = (file: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>

const defaultExec: CommandExec = async (file, args, cwd) => {
  const r = await execFileNoThrowWithCwd(file, args, {
    cwd,
    timeout: 10 * 60 * 1000,
    preserveOutputOnError: true,
    env: strictSubprocessEnv(),
    extendEnv: false,
  })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr }
}

export async function getWorkingDiff(
  cwd: string,
  exec: CommandExec = defaultExec,
): Promise<string> {
  const diff = await exec(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      'HEAD',
      '--',
    ],
    cwd,
  )
  return diff.stdout
}

export async function captureDiff(
  cwd: string,
  title = 'Working tree diff',
  exec: CommandExec = defaultExec,
): Promise<Artifact | null> {
  const stdout = await getWorkingDiff(cwd, exec)
  if (!stdout.trim()) return null
  const files = (stdout.match(/^\+\+\+ /gm) ?? []).length
  return recordArtifact(cwd, {
    kind: 'diff',
    title,
    body: stdout,
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
  if (artifact.attachments?.length) {
    lines.push(`Attachments: ${artifact.attachments.length}`)
  }
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
