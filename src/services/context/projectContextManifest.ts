import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { detectProjectDna, formatDna } from '../../ur/projectDna.js'
import { safeParseJSON } from '../../utils/json.js'
import { safetyPolicyPath } from '../safety/projectSafety.js'
import {
  endGenAiMemorySpan,
  startGenAiMemorySpan,
} from '../../utils/telemetry/genAiSemantics.js'

export const TASK_MEMORY_KINDS = [
  'decision',
  'constraint',
  'command',
  'diff',
  'note',
  'architecture',
  'preference',
  'attempt',
  'accepted',
  'rejected',
] as const
export type TaskMemoryKind = (typeof TASK_MEMORY_KINDS)[number]

export type TaskMemoryEntry = {
  schemaVersion?: 2
  id: string
  at: string
  kind: TaskMemoryKind
  text: string
  status?: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  rationale?: string
  alternativeTo?: string
  supersedesId?: string
  scope?: 'project' | 'team' | 'personal'
  source?: string
  provenance?: TaskMemoryProvenance
  previousDigest?: string
  contentDigest?: string
}

export type TaskMemoryProvenance = {
  sourceKind: 'agent' | 'user' | 'tool' | 'import' | 'system' | 'unknown'
  sourceRef?: string
  sourceDigest?: string
  actor?: string
  parentIds?: string[]
}

export type TaskMemoryIntegrityIssue = {
  severity: 'error' | 'warning'
  code: string
  line?: number
  message: string
}

export type TaskMemoryVerification = {
  valid: boolean
  path: string
  entries: TaskMemoryEntry[]
  legacyEntries: number
  verifiedEntries: number
  headDigest: string
  fileDigest?: string
  issues: TaskMemoryIntegrityIssue[]
  validPrefix: string
}

export class TaskMemoryIntegrityError extends Error {
  readonly verification: TaskMemoryVerification

  constructor(verification: TaskMemoryVerification) {
    const first = verification.issues.find(issue => issue.severity === 'error')
    super(
      `Task memory integrity verification failed${first?.line ? ` at line ${first.line}` : ''}: ${first?.message ?? 'unknown error'}`,
    )
    this.name = 'TaskMemoryIntegrityError'
    this.verification = verification
  }
}

export type ProjectContextManifest = {
  version: 1
  generatedAt: string
  project: {
    name: string
    root: string
    readme: string | null
    languages: string[]
    packageManagers: string[]
    importantFolders: string[]
  }
  instructionFiles: string[]
  manifests: string[]
  commands: {
    compile: string[]
    test: string[]
    lint: string[]
    run: string[]
    release: string[]
  }
  architectureRules: string[]
  constraints: string[]
}

export function contextDir(cwd: string): string {
  return join(cwd, '.ur', 'context')
}

export function projectManifestPath(cwd: string): string {
  return join(cwd, '.ur', 'project-manifest.json')
}

export function taskMemoryPath(cwd: string): string {
  return join(contextDir(cwd), 'task-memory.jsonl')
}

export function compressedContextPath(cwd: string): string {
  return join(contextDir(cwd), 'compressed.md')
}

export function architectureSummaryPath(cwd: string): string {
  return join(contextDir(cwd), 'architecture.md')
}

function readPackage(cwd: string): Record<string, unknown> | null {
  const path = join(cwd, 'package.json')
  if (!existsSync(path)) return null
  return safeParseJSON(readFileSync(path, 'utf8'), false) as Record<string, unknown> | null
}

function existing(cwd: string, names: string[]): string[] {
  return names.filter(name => existsSync(join(cwd, name)))
}

function existingFilesInDir(
  cwd: string,
  dir: string,
  extensions: string[],
): string[] {
  const absoluteDir = join(cwd, dir)
  if (!existsSync(absoluteDir) || !statSync(absoluteDir).isDirectory()) return []
  return readdirSync(absoluteDir)
    .filter(file => extensions.some(extension => file.endsWith(extension)))
    .sort()
    .map(file => `${dir}/${file}`)
}

function instructionFiles(cwd: string): string[] {
  return [
    ...existing(cwd, [
      'AGENTS.md',
      'UR.md',
      'UR.local.md',
      'CLAUDE.md',
      '.cursorrules',
      '.windsurfrules',
      '.github/copilot-instructions.md',
    ]),
    ...existingFilesInDir(cwd, '.cursor/rules', ['.mdc', '.md']),
  ]
}

function manifestFiles(cwd: string): string[] {
  return [
    ...existing(cwd, [
      'package.json',
      'bun.lock',
      'bunfig.toml',
      'tsconfig.json',
      'jsconfig.json',
      'biome.json',
      'eslint.config.js',
      'pyproject.toml',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'Dockerfile',
      'docker-compose.yml',
      'compose.yml',
      '.editorconfig',
      '.mcp.json',
      '.ur/verify.json',
      '.ur/safety-policy.json',
      '.vscode/settings.json',
      '.zed/settings.json',
    ]),
    ...existingFilesInDir(cwd, '.github/workflows', ['.yml', '.yaml']),
  ]
}

function packageScripts(pkg: Record<string, unknown> | null, matcher: RegExp): string[] {
  const scripts = pkg?.scripts
  if (!scripts || typeof scripts !== 'object') return []
  return Object.entries(scripts as Record<string, string>)
    .filter(([name, value]) => matcher.test(name) && typeof value === 'string')
    .map(([name]) => `bun run ${name}`)
}

export function buildProjectContextManifest(cwd: string): ProjectContextManifest {
  const dna = detectProjectDna(cwd)
  const pkg = readPackage(cwd)
  const packageName = typeof pkg?.name === 'string' ? pkg.name : 'project'
  const release = packageScripts(pkg, /^(release|package|smoke|secrets|prepack)/)
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      name: packageName,
      root: cwd,
      readme: dna.readme,
      languages: dna.languages,
      packageManagers: dna.packageManagers,
      importantFolders: dna.importantFolders,
    },
    instructionFiles: instructionFiles(cwd),
    manifests: manifestFiles(cwd),
    commands: {
      compile: dna.buildCommands,
      test: dna.testCommands,
      lint: dna.lintCommands,
      run: dna.runCommands,
      release,
    },
    architectureRules: [
      'Prefer package scripts and project manifests before inventing commands.',
      'Treat AGENTS.md, UR.md, Cursor rules, and other agent instruction files as shared architecture instructions when present.',
      'Use .ur/verify.json and .ur/safety-policy.json as executable project constraints.',
      'Use MCP, editor, package-manager, workflow, and language manifests to infer architecture rules and available commands.',
      'Keep generated runtime state under .ur/ unless a command documents another path.',
    ],
    constraints: [
      existsSync(safetyPolicyPath(cwd))
        ? 'Project safety policy is configured.'
        : 'Default safety policy applies until .ur/safety-policy.json is written.',
      existsSync(join(cwd, '.ur', 'verify.json'))
        ? 'Project verify gates are configured.'
        : 'No project verify gate file detected.',
      'Do not expose secret-like files or environment values in command output.',
    ],
  }
}

export function writeProjectContextManifest(cwd: string): ProjectContextManifest {
  const manifest = buildProjectContextManifest(cwd)
  mkdirSync(dirname(projectManifestPath(cwd)), { recursive: true })
  writeFileSync(projectManifestPath(cwd), `${JSON.stringify(manifest, null, 2)}\n`)
  mkdirSync(contextDir(cwd), { recursive: true })
  writeFileSync(architectureSummaryPath(cwd), formatArchitectureSummary(manifest, cwd))
  return manifest
}

export function formatArchitectureSummary(
  manifest: ProjectContextManifest,
  cwd: string,
): string {
  const dna = formatDna({
    languages: manifest.project.languages,
    packageManagers: manifest.project.packageManagers,
    buildCommands: manifest.commands.compile,
    testCommands: manifest.commands.test,
    lintCommands: manifest.commands.lint,
    runCommands: manifest.commands.run,
    importantFolders: manifest.project.importantFolders,
    ignoredFolders: [],
    readme: manifest.project.readme,
    hasGit: existsSync(join(cwd, '.git')),
  })
  return [
    '# Project Architecture Context',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Project: ${manifest.project.name}`,
    '',
    dna,
    '',
    '## Architecture Rules',
    ...manifest.architectureRules.map(rule => `- ${rule}`),
    '',
    '## Constraints',
    ...manifest.constraints.map(rule => `- ${rule}`),
    '',
    '## Manifests',
    ...(manifest.manifests.length
      ? manifest.manifests.map(file => `- ${file}`)
      : ['- none detected']),
    '',
  ].join('\n')
}

const TASK_MEMORY_SCHEMA_VERSION = 2
const TASK_MEMORY_STORE_ID = 'ur-project-task-memory'
const TASK_MEMORY_GENESIS = createHash('sha256')
  .update('ur-task-memory-genesis-v2')
  .digest('hex')
const MAX_TASK_MEMORY_BYTES = 64 * 1024 * 1024
const MAX_TASK_MEMORY_ENTRY_BYTES = 1024 * 1024
const TASK_MEMORY_LOCK_STALE_MS = 30_000
const TASK_MEMORY_LOCK_WAIT_MS = 1_000
const lockWaitArray = new Int32Array(new SharedArrayBuffer(4))

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function taskMemoryEntryDigest(entry: TaskMemoryEntry): string {
  const { contentDigest: _contentDigest, ...signed } = entry
  return hash(`ur-task-memory-entry-v2\n${stableJson(signed)}\n`)
}

function ensureTaskMemoryDirectory(cwd: string): void {
  const urDir = join(cwd, '.ur')
  const dir = contextDir(cwd)
  mkdirSync(urDir, { recursive: true, mode: 0o700 })
  const urStat = lstatSync(urDir)
  if (!urStat.isDirectory() || urStat.isSymbolicLink()) {
    throw new Error('.ur must be a real directory for task memory')
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const contextStat = lstatSync(dir)
  if (!contextStat.isDirectory() || contextStat.isSymbolicLink()) {
    throw new Error('.ur/context must be a real directory for task memory')
  }
  chmodSync(dir, 0o700)
  const path = taskMemoryPath(cwd)
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Task memory must be a regular file, not a symlink')
    }
    if (stat.size > MAX_TASK_MEMORY_BYTES) {
      throw new Error('Task memory exceeds the 64 MiB safety limit')
    }
  }
}

function acquireTaskMemoryLock(cwd: string): () => void {
  ensureTaskMemoryDirectory(cwd)
  const lockPath = `${taskMemoryPath(cwd)}.lock`
  const started = Date.now()
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 })
      try {
        writeFileSync(
          join(lockPath, 'owner.json'),
          `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`,
          { flag: 'wx', mode: 0o600 },
        )
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true })
        throw error
      }
      return () => rmSync(lockPath, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = lstatSync(lockPath)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Task memory lock path is unsafe')
      }
      if (Date.now() - stat.mtimeMs > TASK_MEMORY_LOCK_STALE_MS) {
        rmSync(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started >= TASK_MEMORY_LOCK_WAIT_MS) {
        throw new Error('Task memory is busy; retry the operation')
      }
      Atomics.wait(lockWaitArray, 0, 0, 10)
    }
  }
}

function validateTaskMemoryEntry(
  value: unknown,
  line: number,
): { entry?: TaskMemoryEntry; issue?: TaskMemoryIntegrityIssue } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      issue: {
        severity: 'error',
        code: 'entry.not_object',
        line,
        message: 'entry is not a JSON object',
      },
    }
  }
  const entry = value as TaskMemoryEntry
  if (
    typeof entry.id !== 'string' ||
    entry.id.length === 0 ||
    entry.id.length > 200 ||
    typeof entry.at !== 'string' ||
    !Number.isFinite(Date.parse(entry.at)) ||
    !TASK_MEMORY_KINDS.includes(entry.kind) ||
    typeof entry.text !== 'string'
  ) {
    return {
      issue: {
        severity: 'error',
        code: 'entry.schema',
        line,
        message: 'entry is missing a valid id, timestamp, kind, or text',
      },
    }
  }
  if (Buffer.byteLength(entry.text) > MAX_TASK_MEMORY_ENTRY_BYTES) {
    return {
      issue: {
        severity: 'error',
        code: 'entry.too_large',
        line,
        message: 'entry text exceeds the 1 MiB safety limit',
      },
    }
  }
  return { entry }
}

export function verifyTaskMemory(cwd: string): TaskMemoryVerification {
  const path = taskMemoryPath(cwd)
  if (!existsSync(path)) {
    return {
      valid: true,
      path,
      entries: [],
      legacyEntries: 0,
      verifiedEntries: 0,
      headDigest: TASK_MEMORY_GENESIS,
      issues: [],
      validPrefix: '',
    }
  }
  try {
    ensureTaskMemoryDirectory(cwd)
    const raw = readFileSync(path, 'utf8')
    const rawLines = raw.split('\n')
    if (rawLines.at(-1) === '') rawLines.pop()
    const entries: TaskMemoryEntry[] = []
    const validLines: string[] = []
    const issues: TaskMemoryIntegrityIssue[] = []
    let expectedDigest = TASK_MEMORY_GENESIS
    let legacyEntries = 0
    let verifiedEntries = 0
    let verifiedFormatStarted = false
    const seenIds = new Set<string>()

    for (let index = 0; index < rawLines.length; index++) {
      const rawLine = rawLines[index]!
      const line = index + 1
      if (rawLine.trim() === '') {
        issues.push({
          severity: 'error',
          code: 'line.empty',
          line,
          message: 'blank lines are not valid inside task memory JSONL',
        })
        break
      }
      const parsed = safeParseJSON(rawLine, false)
      if (parsed === null) {
        issues.push({
          severity: 'error',
          code: 'line.invalid_json',
          line,
          message: 'line is not valid JSON',
        })
        break
      }
      const validated = validateTaskMemoryEntry(parsed, line)
      if (!validated.entry) {
        issues.push(validated.issue!)
        break
      }
      const entry = validated.entry
      if (seenIds.has(entry.id)) {
        issues.push({
          severity: 'error',
          code: 'entry.duplicate_id',
          line,
          message: `duplicate entry id: ${entry.id}`,
        })
        break
      }
      if (entry.supersedesId && !seenIds.has(entry.supersedesId)) {
        issues.push({
          severity: 'error',
          code: 'entry.invalid_supersedes',
          line,
          message: 'supersedesId must reference an earlier entry',
        })
        break
      }
      if (entry.schemaVersion !== TASK_MEMORY_SCHEMA_VERSION) {
        if (verifiedFormatStarted) {
          issues.push({
            severity: 'error',
            code: 'chain.legacy_after_v2',
            line,
            message: 'legacy entry appears after the integrity chain started',
          })
          break
        }
        legacyEntries++
        expectedDigest = hash(
          `ur-task-memory-legacy-v1\n${expectedDigest}\n${rawLine}\n`,
        )
      } else {
        verifiedFormatStarted = true
        const sourceKinds = new Set([
          'agent',
          'user',
          'tool',
          'import',
          'system',
          'unknown',
        ])
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            entry.id,
          ) ||
          !entry.provenance ||
          !sourceKinds.has(entry.provenance.sourceKind) ||
          (entry.provenance.sourceDigest !== undefined &&
            !/^[a-f0-9]{64}$/.test(entry.provenance.sourceDigest)) ||
          (entry.provenance.parentIds !== undefined &&
            (!Array.isArray(entry.provenance.parentIds) ||
              entry.provenance.parentIds.some(id => !seenIds.has(id))))
        ) {
          issues.push({
            severity: 'error',
            code: 'entry.provenance',
            line,
            message: 'v2 entry has invalid identity or provenance metadata',
          })
          break
        }
        if (
          typeof entry.previousDigest !== 'string' ||
          entry.previousDigest !== expectedDigest
        ) {
          issues.push({
            severity: 'error',
            code: 'chain.previous_digest',
            line,
            message: 'previousDigest does not match the verified chain head',
          })
          break
        }
        const calculated = taskMemoryEntryDigest(entry)
        if (
          typeof entry.contentDigest !== 'string' ||
          entry.contentDigest !== calculated
        ) {
          issues.push({
            severity: 'error',
            code: 'chain.content_digest',
            line,
            message: 'contentDigest does not match the entry contents',
          })
          break
        }
        expectedDigest = entry.contentDigest
        verifiedEntries++
      }
      entries.push(entry)
      seenIds.add(entry.id)
      validLines.push(rawLine)
    }
    if (legacyEntries > 0) {
      issues.push({
        severity: 'warning',
        code: 'chain.legacy_prefix',
        message: `${legacyEntries} legacy entr${legacyEntries === 1 ? 'y is' : 'ies are'} anchored but not individually signed`,
      })
    }
    return {
      valid: !issues.some(issue => issue.severity === 'error'),
      path,
      entries,
      legacyEntries,
      verifiedEntries,
      headDigest: expectedDigest,
      fileDigest: hash(raw),
      issues,
      validPrefix: validLines.length > 0 ? `${validLines.join('\n')}\n` : '',
    }
  } catch (error) {
    return {
      valid: false,
      path,
      entries: [],
      legacyEntries: 0,
      verifiedEntries: 0,
      headDigest: TASK_MEMORY_GENESIS,
      issues: [
        {
          severity: 'error',
          code: 'file.unsafe',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      validPrefix: '',
    }
  }
}

function durableAppend(path: string, body: string): void {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | noFollow,
    0o600,
  )
  try {
    writeSync(descriptor, body, undefined, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  chmodSync(path, 0o600)
}

export function appendTaskMemory(
  cwd: string,
  kind: TaskMemoryKind,
  text: string,
  meta?: Omit<Partial<TaskMemoryEntry>, 'id' | 'at' | 'kind' | 'text'>,
): TaskMemoryEntry {
  const span = startGenAiMemorySpan('create_memory', {
    storeId: TASK_MEMORY_STORE_ID,
    recordCount: 1,
  })
  let spanEnded = false
  try {
    if (!TASK_MEMORY_KINDS.includes(kind)) {
      throw new Error(`Invalid memory kind: ${kind}`)
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Task memory text must not be empty')
    }
    if (Buffer.byteLength(text) > MAX_TASK_MEMORY_ENTRY_BYTES) {
      throw new Error('Task memory text exceeds the 1 MiB safety limit')
    }
    const release = acquireTaskMemoryLock(cwd)
    try {
      const verification = verifyTaskMemory(cwd)
      if (!verification.valid) throw new TaskMemoryIntegrityError(verification)
      const at = new Date().toISOString()
      const provenance: TaskMemoryProvenance = {
        sourceKind:
          meta?.provenance?.sourceKind ?? (meta?.source ? 'agent' : 'system'),
        sourceRef: meta?.provenance?.sourceRef ?? meta?.source,
        sourceDigest: meta?.provenance?.sourceDigest,
        actor: meta?.provenance?.actor,
        parentIds: meta?.provenance?.parentIds,
      }
      if (
        provenance.sourceDigest !== undefined &&
        !/^[a-f0-9]{64}$/.test(provenance.sourceDigest)
      ) {
        throw new Error('Task memory provenance sourceDigest must be SHA-256 hex')
      }
      const entry: TaskMemoryEntry = {
        schemaVersion: TASK_MEMORY_SCHEMA_VERSION,
        id: randomUUID(),
        at,
        kind,
        text,
        status: meta?.status,
        rationale: meta?.rationale,
        alternativeTo: meta?.alternativeTo,
        supersedesId: meta?.supersedesId,
        scope: meta?.scope,
        source: meta?.source,
        provenance,
        previousDigest: verification.headDigest,
      }
      entry.contentDigest = taskMemoryEntryDigest(entry)
      const serialized = `${JSON.stringify(entry)}\n`
      const existingBytes = existsSync(taskMemoryPath(cwd))
        ? lstatSync(taskMemoryPath(cwd)).size
        : 0
      if (
        existingBytes + Buffer.byteLength(serialized) >
        MAX_TASK_MEMORY_BYTES
      ) {
        throw new Error('Task memory would exceed the 64 MiB safety limit')
      }
      durableAppend(taskMemoryPath(cwd), serialized)
      endGenAiMemorySpan(span, {
        recordId: entry.id,
        recordCount: 1,
        records: [entry],
      })
      spanEnded = true
      return entry
    } finally {
      release()
    }
  } catch (error) {
    if (!spanEnded) endGenAiMemorySpan(span, { error })
    throw error
  }
}

export function appendProjectMemory(
  cwd: string,
  kind: TaskMemoryKind,
  text: string,
  meta?: Omit<Partial<TaskMemoryEntry>, 'id' | 'at' | 'kind' | 'text'>,
): TaskMemoryEntry {
  return appendTaskMemory(cwd, kind, text, meta)
}

export function readTaskMemory(cwd: string): TaskMemoryEntry[] {
  const span = startGenAiMemorySpan('search_memory', {
    storeId: TASK_MEMORY_STORE_ID,
  })
  try {
    const verification = verifyTaskMemory(cwd)
    if (!verification.valid) throw new TaskMemoryIntegrityError(verification)
    endGenAiMemorySpan(span, {
      recordCount: verification.entries.length,
      records: verification.entries,
    })
    return verification.entries
  } catch (error) {
    endGenAiMemorySpan(span, { error })
    throw error
  }
}

function replaceTaskMemoryWithBackup(
  cwd: string,
  replacement: string,
  label: 'quarantine' | 'rollback',
): string {
  const path = taskMemoryPath(cwd)
  const suffix = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}.${randomUUID()}`
  const backup = join(dirname(path), `task-memory.${label}.${suffix}.jsonl`)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let backedUp = false
  try {
    writeFileSync(temporary, replacement, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    const descriptor = openSync(temporary, constants.O_RDONLY)
    try {
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    renameSync(path, backup)
    backedUp = true
    renameSync(temporary, path)
    chmodSync(path, 0o600)
    chmodSync(backup, 0o600)
    return backup
  } catch (error) {
    if (backedUp && !existsSync(path) && existsSync(backup)) {
      renameSync(backup, path)
    }
    throw error
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // Replaced or never created.
    }
  }
}

export function quarantineInvalidTaskMemory(cwd: string): {
  changed: boolean
  quarantinePath?: string
  retainedEntries: number
  removedLines: number
} {
  const release = acquireTaskMemoryLock(cwd)
  try {
    const verification = verifyTaskMemory(cwd)
    if (verification.valid) {
      return {
        changed: false,
        retainedEntries: verification.entries.length,
        removedLines: 0,
      }
    }
    if (!existsSync(taskMemoryPath(cwd))) {
      throw new TaskMemoryIntegrityError(verification)
    }
    const totalLines = readFileSync(taskMemoryPath(cwd), 'utf8')
      .split('\n')
      .filter(line => line.length > 0).length
    const quarantinePath = replaceTaskMemoryWithBackup(
      cwd,
      verification.validPrefix,
      'quarantine',
    )
    return {
      changed: true,
      quarantinePath,
      retainedEntries: verification.entries.length,
      removedLines: Math.max(0, totalLines - verification.entries.length),
    }
  } finally {
    release()
  }
}

export function rollbackTaskMemory(
  cwd: string,
  targetId: string,
): { backupPath: string; retainedEntries: number; removedEntries: number } {
  const release = acquireTaskMemoryLock(cwd)
  try {
    const verification = verifyTaskMemory(cwd)
    if (!verification.valid) throw new TaskMemoryIntegrityError(verification)
    const index = verification.entries.findIndex(entry => entry.id === targetId)
    if (index === -1) throw new Error(`Task memory entry not found: ${targetId}`)
    const rawLines = readFileSync(taskMemoryPath(cwd), 'utf8')
      .split('\n')
      .filter(line => line.length > 0)
    const replacement = `${rawLines.slice(0, index + 1).join('\n')}\n`
    const backupPath = replaceTaskMemoryWithBackup(cwd, replacement, 'rollback')
    return {
      backupPath,
      retainedEntries: index + 1,
      removedEntries: verification.entries.length - index - 1,
    }
  } finally {
    release()
  }
}

export function readProjectMemoryByKind(
  cwd: string,
  kinds: TaskMemoryKind[],
): TaskMemoryEntry[] {
  return readTaskMemory(cwd).filter(entry => kinds.includes(entry.kind))
}

export function compressTaskMemory(cwd: string): string {
  const entries = readTaskMemory(cwd)
  const allKinds = TASK_MEMORY_KINDS
  const byKind = new Map<TaskMemoryKind, TaskMemoryEntry[]>()
  for (const kind of allKinds) {
    byKind.set(kind, entries.filter(entry => entry.kind === kind))
  }
  const lines = [
    '# Compressed Task Context',
    '',
    `Entries: ${entries.length}`,
    `Updated: ${new Date().toISOString()}`,
  ]
  for (const kind of allKinds) {
    lines.push('', `## ${kind[0]!.toUpperCase()}${kind.slice(1)}s`)
    const group = byKind.get(kind) ?? []
    if (group.length === 0) {
      lines.push('- none')
      continue
    }
    for (const entry of group.slice(-50)) {
      const meta = [
        entry.status ? `status=${entry.status}` : '',
        entry.scope ? `scope=${entry.scope}` : '',
        entry.source ? `source=${entry.source}` : '',
        entry.rationale ? `rationale=${entry.rationale}` : '',
      ]
        .filter(Boolean)
        .join(', ')
      lines.push(`- ${entry.at}: ${entry.text}${meta ? ` (${meta})` : ''}`)
    }
  }
  const body = `${lines.join('\n')}\n`
  mkdirSync(dirname(compressedContextPath(cwd)), { recursive: true })
  writeFileSync(compressedContextPath(cwd), body)
  return body
}

export function compressProjectMemory(cwd: string): string {
  return compressTaskMemory(cwd)
}

export function getProjectMemorySummary(
  cwd: string,
  maxPerKind = 10,
): string {
  const entries = readTaskMemory(cwd)
  const lines = ['# Project Memory Summary', '']
  for (const kind of TASK_MEMORY_KINDS) {
    const group = entries.filter(e => e.kind === kind).slice(-maxPerKind)
    if (group.length === 0) continue
    lines.push(`## ${kind[0]!.toUpperCase()}${kind.slice(1)}s`)
    for (const entry of group) {
      lines.push(`- ${entry.text}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

export function contextStatus(cwd: string): string {
  const files = [
    projectManifestPath(cwd),
    architectureSummaryPath(cwd),
    taskMemoryPath(cwd),
    compressedContextPath(cwd),
  ]
  const contextFiles = existsSync(contextDir(cwd)) ? readdirSync(contextDir(cwd)) : []
  const memory = verifyTaskMemory(cwd)
  return [
    'Project context status:',
    ...files.map(path => `  ${existsSync(path) ? 'yes' : 'no '} ${relative(cwd, path)}`),
    `  context files: ${contextFiles.length}`,
    `  memory integrity: ${memory.valid ? 'valid' : 'INVALID'} (${memory.verifiedEntries} protected, ${memory.legacyEntries} legacy)`,
  ].join('\n')
}
