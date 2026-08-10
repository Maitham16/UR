import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type ResearchConfidence = 'low' | 'medium' | 'high'
export type ResearchFindingStatus = 'supported' | 'contested' | 'open'

export type ResearchSource = {
  id: string
  url: string
  title: string
  publisher?: string
  publishedAt?: string
  accessedAt: string
  notes?: string
}

export type ResearchFinding = {
  id: string
  text: string
  sourceIds: string[]
  confidence: ResearchConfidence
  status: ResearchFindingStatus
  createdAt: string
}

export type ResearchQuestion = {
  id: string
  text: string
  resolved: boolean
  createdAt: string
}

export type ResearchProject = {
  version: 1
  id: string
  question: string
  createdAt: string
  updatedAt: string
  sources: ResearchSource[]
  findings: ResearchFinding[]
  questions: ResearchQuestion[]
}

export type ResearchAuditIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  findingId?: string
  sourceId?: string
}

export type ResearchAudit = {
  valid: boolean
  ready: boolean
  sourceCount: number
  findingCount: number
  openQuestionCount: number
  issues: ResearchAuditIssue[]
}

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const MAX_PROJECTS = 1_000
const MAX_SOURCES = 2_000
const MAX_FINDINGS = 5_000
const MAX_QUESTIONS = 2_000
const MAX_PROJECT_BYTES = 16 * 1024 * 1024
const SECRET_QUERY_KEY = /^(?:access_?token|api_?key|auth|authorization|key|password|secret|signature|sig|token)$/i

function bounded(value: string, label: string, max: number): string {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new Error(`${label} is required`)
  if (normalized.length > max) throw new Error(`${label} must be at most ${max} characters`)
  return normalized
}

export function normalizeResearchId(value: string): string {
  const id = value.trim().toLowerCase()
  if (!ID_RE.test(id)) {
    throw new Error('Research id must contain 1-64 lowercase letters, numbers, or hyphens')
  }
  return id
}

export function sanitizeResearchUrl(value: string): string {
  const raw = bounded(value, 'Source URL', 2_048)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Source URL must be a valid absolute HTTP(S) URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Source URL must use HTTP or HTTPS')
  }
  url.username = ''
  url.password = ''
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, '[redacted]')
  }
  url.hash = ''
  return url.toString()
}

function researchDir(root: string): string {
  return join(resolve(root), '.ur', 'research', 'projects')
}

export function researchProjectPath(root: string, id: string): string {
  return join(researchDir(root), `${normalizeResearchId(id)}.json`)
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
}

function isSanitizedResearchUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return sanitizeResearchUrl(value) === value
  } catch {
    return false
  }
}

function assertProjectShape(value: unknown, id: string): asserts value is ResearchProject {
  if (!value || typeof value !== 'object') throw new Error(`Research project is malformed: ${id}`)
  const project = value as Partial<ResearchProject>
  if (
    project.version !== 1 ||
    project.id !== id ||
    typeof project.question !== 'string' ||
    !Array.isArray(project.sources) ||
    !Array.isArray(project.findings) ||
    !Array.isArray(project.questions)
  ) {
    throw new Error(`Research project is malformed: ${id}`)
  }
  const malformed =
    project.question.length > 4_000 ||
    project.sources.length > MAX_SOURCES ||
    project.findings.length > MAX_FINDINGS ||
    project.questions.length > MAX_QUESTIONS ||
    project.sources.some(source =>
      !source ||
      typeof source.id !== 'string' ||
      !/^S[1-9]\d*$/.test(source.id) ||
      !isSanitizedResearchUrl(source.url) ||
      typeof source.title !== 'string' ||
      typeof source.accessedAt !== 'string',
    ) ||
    project.findings.some(finding =>
      !finding ||
      typeof finding.id !== 'string' ||
      !/^F[1-9]\d*$/.test(finding.id) ||
      typeof finding.text !== 'string' ||
      !Array.isArray(finding.sourceIds) ||
      finding.sourceIds.some(sourceId => typeof sourceId !== 'string') ||
      !['low', 'medium', 'high'].includes(finding.confidence) ||
      !['supported', 'contested', 'open'].includes(finding.status) ||
      typeof finding.createdAt !== 'string',
    ) ||
    project.questions.some(question =>
      !question ||
      typeof question.id !== 'string' ||
      !/^Q[1-9]\d*$/.test(question.id) ||
      typeof question.text !== 'string' ||
      typeof question.resolved !== 'boolean' ||
      typeof question.createdAt !== 'string',
    ) ||
    new Set(project.sources.map(source => source.id)).size !== project.sources.length ||
    new Set(project.findings.map(finding => finding.id)).size !== project.findings.length ||
    new Set(project.questions.map(question => question.id)).size !== project.questions.length
  if (malformed) throw new Error(`Research project is malformed: ${id}`)
}

export function loadResearchProject(root: string, id: string): ResearchProject {
  const normalizedId = normalizeResearchId(id)
  const file = researchProjectPath(root, normalizedId)
  if (!existsSync(file)) throw new Error(`Research project not found: ${normalizedId}`)
  if (statSync(file).size > MAX_PROJECT_BYTES) {
    throw new Error(`Research project exceeds ${MAX_PROJECT_BYTES} bytes: ${normalizedId}`)
  }
  const parsed = safeParseJSON(readFileSync(file, 'utf8'), false)
  assertProjectShape(parsed, normalizedId)
  return parsed
}

function saveResearchProject(root: string, project: ResearchProject): ResearchProject {
  project.updatedAt = new Date().toISOString()
  atomicWriteJson(researchProjectPath(root, project.id), project)
  return project
}

export function createResearchProject(
  root: string,
  id: string,
  question: string,
): ResearchProject {
  const normalizedId = normalizeResearchId(id)
  const file = researchProjectPath(root, normalizedId)
  if (existsSync(file)) throw new Error(`Research project already exists: ${normalizedId}`)
  mkdirSync(researchDir(root), { recursive: true })
  const existing = readdirSync(researchDir(root)).filter(name => name.endsWith('.json'))
  if (existing.length >= MAX_PROJECTS) throw new Error(`Research project limit reached (${MAX_PROJECTS})`)
  const now = new Date().toISOString()
  const project: ResearchProject = {
    version: 1,
    id: normalizedId,
    question: bounded(question, 'Research question', 4_000),
    createdAt: now,
    updatedAt: now,
    sources: [],
    findings: [],
    questions: [],
  }
  atomicWriteJson(file, project)
  return project
}

export function listResearchProjects(root: string): ResearchProject[] {
  const dir = researchDir(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => ID_RE.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
    .slice(0, MAX_PROJECTS)
    .flatMap(name => {
      try {
        return [loadResearchProject(root, name.slice(0, -5))]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

export function addResearchSource(
  root: string,
  id: string,
  input: {
    url: string
    title: string
    publisher?: string
    publishedAt?: string
    notes?: string
  },
): ResearchSource {
  const project = loadResearchProject(root, id)
  if (project.sources.length >= MAX_SOURCES) throw new Error(`Source limit reached (${MAX_SOURCES})`)
  const url = sanitizeResearchUrl(input.url)
  const duplicate = project.sources.find(source => source.url === url)
  if (duplicate) throw new Error(`Source URL already exists as ${duplicate.id}`)
  const source: ResearchSource = {
    id: `S${project.sources.length + 1}`,
    url,
    title: bounded(input.title, 'Source title', 500),
    publisher: input.publisher ? bounded(input.publisher, 'Publisher', 300) : undefined,
    publishedAt: input.publishedAt ? bounded(input.publishedAt, 'Publication date', 100) : undefined,
    accessedAt: new Date().toISOString(),
    notes: input.notes ? bounded(input.notes, 'Source notes', 4_000) : undefined,
  }
  project.sources.push(source)
  saveResearchProject(root, project)
  return source
}

export function addResearchFinding(
  root: string,
  id: string,
  input: {
    text: string
    sourceIds?: string[]
    confidence?: ResearchConfidence
    status?: ResearchFindingStatus
  },
): ResearchFinding {
  const project = loadResearchProject(root, id)
  if (project.findings.length >= MAX_FINDINGS) throw new Error(`Finding limit reached (${MAX_FINDINGS})`)
  const sourceIds = [...new Set((input.sourceIds ?? []).map(value => value.trim()).filter(Boolean))]
  const known = new Set(project.sources.map(source => source.id))
  const missing = sourceIds.filter(sourceId => !known.has(sourceId))
  if (missing.length > 0) throw new Error(`Unknown source id(s): ${missing.join(', ')}`)
  const confidence = input.confidence ?? 'medium'
  if (!['low', 'medium', 'high'].includes(confidence)) throw new Error(`Invalid confidence: ${confidence}`)
  const status = input.status ?? 'supported'
  if (!['supported', 'contested', 'open'].includes(status)) throw new Error(`Invalid finding status: ${status}`)
  const finding: ResearchFinding = {
    id: `F${project.findings.length + 1}`,
    text: bounded(input.text, 'Finding', 8_000),
    sourceIds,
    confidence,
    status,
    createdAt: new Date().toISOString(),
  }
  project.findings.push(finding)
  saveResearchProject(root, project)
  return finding
}

export function addResearchQuestion(root: string, id: string, text: string): ResearchQuestion {
  const project = loadResearchProject(root, id)
  if (project.questions.length >= MAX_QUESTIONS) throw new Error(`Open-question limit reached (${MAX_QUESTIONS})`)
  const question: ResearchQuestion = {
    id: `Q${project.questions.length + 1}`,
    text: bounded(text, 'Open question', 4_000),
    resolved: false,
    createdAt: new Date().toISOString(),
  }
  project.questions.push(question)
  saveResearchProject(root, project)
  return question
}

function publisherKey(source: ResearchSource): string {
  if (source.publisher) return source.publisher.toLowerCase()
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return source.url
  }
}

export function auditResearchProject(project: ResearchProject): ResearchAudit {
  const issues: ResearchAuditIssue[] = []
  const sources = new Map(project.sources.map(source => [source.id, source]))
  if (project.sources.length === 0) {
    issues.push({ severity: 'warning', code: 'NO_SOURCES', message: 'No sources have been recorded.' })
  }
  if (project.findings.length === 0) {
    issues.push({ severity: 'warning', code: 'NO_FINDINGS', message: 'No findings have been recorded.' })
  }
  for (const finding of project.findings) {
    const missing = finding.sourceIds.filter(sourceId => !sources.has(sourceId))
    for (const sourceId of missing) {
      issues.push({
        severity: 'error',
        code: 'MISSING_SOURCE',
        message: `${finding.id} cites missing source ${sourceId}.`,
        findingId: finding.id,
        sourceId,
      })
    }
    if (finding.status !== 'open' && finding.sourceIds.length === 0) {
      issues.push({
        severity: 'error',
        code: 'UNCITED_FINDING',
        message: `${finding.id} has no supporting source.`,
        findingId: finding.id,
      })
    }
    if (finding.status === 'supported' && finding.confidence === 'high') {
      const publishers = new Set(
        finding.sourceIds.flatMap(sourceId => {
          const source = sources.get(sourceId)
          return source ? [publisherKey(source)] : []
        }),
      )
      if (finding.sourceIds.length < 2 || publishers.size < 2) {
        issues.push({
          severity: 'warning',
          code: 'HIGH_CONFIDENCE_NOT_CORROBORATED',
          message: `${finding.id} is high confidence but lacks two independent sources.`,
          findingId: finding.id,
        })
      }
    }
  }
  const openQuestionCount = project.questions.filter(question => !question.resolved).length
  const valid = !issues.some(issue => issue.severity === 'error')
  return {
    valid,
    ready: valid && issues.length === 0,
    sourceCount: project.sources.length,
    findingCount: project.findings.length,
    openQuestionCount,
    issues,
  }
}

export function renderResearchReport(project: ResearchProject): string {
  const audit = auditResearchProject(project)
  const sourceById = new Map(project.sources.map(source => [source.id, source]))
  const lines = [
    `# Research report: ${project.id}`,
    '',
    `**Question:** ${project.question}`,
    '',
    `**Evidence status:** ${audit.ready ? 'ready' : audit.valid ? 'valid with warnings' : 'invalid'}`,
    '',
    '## Findings',
    '',
  ]
  if (project.findings.length === 0) lines.push('_No findings recorded._', '')
  for (const finding of project.findings) {
    const citations = finding.sourceIds.map(sourceId => `[${sourceId}]`).join(' ')
    lines.push(
      `### ${finding.id} — ${finding.status}, ${finding.confidence} confidence`,
      '',
      `${finding.text}${citations ? ` ${citations}` : ''}`,
      '',
    )
  }
  lines.push('## Open questions', '')
  const open = project.questions.filter(question => !question.resolved)
  if (open.length === 0) lines.push('_None recorded._', '')
  else lines.push(...open.map(question => `- ${question.id}: ${question.text}`), '')
  lines.push('## Sources', '')
  if (project.sources.length === 0) lines.push('_No sources recorded._', '')
  for (const source of project.sources) {
    const details = [source.publisher, source.publishedAt].filter(Boolean).join(', ')
    lines.push(`- [${source.id}] [${source.title}](${source.url})${details ? ` — ${details}` : ''}`)
  }
  lines.push('', '## Verification', '')
  if (audit.issues.length === 0) lines.push('- PASS: every supported finding is cited and high-confidence claims are independently corroborated.')
  else lines.push(...audit.issues.map(issue => `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`))
  lines.push('')
  return lines.join('\n')
}

export function writeResearchReport(root: string, output: string, report: string): string {
  const absoluteRoot = resolve(root)
  const absolute = isAbsolute(output) ? resolve(output) : resolve(absoluteRoot, output)
  const rel = relative(absoluteRoot, absolute)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Report output must stay inside the workspace')
  }
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, report)
  return absolute
}

export function researchProjectDigest(project: ResearchProject): string {
  return createHash('sha256').update(JSON.stringify(project)).digest('hex')
}
