/**
 * Shared types for AST-aware repo editing.
 *
 * All engines (TypeScript compiler API, LSP, Tree-sitter) normalize their
 * results into the same `WorkspaceEdit` / `TextEdit` shape so one applier,
 * patch formatter, and rollback path can serve every language.
 */

export type Language =
  | 'ts'
  | 'js'
  | 'tsx'
  | 'jsx'
  | 'python'
  | 'rust'
  | 'go'

export type SymbolKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'interface'
  | 'type'
  | 'import'
  | 'parameter'
  | 'unknown'

export type SymbolRef = {
  file: string
  line: number
  column: number
  name: string
  kind: SymbolKind
}

export type TextEdit = {
  file: string
  start: number
  end: number
  newText: string
  oldText?: string
}

export type WorkspaceEdit = {
  edits: TextEdit[]
}

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export type DiagnosticFile = {
  file: string
  line: number
  column: number
  severity: DiagnosticSeverity
  message: string
  source?: string
  code?: string | number
}

export type DiagnosticSource = 'lsp' | 'tsc' | 'external' | 'none'

export type DiagnosticSnapshot = {
  files: Record<string, DiagnosticFile[]>
  collectedAt: string
  source: DiagnosticSource
}

export type EditKind =
  | 'rename'
  | 'move'
  | 'organize-imports'
  | 'unused'
  | 'callers'

export type EditPlan = {
  kind: EditKind
  edits: WorkspaceEdit
  affectedFiles: string[]
  description: string
  diagnosticsBefore: DiagnosticSnapshot
  diagnosticsAfter?: DiagnosticSnapshot
}

export type ApplyResult = {
  ok: boolean
  plan: EditPlan
  writtenFiles: string[]
  rolledBack: boolean
  error?: string
}

export type Engine = 'typescript' | 'lsp' | 'treesitter'

export type EngineSelection = {
  engine: Engine
  reason: string
  /** Optional tree-sitter grammar package supplied by a plugin adapter. */
  grammarPackage?: string
  /** Optional LSP server name supplied by a plugin adapter. */
  lspServerName?: string
}

export type Position = {
  file?: string
  line?: number
  column?: number
  name?: string
}

export type RenameOptions = {
  root: string
  from: string
  to: string
  file?: string
  line?: number
  column?: number
  engine?: Engine
  checkCommand?: string
  skipDiagnostics?: boolean
}

export type MoveOptions = {
  root: string
  symbol: string
  targetFile: string
  file?: string
  engine?: Engine
  checkCommand?: string
  skipDiagnostics?: boolean
}

export type OrganizeImportsOptions = {
  root: string
  file?: string
  engine?: Engine
  checkCommand?: string
  skipDiagnostics?: boolean
}

export type UnusedOptions = {
  root: string
  file?: string
  engine?: Engine
}

export type CallersOptions = {
  root: string
  symbol: string
  file?: string
  engine?: Engine
}
