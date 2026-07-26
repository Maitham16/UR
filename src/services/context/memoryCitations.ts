import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { TaskMemoryEntry } from './projectContextManifest.js'

export type FileMemoryCitation = {
  kind: 'file'
  path: string
  startLine: number
  endLine: number
  excerptDigest: string
  capturedAt: string
  commit?: string
  blobOid?: string
}

export type RunMemoryCitation = {
  kind: 'run'
  runId: string
  artifactPath: string
  contentDigest: string
  capturedAt: string
}

export type UserMemoryCitation = {
  kind: 'user'
  sessionId: string
  messageId: string
  capturedAt: string
}

export type WebMemoryCitation = {
  kind: 'web'
  url: string
  accessedAt: string
  contentDigest?: string
  title?: string
}

export type MemoryCitation =
  | FileMemoryCitation
  | RunMemoryCitation
  | UserMemoryCitation
  | WebMemoryCitation

export type CitationFreshness = 'fresh' | 'stale' | 'missing' | 'unverifiable'

export type CitationValidation = {
  citation: MemoryCitation
  freshness: CitationFreshness
  reason: string
  currentDigest?: string
}

export type ResolvedMemory = {
  entry: TaskMemoryEntry
  citations: CitationValidation[]
  freshness: CitationFreshness
}

const MAX_CITATIONS = 16
const MAX_SOURCE_BYTES = 8 * 1024 * 1024
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const SAFE_ID_RE = /^[a-zA-Z0-9._-]{1,200}$/
const SENSITIVE_QUERY_KEY_RE =
  /(?:token|secret|password|passphrase|api[_-]?key|auth|credential|signature|(?:^|[_-])sig(?:$|[_-])|(?:^|[_-])code(?:$|[_-])|(?:^|[_-])key(?:$|[_-])|policy|x-amz-(?:credential|signature|security-token))/i
const SECRET_LIKE_QUERY_VALUE_RE =
  /^(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+\S{12,}|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})$/i

function digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isMemoryCitation(value: unknown): value is MemoryCitation {
  if (!value || typeof value !== 'object') return false
  const citation = value as Partial<MemoryCitation>
  if (citation.kind === 'file') {
    const file = citation as Partial<FileMemoryCitation>
    return (
      typeof file.path === 'string' &&
      file.path.length > 0 &&
      file.path.length <= 4096 &&
      Number.isSafeInteger(file.startLine) &&
      Number.isSafeInteger(file.endLine) &&
      (file.startLine ?? 0) >= 1 &&
      (file.endLine ?? 0) >= (file.startLine ?? 1) &&
      (file.endLine ?? 0) - (file.startLine ?? 1) <= 10_000 &&
      typeof file.excerptDigest === 'string' &&
      DIGEST_RE.test(file.excerptDigest) &&
      validDate(file.capturedAt) &&
      (file.commit === undefined ||
        (typeof file.commit === 'string' && file.commit.length <= 128)) &&
      (file.blobOid === undefined ||
        (typeof file.blobOid === 'string' && file.blobOid.length <= 128))
    )
  }
  if (citation.kind === 'run') {
    const run = citation as Partial<RunMemoryCitation>
    return (
      typeof run.runId === 'string' &&
      SAFE_ID_RE.test(run.runId) &&
      typeof run.artifactPath === 'string' &&
      run.artifactPath.length > 0 &&
      run.artifactPath.length <= 4096 &&
      typeof run.contentDigest === 'string' &&
      DIGEST_RE.test(run.contentDigest) &&
      validDate(run.capturedAt)
    )
  }
  if (citation.kind === 'user') {
    const user = citation as Partial<UserMemoryCitation>
    return (
      typeof user.sessionId === 'string' &&
      SAFE_ID_RE.test(user.sessionId) &&
      typeof user.messageId === 'string' &&
      SAFE_ID_RE.test(user.messageId) &&
      validDate(user.capturedAt)
    )
  }
  if (citation.kind === 'web') {
    const web = citation as Partial<WebMemoryCitation>
    if (
      typeof web.url !== 'string' ||
      web.url.length > 4096 ||
      !validDate(web.accessedAt) ||
      (web.title !== undefined &&
        (typeof web.title !== 'string' || web.title.length > 500)) ||
      (web.contentDigest !== undefined &&
        (typeof web.contentDigest !== 'string' ||
          !DIGEST_RE.test(web.contentDigest)))
    ) {
      return false
    }
    try {
      const url = new URL(web.url)
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }
  return false
}

export function hasValidMemoryCitations(
  citations: unknown,
): citations is MemoryCitation[] | undefined {
  return (
    citations === undefined ||
    (Array.isArray(citations) &&
      citations.length <= MAX_CITATIONS &&
      citations.every(isMemoryCitation))
  )
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'))
}

function safeSourcePath(cwd: string, rawPath: string): string {
  const root = realpathSync(cwd)
  const absolute = resolve(cwd, rawPath)
  if (!existsSync(absolute)) throw new Error(`Citation source not found: ${rawPath}`)
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Citation source must be a regular non-symlink file')
  }
  const real = realpathSync(absolute)
  if (!contained(root, real)) {
    throw new Error('Citation source must stay inside the project root')
  }
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new Error('Citation source exceeds the 8 MiB safety limit')
  }
  return real
}

function excerpt(
  path: string,
  startLine: number,
  endLine: number,
): string {
  const lines = readFileSync(path, 'utf8').split('\n')
  if (startLine > lines.length || endLine > lines.length) {
    throw new Error(
      `Citation line range ${startLine}:${endLine} exceeds ${lines.length} lines`,
    )
  }
  return lines.slice(startLine - 1, endLine).join('\n')
}

export function captureFileCitation(
  cwd: string,
  rawPath: string,
  startLine = 1,
  endLine = startLine,
  git?: { commit?: string; blobOid?: string },
): FileMemoryCitation {
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine > 10_000
  ) {
    throw new Error('Invalid citation line range')
  }
  const real = safeSourcePath(cwd, rawPath)
  return {
    kind: 'file',
    path: relative(realpathSync(cwd), real),
    startLine,
    endLine,
    excerptDigest: digest(excerpt(real, startLine, endLine)),
    capturedAt: new Date().toISOString(),
    commit: git?.commit,
    blobOid: git?.blobOid,
  }
}

function runArtifactPath(cwd: string, citation: RunMemoryCitation): string {
  const lexicalBase = resolve(cwd, '.ur', 'runs', citation.runId)
  const lexicalTarget = resolve(lexicalBase, citation.artifactPath)
  if (!contained(lexicalBase, lexicalTarget)) {
    throw new Error('Run citation escapes its run directory')
  }
  if (!existsSync(lexicalBase)) return lexicalTarget
  const baseStat = lstatSync(lexicalBase)
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
    throw new Error('Run citation directory is unsafe')
  }
  const realBase = realpathSync(lexicalBase)
  if (!existsSync(lexicalTarget)) {
    return resolve(realBase, relative(lexicalBase, lexicalTarget))
  }
  const realTarget = realpathSync(lexicalTarget)
  if (!contained(realBase, realTarget)) {
    throw new Error('Run citation resolves outside its run directory')
  }
  return realTarget
}

export function captureRunCitation(
  cwd: string,
  runId: string,
  artifactPath: string,
): RunMemoryCitation {
  if (!SAFE_ID_RE.test(runId)) throw new Error('Invalid run citation id')
  const provisional: RunMemoryCitation = {
    kind: 'run',
    runId,
    artifactPath,
    contentDigest: `sha256:${'0'.repeat(64)}`,
    capturedAt: new Date().toISOString(),
  }
  const path = runArtifactPath(cwd, provisional)
  if (!existsSync(path)) throw new Error(`Run artifact not found: ${artifactPath}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) {
    throw new Error('Run artifact citation is unsafe or too large')
  }
  return { ...provisional, contentDigest: digest(readFileSync(path)) }
}

export function captureUserCitation(
  sessionId: string,
  messageId: string,
): UserMemoryCitation {
  const citation: UserMemoryCitation = {
    kind: 'user',
    sessionId,
    messageId,
    capturedAt: new Date().toISOString(),
  }
  if (!isMemoryCitation(citation)) throw new Error('Invalid user citation')
  return citation
}

export function captureWebCitation(
  url: string,
  content?: string,
  title?: string,
): WebMemoryCitation {
  const parsedUrl = new URL(url)
  if (
    !['https:', 'http:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error('Web citation must be a credential-free HTTP(S) URL')
  }
  for (const key of [...parsedUrl.searchParams.keys()]) {
    const values = parsedUrl.searchParams.getAll(key)
    if (
      SENSITIVE_QUERY_KEY_RE.test(key) ||
      values.some(value => SECRET_LIKE_QUERY_VALUE_RE.test(value.trim()))
    ) {
      parsedUrl.searchParams.delete(key)
      parsedUrl.searchParams.append(key, '[redacted]')
    }
  }
  parsedUrl.hash = ''
  const citation: WebMemoryCitation = {
    kind: 'web',
    url: parsedUrl.toString(),
    accessedAt: new Date().toISOString(),
    contentDigest: content === undefined ? undefined : digest(content),
    title: title?.slice(0, 500),
  }
  if (!isMemoryCitation(citation)) throw new Error('Invalid web citation')
  return citation
}

export function validateMemoryCitation(
  cwd: string,
  citation: MemoryCitation,
): CitationValidation {
  if (citation.kind === 'user') {
    return {
      citation,
      freshness: 'unverifiable',
      reason: 'User-message citation requires its session transcript to be opened',
    }
  }
  if (citation.kind === 'web') {
    return {
      citation,
      freshness: 'unverifiable',
      reason: 'Web citations are not refreshed without an explicit network action',
    }
  }
  try {
    if (citation.kind === 'file') {
      const path = safeSourcePath(cwd, citation.path)
      const currentDigest = digest(
        excerpt(path, citation.startLine, citation.endLine),
      )
      return currentDigest === citation.excerptDigest
        ? {
            citation,
            freshness: 'fresh',
            reason: 'File excerpt still matches its captured digest',
            currentDigest,
          }
        : {
            citation,
            freshness: 'stale',
            reason: 'File excerpt changed after the memory was captured',
            currentDigest,
          }
    }
    const path = runArtifactPath(cwd, citation)
    if (!existsSync(path)) {
      return {
        citation,
        freshness: 'missing',
        reason: 'Run artifact no longer exists',
      }
    }
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) {
      return {
        citation,
        freshness: 'missing',
        reason: 'Run artifact is unsafe or no longer a bounded regular file',
      }
    }
    const currentDigest = digest(readFileSync(path))
    return currentDigest === citation.contentDigest
      ? {
          citation,
          freshness: 'fresh',
          reason: 'Run artifact still matches its captured digest',
          currentDigest,
        }
      : {
          citation,
          freshness: 'stale',
          reason: 'Run artifact changed after the memory was captured',
          currentDigest,
        }
  } catch (error) {
    return {
      citation,
      freshness: /not found|ENOENT|exceeds/i.test(
        error instanceof Error ? error.message : String(error),
      )
        ? 'missing'
        : 'stale',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function combinedFreshness(
  values: CitationValidation[],
): CitationFreshness {
  if (values.some(value => value.freshness === 'missing')) return 'missing'
  if (values.some(value => value.freshness === 'stale')) return 'stale'
  if (values.length > 0 && values.every(value => value.freshness === 'fresh')) {
    return 'fresh'
  }
  return 'unverifiable'
}

export function resolveTaskMemoryEntries(
  cwd: string,
  entries: TaskMemoryEntry[],
  options: {
    query?: string
    includeStale?: boolean
    includeUnverifiable?: boolean
    maxEntries?: number
  } = {},
): ResolvedMemory[] {
  const superseded = new Set(
    entries
      .map(entry => entry.supersedesId)
      .filter((id): id is string => typeof id === 'string'),
  )
  const queryTokens = new Set(
    options.query?.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [],
  )
  return entries
    .filter(
      entry =>
        entry.status !== 'rejected' &&
        entry.status !== 'superseded' &&
        !superseded.has(entry.id),
    )
    .map(entry => {
      const citations = (entry.citations ?? []).map(citation =>
        validateMemoryCitation(cwd, citation),
      )
      return { entry, citations, freshness: combinedFreshness(citations) }
    })
    .filter(
      item =>
        options.includeStale === true ||
        (item.freshness !== 'stale' && item.freshness !== 'missing'),
    )
    .filter(
      item =>
        options.includeUnverifiable !== false ||
        item.freshness !== 'unverifiable',
    )
    .map(item => ({
      item,
      score:
        queryTokens.size === 0
          ? 0
          : [...queryTokens].filter(token =>
              item.entry.text.toLowerCase().includes(token),
            ).length,
    }))
    .filter(item => queryTokens.size === 0 || item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.item.entry.at.localeCompare(a.item.entry.at),
    )
    .slice(0, Math.max(1, Math.min(100, options.maxEntries ?? 20)))
    .map(value => value.item)
}

function citationLabel(citation: MemoryCitation): string {
  if (citation.kind === 'file') {
    return `${citation.path}:${citation.startLine}-${citation.endLine}`
  }
  if (citation.kind === 'run') {
    return `run:${citation.runId}/${citation.artifactPath}`
  }
  if (citation.kind === 'user') {
    return `session:${citation.sessionId}#${citation.messageId}`
  }
  return citation.url
}

export function formatResolvedMemory(
  resolved: ResolvedMemory[],
  maxBytes = 16 * 1024,
  heading = 'Cited Project Memory',
): string {
  const lines = [`# ${heading}`, '']
  let bytes = Buffer.byteLength(`${lines.join('\n')}\n`)
  for (const item of resolved) {
    const line = formatResolvedMemoryItem(item)
    const lineBytes = Buffer.byteLength(`${line}\n`)
    if (bytes + lineBytes > maxBytes) {
      lines.push('- … memory output truncated at the configured byte limit')
      break
    }
    lines.push(line)
    bytes += lineBytes
  }
  return `${lines.join('\n')}\n`
}

export function formatResolvedMemoryItem(item: ResolvedMemory): string {
  const citations = item.citations.length
    ? item.citations
        .map(
          value =>
            `${citationLabel(value.citation)} [${value.freshness}]`,
        )
        .join(', ')
    : 'no citation [unverifiable]'
  return `- [mem:${item.entry.id}] ${item.entry.text} — ${citations}`
}
