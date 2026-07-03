#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import YAML from 'yaml'

const root = process.cwd()
const skipPrefixes = [
  '.git/',
  '.ur/',
  '.bun/',
  '.npm/',
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  'test-results/',
  'playwright-report/',
]
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const jsonExtensions = new Set(['.json', '.jsonc'])
const yamlExtensions = new Set(['.yaml', '.yml'])
const coreRuntimePrefixes = [
  'src/services/',
  'src/tools/',
  'src/utils/',
  'src/commands/',
  'src/hooks/',
]
// Staged TS migration baseline. These are pre-existing legacy/UI-heavy
// suppressions outside tsconfig.strict-core.json; this number should only go
// down as files are migrated.
const coreTsNoCheckBaseline = 124
let coreTsNoCheckCount = 0
let strictCoreFiles = new Set()

try {
  const strictConfig = parseJsonc(
    readFileSync(path.join(root, 'tsconfig.strict-core.json'), 'utf8'),
    [],
    { allowTrailingComma: true, disallowComments: false },
  )
  strictCoreFiles = new Set(
    (strictConfig?.files ?? []).map(file => normalizePath(String(file))),
  )
} catch {
  strictCoreFiles = new Set()
}

/** @type {{ file: string, line: number, column: number, rule: string, message: string }[]} */
const issues = []

function normalizePath(file) {
  return file.split(path.sep).join('/')
}

function shouldSkip(file) {
  const normalized = normalizePath(file)
  return skipPrefixes.some(prefix => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))
}

function fallbackWalk(dir, base = '') {
  /** @type {string[]} */
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (shouldSkip(rel)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...fallbackWalk(absolute, rel))
    } else if (entry.isFile()) {
      files.push(rel)
    }
  }
  return files
}

function listCandidateFiles() {
  try {
    return execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\0')
      .filter(Boolean)
      .filter(file => !shouldSkip(file))
  } catch {
    return fallbackWalk(root).filter(file => !shouldSkip(file))
  }
}

function addIssue(file, line, column, rule, message) {
  issues.push({ file, line: Math.max(1, line), column: Math.max(1, column), rule, message })
}

function lineColumnFromOffset(text, offset) {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/)
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

function checkConflictMarkers(file, text) {
  const lines = text.split(/\r\n|\r|\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (/^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(lines[index] ?? '')) {
      addIssue(file, index + 1, 1, 'no-merge-conflict-markers', 'merge conflict marker found')
    }
  }
}

function checkTsNoCheck(file, text) {
  if (!text.includes('@ts-nocheck')) return
  const normalized = normalizePath(file)
  const isCoreRuntime = coreRuntimePrefixes.some(prefix =>
    normalized.startsWith(prefix),
  )
  if (!isCoreRuntime) return
  coreTsNoCheckCount += 1
  if (strictCoreFiles.has(normalized)) {
    addIssue(
      file,
      1,
      1,
      'no-core-ts-nocheck',
      '@ts-nocheck is forbidden in strict-core runtime files',
    )
  }
}

function scriptKindFor(file) {
  const ext = path.extname(file)
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function rootIdentifierName(node) {
  let current = node
  while (true) {
    if (ts.isIdentifier(current)) return current.text
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isCallExpression(current)) {
      current = current.expression
      continue
    }
    return null
  }
}

function checkCode(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  )

  for (const diagnostic of source.parseDiagnostics) {
    const pos = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    addIssue(
      file,
      pos.line + 1,
      pos.character + 1,
      'syntax',
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    )
  }

  function visit(node) {
    if (ts.isDebuggerStatement(node)) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart(source))
      addIssue(file, pos.line + 1, pos.character + 1, 'no-debugger', 'debugger statement found')
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'only'
    ) {
      const rootName = rootIdentifierName(node.expression.expression)
      if (rootName === 'describe' || rootName === 'it' || rootName === 'test') {
        const pos = source.getLineAndCharacterOfPosition(node.expression.name.getStart(source))
        addIssue(
          file,
          pos.line + 1,
          pos.character + 1,
          'no-focused-tests',
          `${rootName}.only call found`,
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
}

function checkJson(file, text) {
  /** @type {import('jsonc-parser').ParseError[]} */
  const errors = []
  parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false })
  for (const error of errors) {
    const pos = lineColumnFromOffset(text, error.offset)
    addIssue(file, pos.line, pos.column, 'json-parse', printParseErrorCode(error.error))
  }
}

function checkYaml(file, text) {
  const doc = YAML.parseDocument(text, { prettyErrors: false })
  for (const error of doc.errors) {
    const linePos = error.linePos?.[0]
    if (linePos) {
      addIssue(file, linePos.line, linePos.col, 'yaml-parse', error.message)
      continue
    }
    const pos = lineColumnFromOffset(text, error.pos?.[0] ?? 0)
    addIssue(file, pos.line, pos.column, 'yaml-parse', error.message)
  }
}

for (const file of listCandidateFiles()) {
  const absolute = path.join(root, file)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
  const ext = path.extname(file)
  if (!codeExtensions.has(ext) && !jsonExtensions.has(ext) && !yamlExtensions.has(ext)) continue

  const text = readFileSync(absolute, 'utf8')
  checkConflictMarkers(file, text)
  if (codeExtensions.has(ext)) checkTsNoCheck(file, text)
  if (codeExtensions.has(ext)) checkCode(file, text)
  if (jsonExtensions.has(ext)) checkJson(file, text)
  if (yamlExtensions.has(ext)) checkYaml(file, text)
}

if (coreTsNoCheckCount > coreTsNoCheckBaseline) {
  addIssue(
    'tsconfig.strict-core.json',
    1,
    1,
    'no-new-core-ts-nocheck',
    `core @ts-nocheck count increased to ${coreTsNoCheckCount}; baseline is ${coreTsNoCheckBaseline}`,
  )
}

issues.sort((a, b) =>
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.column - b.column ||
  a.rule.localeCompare(b.rule),
)

if (issues.length > 0) {
  console.error(`UR lint failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}:`)
  for (const issue of issues) {
    console.error(`${issue.file}:${issue.line}:${issue.column} ${issue.rule} ${issue.message}`)
  }
  process.exit(1)
}

console.log('UR lint passed')
