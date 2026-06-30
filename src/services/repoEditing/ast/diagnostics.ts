/**
 * Diagnostic snapshots before/after AST edits.
 *
 * For TS/JS we use the TypeScript compiler API. For other languages we prefer
 * an external command when one is configured or available. Results are stored
 * in a language-agnostic `DiagnosticSnapshot` so the orchestrator can diff them.
 */

import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import type { DiagnosticFile, DiagnosticSnapshot, DiagnosticSource } from './types.js'
import { languageFromPathWithAdapters } from './engineRouter.js'

const execAsync = promisify(exec)

const DEFAULT_COMMANDS: Partial<Record<string, string>> = {
  python: 'pyright --outputjson',
  rust: 'cargo check --message-format=json',
  go: 'go vet ./...',
}

export function emptySnapshot(source: DiagnosticSource = 'none'): DiagnosticSnapshot {
  return { files: {}, collectedAt: new Date().toISOString(), source }
}

export async function collectDiagnostics(
  root: string,
  files: string[],
  options: { source?: DiagnosticSource; externalCommand?: string } = {},
): Promise<DiagnosticSnapshot> {
  if (options.source === 'none') return emptySnapshot('none')
  if (options.externalCommand) {
    return runExternalCommand(root, files, options.externalCommand)
  }

  const snapshots: DiagnosticSnapshot[] = []
  const tsFiles = files.filter(isTypeScriptPath)
  if (tsFiles.length > 0) {
    snapshots.push(collectTsDiagnostics(root, tsFiles))
  }

  const externalByLanguage = new Map<string, string[]>()
  for (const file of files.filter(file => !isTypeScriptPath(file))) {
    const language = await languageFromPathWithAdapters(file)
    if (!language) continue
    externalByLanguage.set(language, [
      ...(externalByLanguage.get(language) ?? []),
      file,
    ])
  }
  for (const [language, languageFiles] of externalByLanguage) {
    const command = resolveDefaultExternalCommand(language)
    if (!command) continue
    snapshots.push(await runExternalCommand(root, languageFiles, command))
  }

  if (snapshots.length === 1) {
    return snapshots[0]!
  }
  if (snapshots.length > 1) {
    return mergeSnapshots(snapshots)
  }
  return emptySnapshot('none')
}

export function diagnosticsDiff(
  before: DiagnosticSnapshot,
  after: DiagnosticSnapshot,
): DiagnosticFile[] {
  const key = (d: DiagnosticFile) =>
    `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`
  const beforeKeys = new Set((before.files ? Object.values(before.files).flat() : []).map(key))
  const afterFiles = after.files ? Object.values(after.files).flat() : []
  return afterFiles.filter(d => !beforeKeys.has(key(d)))
}

function isTypeScriptPath(file: string): boolean {
  const ext = file.toLowerCase()
  return ext.endsWith('.ts') || ext.endsWith('.tsx') || ext.endsWith('.js') || ext.endsWith('.jsx')
}


function mergeSnapshots(snapshots: DiagnosticSnapshot[]): DiagnosticSnapshot {
  const files: Record<string, DiagnosticFile[]> = {}
  for (const snapshot of snapshots) {
    for (const [file, diagnostics] of Object.entries(snapshot.files)) {
      files[file] = [...(files[file] ?? []), ...diagnostics]
    }
  }
  return {
    files,
    collectedAt: new Date().toISOString(),
    source: snapshots.some(s => s.source === 'external') ? 'external' : 'tsc',
  }
}

function loadTsConfig(root: string): { config?: ts.ParsedCommandLine; error?: string } {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath) return {}
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  if (read.error) {
    return { error: ts.flattenDiagnosticMessageText(read.error.messageText, '\n') }
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
  return { config: parsed }
}

function createSyntheticProgram(root: string, files: string[]): ts.Program {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.CommonJS,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    strict: false,
  }
  const host = ts.createCompilerHost(compilerOptions)
  const fileNames = files.map(f => join(root, f))
  return ts.createProgram(fileNames, compilerOptions, host)
}

function collectTsDiagnostics(root: string, files: string[]): DiagnosticSnapshot {
  const tsConfig = loadTsConfig(root)
  let program: ts.Program
  if (tsConfig.config?.fileNames?.length) {
    const host = ts.createCompilerHost(tsConfig.config.options)
    program = ts.createProgram(
      tsConfig.config.fileNames,
      tsConfig.config.options,
      host,
    )
  } else {
    program = createSyntheticProgram(root, files)
  }

  const diagnostics = ts.getPreEmitDiagnostics(program)
  const snapshot: DiagnosticSnapshot = {
    files: {},
    collectedAt: new Date().toISOString(),
    source: 'tsc',
  }
  for (const diagnostic of diagnostics) {
    if (!diagnostic.file || diagnostic.start === undefined) continue
    const fileName = diagnostic.file.fileName
    const rel = fileName.startsWith(root) ? fileName.slice(root.length + 1) : fileName
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const entry: DiagnosticFile = {
      file: rel,
      line: line + 1,
      column: character + 1,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      code: typeof diagnostic.code === 'number' ? diagnostic.code : undefined,
    }
    snapshot.files[rel] = snapshot.files[rel] ?? []
    snapshot.files[rel]!.push(entry)
  }
  return snapshot
}

async function runExternalCommand(
  root: string,
  _files: string[],
  command: string,
): Promise<DiagnosticSnapshot> {
  try {
    const { stdout } = await execAsync(command, {
      cwd: root,
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })
    const parsed = parseExternalOutput(stdout)
    return {
      files: parsed,
      collectedAt: new Date().toISOString(),
      source: 'external',
    }
  } catch (error) {
    const e = error as Error & { stdout?: string }
    const parsed = parseExternalOutput(e.stdout ?? '')
    return {
      files: parsed,
      collectedAt: new Date().toISOString(),
      source: 'external',
    }
  }
}

export function parseExternalOutput(stdout: string): Record<string, DiagnosticFile[]> {
  const files: Record<string, DiagnosticFile[]> = {}
  const add = (entry: DiagnosticFile): void => {
    files[entry.file] = files[entry.file] ?? []
    files[entry.file]!.push(entry)
  }

  try {
    const parsed = JSON.parse(stdout)
    for (const entry of diagnosticsFromJsonObject(parsed)) {
      add(entry)
    }
    if (Object.keys(files).length > 0) return files
  } catch {
    // Fall through to JSONL/plain-text parsing.
  }

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      const plain = parsePlainDiagnosticLine(line)
      if (plain) add(plain)
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const jsonEntries = diagnosticsFromJsonObject(parsed)
    if (jsonEntries.length > 0) {
      for (const entry of jsonEntries) add(entry)
      continue
    }
    const asRecord = parsed as Record<string, unknown>
    const file =
      typeof asRecord.file === 'string'
        ? asRecord.file
        : typeof (asRecord as { fileName?: unknown }).fileName === 'string'
          ? (asRecord as { fileName: string }).fileName
          : undefined
    const message =
      typeof asRecord.message === 'string'
        ? asRecord.message
        : typeof asRecord.messageText === 'string'
          ? asRecord.messageText
          : undefined
    if (!file || !message) continue
    const lineNum = Number(asRecord.line ?? 0)
    const columnNum = Number(asRecord.column ?? 0)
    const severity: DiagnosticFile['severity'] =
      asRecord.severity === 'error'
        ? 'error'
        : asRecord.severity === 'warning'
          ? 'warning'
          : 'error'
    add({
      file,
      line: lineNum || 1,
      column: columnNum || 1,
      severity,
      message,
      code: typeof asRecord.code === 'string' || typeof asRecord.code === 'number' ? asRecord.code : undefined,
    })
  }
  return files
}

function diagnosticsFromJsonObject(value: unknown): DiagnosticFile[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>

  if (Array.isArray(record.generalDiagnostics)) {
    return record.generalDiagnostics.flatMap(diagnostic => {
      if (!diagnostic || typeof diagnostic !== 'object') return []
      const diag = diagnostic as Record<string, unknown>
      const file = typeof diag.file === 'string' ? diag.file : undefined
      const message = typeof diag.message === 'string' ? diag.message : undefined
      const range = diag.range as { start?: { line?: unknown; character?: unknown } } | undefined
      if (!file || !message) return []
      return [{
        file,
        line: Number(range?.start?.line ?? 0) + 1,
        column: Number(range?.start?.character ?? 0) + 1,
        severity: toSeverity(diag.severity),
        message,
        code: typeof diag.rule === 'string' ? diag.rule : undefined,
      }]
    })
  }

  if (record.reason === 'compiler-message' && record.message && typeof record.message === 'object') {
    const messageRecord = record.message as Record<string, unknown>
    const spans = Array.isArray(messageRecord.spans) ? messageRecord.spans : []
    const span =
      spans.find(span => span && typeof span === 'object' && (span as { is_primary?: unknown }).is_primary === true) ??
      spans[0]
    if (span && typeof span === 'object') {
      const spanRecord = span as Record<string, unknown>
      const file = typeof spanRecord.file_name === 'string' ? spanRecord.file_name : undefined
      const message = typeof messageRecord.message === 'string' ? messageRecord.message : undefined
      if (file && message) {
        const code =
          messageRecord.code && typeof messageRecord.code === 'object'
            ? (messageRecord.code as { code?: unknown }).code
            : undefined
        return [{
          file,
          line: Number(spanRecord.line_start ?? 1),
          column: Number(spanRecord.column_start ?? 1),
          severity: toSeverity(messageRecord.level),
          message,
          code: typeof code === 'string' || typeof code === 'number' ? code : undefined,
        }]
      }
    }
  }

  return []
}

function parsePlainDiagnosticLine(line: string): DiagnosticFile | null {
  const match = /^(.*?):(\d+):(?:(\d+):)?\s*(.+)$/.exec(line.trim())
  if (!match) return null
  return {
    file: match[1]!,
    line: Number(match[2]),
    column: Number(match[3] ?? 1),
    severity: 'error',
    message: match[4]!,
  }
}

function toSeverity(value: unknown): DiagnosticFile['severity'] {
  if (value === 'warning' || value === 'information' || value === 'hint') {
    return value
  }
  return 'error'
}

export function resolveDefaultExternalCommand(language: string): string | undefined {
  return DEFAULT_COMMANDS[language]
}
