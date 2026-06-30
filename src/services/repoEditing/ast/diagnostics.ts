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

const execAsync = promisify(exec)

const DEFAULT_COMMANDS: Partial<Record<string, string>> = {
  python: 'python3 -m pyright --outputjson',
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
  const tsFiles = files.filter(isTypeScriptPath)
  if (tsFiles.length > 0) {
    return collectTsDiagnostics(root, tsFiles)
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

function parseExternalOutput(stdout: string): Record<string, DiagnosticFile[]> {
  const files: Record<string, DiagnosticFile[]> = {}
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
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
    const entry: DiagnosticFile = {
      file,
      line: lineNum || 1,
      column: columnNum || 1,
      severity,
      message,
      code: typeof asRecord.code === 'string' || typeof asRecord.code === 'number' ? asRecord.code : undefined,
    }
    files[file] = files[file] ?? []
    files[file]!.push(entry)
  }
  return files
}

export function resolveDefaultExternalCommand(language: string): string | undefined {
  return DEFAULT_COMMANDS[language]
}
