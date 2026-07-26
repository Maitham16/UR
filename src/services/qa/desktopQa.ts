import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { ZodError } from 'zod'
import { recordArtifact, type Artifact } from '../agents/artifacts.js'
import { ensurePrivateDirectory } from '../../utils/privateState.js'
import {
  electronDesktopQaDriver,
  type DesktopQaDiagnostic,
  type DesktopQaDriver,
  type DesktopQaDriverSession,
} from './electronDesktopQaDriver.js'
import {
  desktopQaFixtureSchema,
  parseDesktopQaFixture,
  type DesktopQaFixture,
  type DesktopQaStep,
} from './desktopQaSchema.js'

const MAX_FIXTURE_BYTES = 1024 * 1024
const MAX_EVIDENCE_FILE_BYTES = 256 * 1024 * 1024
const MAX_EVIDENCE_TOTAL_BYTES = 512 * 1024 * 1024
const DEFAULT_STEP_TIMEOUT_MS = 30_000

export type DesktopQaStepResult = {
  index: number
  action: DesktopQaStep['action']
  status: 'passed' | 'failed'
  durationMs: number
  evidence?: string
  error?: string
}

export type DesktopQaReport = {
  version: 1
  id: string
  fixture: {
    name: string
    driver: 'electron'
    steps: number
    executable?: string
  }
  status: 'passed' | 'failed'
  startedAt: string
  completedAt: string
  durationMs: number
  steps: DesktopQaStepResult[]
  diagnostics: DesktopQaDiagnostic[]
  evidence: Array<{
    file: string
    role: 'screenshot' | 'video' | 'trace'
    sizeBytes: number
  }>
  warnings: string[]
  error?: string
}

export type DesktopQaRunResult = {
  report: DesktopQaReport
  artifact: Artifact
  runDirectory?: string
}

export type DesktopQaRunOptions = {
  driver?: DesktopQaDriver
  keepRunDirectory?: boolean
  runId?: string
  allowOutsideWorkspace?: boolean
}

function safeRunId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 100)
  if (!normalized) throw new Error('Desktop QA run id is empty after normalization')
  return normalized
}

function safeEvidenceName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || 'screenshot'
  )
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

export function validateDesktopQaLaunchPolicy(
  cwd: string,
  fixture: DesktopQaFixture,
  allowOutsideWorkspace = false,
): void {
  const workspace = realpathSync(cwd)
  const launchCwd = resolve(cwd, fixture.launch.cwd ?? '.')
  const launchCwdInfo = statSync(launchCwd)
  if (!launchCwdInfo.isDirectory()) {
    throw new Error(`Desktop QA launch cwd is not a directory: ${launchCwd}`)
  }
  const realLaunchCwd = realpathSync(launchCwd)
  if (!allowOutsideWorkspace && !pathIsWithin(workspace, realLaunchCwd)) {
    throw new Error(
      'Desktop QA launch cwd resolves outside the workspace; rerun with --allow-external after reviewing the fixture.',
    )
  }
  if (!fixture.launch.executablePath) return
  const executable = resolve(cwd, fixture.launch.executablePath)
  const executableInfo = statSync(executable)
  if (!executableInfo.isFile()) {
    throw new Error(
      `Desktop QA executable is not a regular file: ${executable}`,
    )
  }
  const realExecutable = realpathSync(executable)
  if (!allowOutsideWorkspace && !pathIsWithin(workspace, realExecutable)) {
    throw new Error(
      'Desktop QA executable resolves outside the workspace; rerun with --allow-external after reviewing the fixture.',
    )
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => `${issue.path.join('.') || 'fixture'}: ${issue.message}`)
    .join('; ')
}

export function validateDesktopQaFixture(input: unknown): {
  valid: boolean
  fixture?: DesktopQaFixture
  errors: string[]
} {
  const result = desktopQaFixtureSchema.safeParse(input)
  return result.success
    ? { valid: true, fixture: result.data, errors: [] }
    : {
        valid: false,
        errors: result.error.issues.map(
          issue => `${issue.path.join('.') || 'fixture'}: ${issue.message}`,
        ),
      }
}

export function loadDesktopQaFixture(path: string): DesktopQaFixture {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`Desktop QA fixture must be a regular non-symlink file: ${path}`)
  }
  if (info.size > MAX_FIXTURE_BYTES) {
    throw new Error('Desktop QA fixture exceeds the 1 MiB limit')
  }
  let input: unknown
  try {
    input = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    throw new Error(
      `Unable to parse desktop QA fixture: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    return parseDesktopQaFixture(input)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid desktop QA fixture: ${formatZodError(error)}`)
    }
    throw error
  }
}

function secretValues(fixture: DesktopQaFixture): string[] {
  const values = Object.values(fixture.launch.env ?? {})
  for (const step of fixture.steps) {
    if (
      step.action === 'fill' &&
      /(?:pass|secret|token|key|credential|auth)/iu.test(step.selector)
    ) {
      values.push(step.value)
    }
  }
  return [...new Set(values.filter(value => value.length >= 4))].sort(
    (left, right) => right.length - left.length,
  )
}

function redactor(fixture: DesktopQaFixture): (value: string) => string {
  const values = secretValues(fixture)
  return (input: string): string => {
    let value = input
    for (const secret of values) value = value.split(secret).join('[REDACTED]')
    return value
      .replace(
        /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/giu,
        '$1[REDACTED]',
      )
      .replace(
        /\b((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,
        '$1[REDACTED]',
      )
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED]')
      .slice(0, 8_192)
  }
}

function errorText(error: unknown, redact: (value: string) => string): string {
  return redact(error instanceof Error ? error.message : String(error))
}

function remainingTimeout(
  deadline: number,
  requested = DEFAULT_STEP_TIMEOUT_MS,
): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Desktop QA fixture timed out')
  return Math.max(1, Math.min(requested, remaining))
}

async function executeStep(
  session: DesktopQaDriverSession,
  step: DesktopQaStep,
  options: {
    index: number
    deadline: number
    runDir: string
    redactSelectors: string[]
  },
): Promise<string | undefined> {
  const timeout = remainingTimeout(
    options.deadline,
    'timeoutMs' in step ? step.timeoutMs : undefined,
  )
  switch (step.action) {
    case 'click':
      await session.click(step.selector, timeout)
      return undefined
    case 'fill':
      await session.fill(step.selector, step.value, timeout)
      return undefined
    case 'press':
      await session.press(step.selector, step.key, timeout)
      return undefined
    case 'select':
      await session.select(step.selector, step.value, timeout)
      return undefined
    case 'check':
      await session.check(step.selector, step.checked, timeout)
      return undefined
    case 'waitFor':
      await session.waitFor(step.selector, step.state, timeout)
      return undefined
    case 'wait': {
      const duration = Math.min(
        step.durationMs,
        remainingTimeout(options.deadline, step.durationMs || 1),
      )
      await new Promise(resolvePromise => setTimeout(resolvePromise, duration))
      return undefined
    }
    case 'assertText':
      await session.assertText(
        step.selector,
        step.text,
        step.exact,
        timeout,
      )
      return undefined
    case 'assertVisible':
      await session.assertVisible(
        step.selector,
        step.visible,
        timeout,
      )
      return undefined
    case 'screenshot': {
      const name = safeEvidenceName(step.name ?? `step-${options.index + 1}`)
      const path = join(
        options.runDir,
        `${String(options.index + 1).padStart(3, '0')}-${name}.png`,
      )
      await session.screenshot(path, {
        fullPage: step.fullPage,
        timeoutMs: timeout,
        redactSelectors: options.redactSelectors,
      })
      return path
    }
  }
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && !entry.isSymbolicLink()) files.push(path)
    }
  }
  visit(root)
  return files
}

function evidenceRole(
  path: string,
): 'screenshot' | 'video' | 'trace' | null {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'screenshot'
  if (extension === '.webm' || extension === '.mp4') return 'video'
  if (extension === '.zip') return 'trace'
  return null
}

function collectEvidence(
  runDir: string,
  warnings: string[],
): Array<{
  file: string
  role: 'screenshot' | 'video' | 'trace'
  sizeBytes: number
}> {
  const entries = walkFiles(runDir)
    .map(file => {
      const role = evidenceRole(file)
      return role ? { file, role, sizeBytes: statSync(file).size } : null
    })
    .filter(
      (
        entry,
      ): entry is {
        file: string
        role: 'screenshot' | 'video' | 'trace'
        sizeBytes: number
      } => entry !== null,
    )
  for (const entry of [...entries]) {
    if (entry.sizeBytes <= MAX_EVIDENCE_FILE_BYTES) continue
    unlinkSync(entry.file)
    entries.splice(entries.indexOf(entry), 1)
    warnings.push(
      `Removed oversized ${entry.role} evidence (${entry.sizeBytes} bytes; limit 256 MiB).`,
    )
  }
  let total = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  for (const entry of [...entries].sort((a, b) => b.sizeBytes - a.sizeBytes)) {
    if (total <= MAX_EVIDENCE_TOTAL_BYTES) break
    unlinkSync(entry.file)
    entries.splice(entries.indexOf(entry), 1)
    total -= entry.sizeBytes
    warnings.push(
      `Removed ${entry.role} evidence to stay within the 512 MiB run limit.`,
    )
  }
  return entries.sort((left, right) => left.file.localeCompare(right.file))
}

function mimeType(role: 'screenshot' | 'video' | 'trace', file: string): string {
  if (role === 'screenshot') return 'image/png'
  if (role === 'trace') return 'application/zip'
  return extname(file).toLowerCase() === '.mp4' ? 'video/mp4' : 'video/webm'
}

export async function runDesktopQaFixture(
  cwd: string,
  input: string | DesktopQaFixture | unknown,
  options: DesktopQaRunOptions = {},
): Promise<DesktopQaRunResult> {
  const fixture =
    typeof input === 'string'
      ? loadDesktopQaFixture(input)
      : parseDesktopQaFixture(input)
  const driver = options.driver ?? electronDesktopQaDriver
  if (driver.name !== fixture.driver) {
    throw new Error(
      `Fixture requests ${fixture.driver}, but the injected driver is ${driver.name}`,
    )
  }
  validateDesktopQaLaunchPolicy(
    cwd,
    fixture,
    options.allowOutsideWorkspace ?? false,
  )
  const id = safeRunId(options.runId ?? randomUUID())
  const runDir = join(cwd, '.ur', 'desktop-qa', 'runs', id)
  if (existsSync(runDir)) {
    throw new Error(`Desktop QA run directory already exists: ${runDir}`)
  }
  ensurePrivateDirectory(join(cwd, '.ur'), runDir)
  try {
    const started = Date.now()
    const startedAt = new Date(started).toISOString()
    const deadline = started + fixture.timeoutMs
    const redact = redactor(fixture)
    const results: DesktopQaStepResult[] = []
    const warnings: string[] = []
    let session: DesktopQaDriverSession | null = null
    let failed: unknown

    try {
      session = await driver.launch(fixture, { cwd, runDir })
      if (fixture.ready) {
        await session.waitFor(
          fixture.ready.selector,
          'visible',
          remainingTimeout(deadline, fixture.ready.timeoutMs),
        )
      }
      for (let index = 0; index < fixture.steps.length; index++) {
        const step = fixture.steps[index]!
        const stepStarted = Date.now()
        try {
          const evidence = await executeStep(session, step, {
            index,
            deadline,
            runDir,
            redactSelectors: fixture.recording.redactSelectors,
          })
          results.push({
            index,
            action: step.action,
            status: 'passed',
            durationMs: Date.now() - stepStarted,
            ...(evidence
              ? { evidence: relative(runDir, evidence) }
              : {}),
          })
        } catch (error) {
          results.push({
            index,
            action: step.action,
            status: 'failed',
            durationMs: Date.now() - stepStarted,
            error: errorText(error, redact),
          })
          throw error
        }
      }
      if (fixture.recording.screenshots) {
        await session.screenshot(join(runDir, 'final.png'), {
          fullPage: false,
          timeoutMs: remainingTimeout(deadline, 15_000),
          redactSelectors: fixture.recording.redactSelectors,
        })
      }
    } catch (error) {
      failed = error
      if (session && fixture.recording.screenshotOnFailure) {
        try {
          await session.screenshot(join(runDir, 'failure.png'), {
            fullPage: false,
            timeoutMs: Math.max(1, Math.min(10_000, deadline - Date.now())),
            redactSelectors: fixture.recording.redactSelectors,
          })
        } catch (screenshotError) {
          warnings.push(
            `Unable to capture failure screenshot: ${errorText(screenshotError, redact)}`,
          )
        }
      }
    } finally {
      if (session) {
        try {
          await session.close()
        } catch (closeError) {
          failed ??= closeError
          warnings.push(
            `Driver teardown failed: ${errorText(closeError, redact)}`,
          )
        }
      }
    }

    const diagnostics = (session?.diagnostics() ?? []).map(entry => ({
      ...entry,
      text: redact(entry.text),
    }))
    const evidence = collectEvidence(runDir, warnings)
    const incompatibleRawEvidence =
      fixture.recording.redactSelectors.length > 0
        ? evidence.filter(
            entry => entry.role === 'trace' || entry.role === 'video',
          )
        : []
    if (incompatibleRawEvidence.length > 0) {
      for (const entry of incompatibleRawEvidence) {
        rmSync(entry.file, { force: true })
      }
      throw new Error(
        'Desktop QA driver emitted raw trace or video while selector redaction was active; raw evidence was discarded.',
      )
    }
    const completed = Date.now()
    const report: DesktopQaReport = {
      version: 1,
      id,
      fixture: {
        name: fixture.name,
        driver: fixture.driver,
        steps: fixture.steps.length,
        ...(fixture.launch.executablePath
          ? { executable: basename(fixture.launch.executablePath) }
          : {}),
      },
      status: failed ? 'failed' : 'passed',
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      steps: results,
      diagnostics,
      evidence: evidence.map(entry => ({
        ...entry,
        file: relative(runDir, entry.file),
      })),
      warnings,
      ...(failed ? { error: errorText(failed, redact) } : {}),
    }
    const reportPath = join(runDir, 'report.json')
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    })

    const artifact = recordArtifact(cwd, {
      kind: evidence.some(entry => entry.role === 'video')
        ? 'browser-recording'
        : evidence.some(entry => entry.role === 'screenshot')
          ? 'screenshot'
          : 'test-run',
      title: `Desktop QA — ${fixture.name}`,
      file: reportPath,
      summary: `${report.status}: ${results.filter(step => step.status === 'passed').length}/${fixture.steps.length} steps passed`,
      attachments: evidence.map(entry => ({
        file: entry.file,
        role: entry.role,
        mimeType: mimeType(entry.role, entry.file),
      })),
    })
    return {
      report,
      artifact,
      ...(options.keepRunDirectory ? { runDirectory: runDir } : {}),
    }
  } finally {
    if (!options.keepRunDirectory) {
      rmSync(runDir, { recursive: true, force: true })
    }
  }
}
