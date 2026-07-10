/**
 * TypeScript compiler API engine for binding-aware repo editing.
 *
 * Builds a `ts.Program`, resolves the symbol at a position using the type
 * checker, and computes precise `WorkspaceEdit`s for rename. It avoids touching
 * comments, strings, shadowed names, or unrelated identifiers with the same text.
 */

import { dirname, join, relative } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import type {
  CallersOptions,
  MoveOptions,
  OrganizeImportsOptions,
  RenameOptions,
  SymbolRef,
  TextEdit,
  UnusedOptions,
  WorkspaceEdit,
} from './types.js'
import { resolveWorkspaceFile, workspaceRelativePath } from './workspaceEdit.js'

export type TypeScriptEngineContext = {
  program: ts.Program
  checker: ts.TypeChecker
}

export function loadProgram(root: string, files?: string[]): TypeScriptEngineContext {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  let program: ts.Program
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile)
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const host = ts.createCompilerHost(parsed.options)
    program = ts.createProgram(parsed.fileNames, parsed.options, host)
  } else {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.CommonJS,
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: false,
      jsx: ts.JsxEmit.React,
    }
    const host = ts.createCompilerHost(compilerOptions)
    const fileNames = files?.length ? files.map(f => join(root, f)) : []
    program = ts.createProgram(fileNames, compilerOptions, host)
  }
  return { program, checker: program.getTypeChecker() }
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function nodeAtPosition(sourceFile: ts.SourceFile, line: number, column: number): ts.Node | undefined {
  const pos = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1)
  return findNodeAtPosition(sourceFile, pos)
}

function findNodeAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Node | undefined {
  function visit(node: ts.Node): ts.Node | undefined {
    if (pos >= node.getStart(sourceFile) && pos < node.getEnd()) {
      let deepest: ts.Node = node
      ts.forEachChild(node, child => {
        const result = visit(child)
        if (result) deepest = result
      })
      return deepest
    }
    return undefined
  }
  return visit(sourceFile)
}

function symbolAtPosition(
  ctx: TypeScriptEngineContext,
  file: string,
  line: number,
  column: number,
): ts.Symbol | undefined {
  const abs = join(ctx.program.getCurrentDirectory(), file)
  const sourceFile = ctx.program.getSourceFile(abs)
  if (!sourceFile) return undefined
  const node = nodeAtPosition(sourceFile, line, column)
  if (!node) return undefined
  return ctx.checker.getSymbolAtLocation(node)
}

function allSourceFiles(ctx: TypeScriptEngineContext, root: string): ts.SourceFile[] {
  const result: ts.SourceFile[] = []
  for (const sf of ctx.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    result.push(sf)
  }
  return result
}

function relativePath(fileName: string, root: string): string {
  return fileName.startsWith(root) ? fileName.slice(root.length + 1) : fileName
}

function collectRelatedSymbols(ctx: TypeScriptEngineContext, symbol: ts.Symbol): Set<ts.Symbol> {
  const result = new Set<ts.Symbol>([symbol])
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const aliased = ctx.checker.getAliasedSymbol(symbol)
    if (aliased) result.add(aliased)
  }
  return result
}

function symbolsRelated(ctx: TypeScriptEngineContext, a: ts.Symbol, b: ts.Symbol): boolean {
  const aSymbols = collectRelatedSymbols(ctx, a)
  const bSymbols = collectRelatedSymbols(ctx, b)
  for (const symbol of aSymbols) {
    if (bSymbols.has(symbol)) return true
  }
  return false
}

function dedupeEdits(edits: TextEdit[]): TextEdit[] {
  const seen = new Set<string>()
  return edits.filter(edit => {
    const key = `${edit.file}:${edit.start}:${edit.end}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function addOldText(root: string, edits: TextEdit[]): TextEdit[] {
  const contentByFile = new Map<string, string>()
  return edits.map(edit => {
    let content = contentByFile.get(edit.file)
    if (content === undefined) {
      const abs = resolveWorkspaceFile(root, edit.file)
      content = existsSync(abs) ? readFileSync(abs, 'utf-8') : ''
      contentByFile.set(edit.file, content)
    }
    return { ...edit, oldText: content.slice(edit.start, edit.end) }
  })
}

export function tsRenameSymbol(
  ctx: TypeScriptEngineContext,
  options: Pick<RenameOptions, 'root' | 'from' | 'to' | 'file' | 'line' | 'column'>,
): WorkspaceEdit {
  const { root, from, to, file: maybeFile, line, column } = options
  const targetFile = maybeFile ? join(root, maybeFile) : undefined

  let targetSymbols: Set<ts.Symbol> | undefined
  if (maybeFile && line !== undefined && column !== undefined) {
    const symbol = symbolAtPosition(ctx, maybeFile, line, column)
    if (symbol) targetSymbols = collectRelatedSymbols(ctx, symbol)
  }
  if (!targetSymbols) {
    // Without a position we cannot distinguish shadowed symbols reliably, so we
    // fall back to the legacy text-only behavior and rename every identifier
    // with the matching text. This keeps the bare `ur repo-edit rename old new`
    // command working; position-aware calls get precise binding behavior.
    targetSymbols = undefined
  }

  const edits: TextEdit[] = []
  for (const sourceFile of allSourceFiles(ctx, root)) {
    if (targetFile && sourceFile.fileName !== targetFile) continue
    const rel = relativePath(sourceFile.fileName, root)
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      if (!ts.isIdentifier(node)) {
        ts.forEachChild(node, visit)
        return
      }
      if (node.text !== from) {
        ts.forEachChild(node, visit)
        return
      }
      if (targetSymbols) {
        const symbol = ctx.checker.getSymbolAtLocation(node)
        if (!symbol || !targetSymbols.has(symbol)) {
          ts.forEachChild(node, visit)
          return
        }
      }
      const start = node.getStart(sourceFile)
      const end = node.getEnd()
      edits.push({ file: rel, start, end, newText: to, oldText: node.text })
      ts.forEachChild(node, visit)
    })
  }

  return { edits: addOldText(root, dedupeEdits(edits)) }
}

export function tsRenameSymbolAtPosition(
  ctx: TypeScriptEngineContext,
  options: RenameOptions,
): WorkspaceEdit {
  return tsRenameSymbol(ctx, options)
}

export function tsMoveFunction(
  ctx: TypeScriptEngineContext,
  options: MoveOptions,
): WorkspaceEdit {
  const { root, symbol: symbolName, targetFile: targetFileRel, file: sourceFileRel } = options
  if (!sourceFileRel) {
    throw new Error('TS move requires --file to identify the source file')
  }
  const sourceAbs = join(root, sourceFileRel)
  const targetAbs = join(root, targetFileRel)
  const sourceSf = ctx.program.getSourceFile(sourceAbs)
  const targetSf = ctx.program.getSourceFile(targetAbs) ?? ctx.program.getSourceFile(targetFileRel)
  if (!sourceSf) throw new Error(`Source file not found: ${sourceFileRel}`)

  const edits: TextEdit[] = []
  let declarationNode: ts.Node | undefined
  ts.forEachChild(sourceSf, function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.text === symbolName
    ) {
      declarationNode = node
      return
    }
    ts.forEachChild(node, visit)
  })
  if (!declarationNode) throw new Error(`Symbol ${symbolName} not found in ${sourceFileRel}`)

  const text = declarationNode.getText(sourceSf)
  const targetRel = targetAbs.startsWith(root) ? targetAbs.slice(root.length + 1) : targetFileRel
  const targetExists = !!targetSf
  const targetContent = targetSf?.text ?? ''
  const insertOffset = targetContent.length
  const insertText =
    targetContent.length === 0
      ? text + '\n'
      : targetContent.endsWith('\n')
        ? text + '\n'
        : '\n' + text + '\n'
  edits.push({ file: targetRel, start: insertOffset, end: insertOffset, newText: insertText })
  if (!targetExists) {
    // Ensure the target file is part of the program by including its path.
    // The workspaceEdit applier will create the file because start/end are both 0.
  }

  const start = declarationNode.getStart(sourceSf)
  const end = declarationNode.getEnd()
  // Remove the declaration plus surrounding whitespace/newlines
  let removeStart = start
  while (removeStart > 0 && /\s/.test(sourceSf.text[removeStart - 1])) removeStart--
  let removeEnd = end
  while (removeEnd < sourceSf.text.length && /\s/.test(sourceSf.text[removeEnd])) removeEnd++
  edits.push({ file: sourceFileRel, start: removeStart, end: removeEnd, newText: '' })
  edits.push(...updateImportsForMovedSymbol(ctx, root, sourceFileRel, targetRel, symbolName))

  return { edits: addOldText(root, dedupeEdits(edits)) }
}

function updateImportsForMovedSymbol(
  ctx: TypeScriptEngineContext,
  root: string,
  sourceFileRel: string,
  targetFileRel: string,
  symbolName: string,
): TextEdit[] {
  const edits: TextEdit[] = []
  for (const sourceFile of allSourceFiles(ctx, root)) {
    const rel = relativePath(sourceFile.fileName, root)
    if (rel === sourceFileRel || rel === targetFileRel) continue
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
        ts.forEachChild(node, visit)
        return
      }
      const importedFile = resolveRelativeImport(rel, node.moduleSpecifier.text)
      if (importedFile !== stripKnownExtension(sourceFileRel)) {
        ts.forEachChild(node, visit)
        return
      }
      const namedBindings = node.importClause?.namedBindings
      if (!namedBindings || !ts.isNamedImports(namedBindings)) {
        ts.forEachChild(node, visit)
        return
      }
      const elementIndex = namedBindings.elements.findIndex(element =>
        (element.propertyName?.text ?? element.name.text) === symbolName,
      )
      if (elementIndex === -1) {
        ts.forEachChild(node, visit)
        return
      }

      const nextSpecifier = moduleSpecifierBetween(rel, targetFileRel)
      if (namedBindings.elements.length === 1) {
        edits.push({
          file: rel,
          start: node.moduleSpecifier.getStart(sourceFile) + 1,
          end: node.moduleSpecifier.getEnd() - 1,
          newText: nextSpecifier,
        })
      } else {
        const element = namedBindings.elements[elementIndex]!
        const removal = removalRangeForNamedImport(sourceFile, element, elementIndex < namedBindings.elements.length - 1)
        edits.push({ file: rel, ...removal, newText: '' })
        edits.push({
          file: rel,
          start: node.getEnd(),
          end: node.getEnd(),
          newText: `\nimport { ${symbolName} } from "${nextSpecifier}"`,
        })
      }
      ts.forEachChild(node, visit)
    })
  }
  return edits
}

function stripKnownExtension(file: string): string {
  return file.replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i, '')
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function resolveRelativeImport(importingFileRel: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = normalizePath(join(dirname(importingFileRel), specifier))
  return stripKnownExtension(base)
}

function moduleSpecifierBetween(importingFileRel: string, targetFileRel: string): string {
  let specifier = normalizePath(relative(dirname(importingFileRel), stripKnownExtension(targetFileRel)))
  if (!specifier.startsWith('.')) specifier = `./${specifier}`
  return specifier
}

function removalRangeForNamedImport(
  sourceFile: ts.SourceFile,
  element: ts.ImportSpecifier,
  hasNext: boolean,
): Pick<TextEdit, 'start' | 'end'> {
  let start = element.getStart(sourceFile)
  let end = element.getEnd()
  if (hasNext) {
    while (end < sourceFile.text.length && /\s/.test(sourceFile.text[end]!)) end++
    if (sourceFile.text[end] === ',') end++
    while (end < sourceFile.text.length && /\s/.test(sourceFile.text[end]!)) end++
  } else {
    while (start > 0 && /\s/.test(sourceFile.text[start - 1]!)) start--
    if (sourceFile.text[start - 1] === ',') start--
    while (start > 0 && /\s/.test(sourceFile.text[start - 1]!)) start--
  }
  return { start, end }
}

export function tsOrganizeImports(
  ctx: TypeScriptEngineContext,
  options: OrganizeImportsOptions,
): WorkspaceEdit {
  const { file: maybeFile, root } = options
  const files = maybeFile
    ? [workspaceRelativePath(root, maybeFile)]
    : allSourceFiles(ctx, root).flatMap(sourceFile => {
        try {
          return [workspaceRelativePath(root, sourceFile.fileName)]
        } catch {
          return []
        }
      })
  const edits: TextEdit[] = []
  const compilerOptions = ctx.program.getCompilerOptions()
  const service = ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...ctx.program.getRootFileNames()],
    getScriptVersion: () => '0',
    getScriptSnapshot: fileName => {
      const text = ts.sys.readFile(fileName)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  })
  for (const file of files) {
    const abs = resolveWorkspaceFile(root, file)
    const content = readFileSync(abs, 'utf-8')
    const changes = service.organizeImports(
      { type: 'file', fileName: abs, mode: ts.OrganizeImportsMode.SortAndCombine },
      {},
      { organizeImportsIgnoreCase: 'auto' },
    )
    for (const change of changes) {
      const safeFile = workspaceRelativePath(root, change.fileName)
      for (const textChange of change.textChanges) {
        const start = textChange.span.start
        const end = start + textChange.span.length
        edits.push({
          file: safeFile,
          start,
          end,
          newText: textChange.newText,
          oldText: safeFile === file ? content.slice(start, end) : undefined,
        })
      }
    }
  }
  service.dispose()
  return { edits: addOldText(root, dedupeEdits(edits)) }
}

export function tsFindUnused(
  ctx: TypeScriptEngineContext,
  options: UnusedOptions,
): SymbolRef[] {
  const { root, file: maybeFile } = options
  const result: SymbolRef[] = []
  for (const sourceFile of allSourceFiles(ctx, root)) {
    const rel = relativePath(sourceFile.fileName, root)
    if (maybeFile && rel !== maybeFile) continue
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const symbol = ctx.checker.getSymbolAtLocation(node.name)
        if (symbol && symbol.declarations?.length === 1) {
          if (countSymbolReferences(ctx, symbol, node.name) === 0) {
            const loc = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile))
            result.push({ file: rel, line: loc.line + 1, column: loc.character + 1, name: node.name.text, kind: 'variable' })
          }
        }
      }
      ts.forEachChild(node, visit)
    })
  }
  return result
}

function countSymbolReferences(
  ctx: TypeScriptEngineContext,
  targetSymbol: ts.Symbol,
  declarationName: ts.Identifier,
): number {
  let count = 0
  const declarationFile = declarationName.getSourceFile().fileName
  const declarationStart = declarationName.getStart(declarationName.getSourceFile())
  for (const sourceFile of allSourceFiles(ctx, ctx.program.getCurrentDirectory())) {
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      if (ts.isIdentifier(node)) {
        const symbol = ctx.checker.getSymbolAtLocation(node)
        if (symbol && symbolsRelated(ctx, symbol, targetSymbol)) {
          const isDeclaration =
            sourceFile.fileName === declarationFile &&
            node.getStart(sourceFile) === declarationStart
          if (!isDeclaration) count++
        }
      }
      ts.forEachChild(node, visit)
    })
  }
  return count
}

export function tsFindCallers(
  ctx: TypeScriptEngineContext,
  options: CallersOptions,
): SymbolRef[] {
  const { root, symbol: symbolName, file: maybeFile } = options
  const result: SymbolRef[] = []
  let targetSymbol: ts.Symbol | undefined

  for (const sourceFile of allSourceFiles(ctx, root)) {
    if (maybeFile && relativePath(sourceFile.fileName, root) !== maybeFile) continue
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && node.text === symbolName) {
        const symbol = ctx.checker.getSymbolAtLocation(node)
        if (symbol && symbol.getName() === symbolName) {
          targetSymbol = symbol
        }
      }
      ts.forEachChild(node, visit)
    })
  }
  if (!targetSymbol) return result

  for (const sourceFile of allSourceFiles(ctx, root)) {
    const rel = relativePath(sourceFile.fileName, root)
    ts.forEachChild(sourceFile, function visit(node: ts.Node): void {
      let isCall = false
      let callName: ts.Node | undefined
      if (ts.isCallExpression(node)) {
        isCall = true
        callName = node.expression
      } else if (ts.isNewExpression(node)) {
        isCall = true
        callName = node.expression
      }
      if (!isCall || !callName) {
        ts.forEachChild(node, visit)
        return
      }
      const symbol = ctx.checker.getSymbolAtLocation(callName)
      if (!symbol || !collectRelatedSymbols(ctx, targetSymbol!).has(symbol)) {
        ts.forEachChild(node, visit)
        return
      }
      const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      result.push({ file: rel, line: loc.line + 1, column: loc.character + 1, name: symbolName, kind: 'function' })
      ts.forEachChild(node, visit)
    })
  }
  return result
}

export function tsFindSymbolAtPosition(
  ctx: TypeScriptEngineContext,
  file: string,
  line: number,
  column: number,
): SymbolRef | null {
  const symbol = symbolAtPosition(ctx, file, line, column)
  if (!symbol) return null
  return {
    file,
    line,
    column,
    name: symbol.getName(),
    kind: 'unknown',
  }
}
