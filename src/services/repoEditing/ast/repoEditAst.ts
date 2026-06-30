/**
 * High-level orchestrator for AST-aware repo editing.
 *
 * Bridges engines, diagnostics, and WorkspaceEdit application. Each `apply`
 * path collects diagnostics before editing, applies the plan, optionally runs
 * a check command, collects diagnostics after, and rolls back when new errors
 * appear or the check fails.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ApplyResult,
  CallersOptions,
  EditPlan,
  MoveOptions,
  OrganizeImportsOptions,
  RenameOptions,
  SymbolRef,
  UnusedOptions,
  WorkspaceEdit,
} from './types.js'
import { collectDiagnostics, diagnosticsDiff, emptySnapshot } from './diagnostics.js'
import { fallbackToTreeSitter, languageFromPath, resolveEngine } from './engineRouter.js'
import { lspRename, shutdownLspManager } from './lspEditEngine.js'
import {
  loadProgram,
  tsFindCallers,
  tsFindUnused,
  tsMoveFunction,
  tsOrganizeImports,
  tsRenameSymbol,
  tsRenameSymbolAtPosition,
} from './typescriptEngine.js'
import { treeSitterRename } from './treeSitterEngine.js'
import { applyWorkspaceEdit, formatWorkspaceEditAsPatch, rollbackWorkspaceEdit } from './workspaceEdit.js'

const execAsync = promisify(exec)

async function runCheck(
  command: string,
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string }
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      error: e.message,
    }
  }
}

function createPlan(kind: EditPlan['kind'], description: string, edit: WorkspaceEdit, diagnosticsBefore: Awaited<ReturnType<typeof collectDiagnostics>>): EditPlan {
  const affectedFiles = [...new Set(edit.edits.map(e => e.file))]
  return {
    kind,
    edits: edit,
    affectedFiles,
    description,
    diagnosticsBefore,
  }
}

function createReadPlan(kind: Extract<EditPlan['kind'], 'unused' | 'callers'>, description: string, refs: SymbolRef[], diagnosticsBefore: Awaited<ReturnType<typeof collectDiagnostics>>): EditPlan {
  return {
    kind,
    edits: { edits: [] },
    affectedFiles: [...new Set(refs.map(r => r.file))],
    description,
    diagnosticsBefore,
  }
}

async function listRepoCodeFiles(root: string): Promise<string[]> {
  const { listRepoFiles } = await import('../reliableRepoEdit.js')
  return listRepoFiles(root).filter((f: string) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/i.test(f),
  )
}

async function computeRenameEdit(options: RenameOptions, attempt = 0): Promise<WorkspaceEdit> {
  const language = options.file ? languageFromPath(options.file) : undefined
  const selection = resolveEngine(language ?? 'ts', {
    preferLsp: options.engine === 'lsp',
    preferTreeSitter: options.engine === 'treesitter',
  })

  if (selection.engine === 'lsp') {
    if (!options.file || options.line === undefined || options.column === undefined) {
      throw new Error(
        'LSP rename requires a file and position; use `file.ts:line:column` or pass --file with a position.',
      )
    }
    try {
      const result = await lspRename(options.root, options.file, options.line, options.column, options.to)
      if (result && result.edits.length > 0) return result
      if (attempt === 0 && language) {
        return computeRenameEdit({ ...options, engine: 'treesitter' }, attempt + 1)
      }
      return result ?? { edits: [] }
    } catch (error) {
      if (attempt === 0 && language) {
        return computeRenameEdit({ ...options, engine: 'treesitter' }, attempt + 1)
      }
      throw error
    }
  }

  if (selection.engine === 'treesitter') {
    if (!language) return { edits: [] }
    return treeSitterRename(options, language)
  }

  const files = options.file ? [options.file] : await listRepoCodeFiles(options.root)
  const ctx = loadProgram(options.root, files)
  if (options.file && options.line !== undefined && options.column !== undefined) {
    return tsRenameSymbolAtPosition(ctx, options)
  }
  return tsRenameSymbol(ctx, options)
}

export async function planRenameAst(options: RenameOptions): Promise<EditPlan> {
  const files = options.file ? [options.file] : await listRepoCodeFiles(options.root)
  const edit = await computeRenameEdit(options)
  const diagnosticsBefore = options.skipDiagnostics
    ? emptySnapshot('none')
    : await collectDiagnostics(options.root, files)
  return createPlan('rename', `Rename ${options.from} -> ${options.to}${options.file ? ` in ${options.file}` : ''}`, edit, diagnosticsBefore)
}

export async function applyRenameAst(options: RenameOptions): Promise<ApplyResult> {
  const plan = await planRenameAst(options)

  let applyResult: ReturnType<typeof applyWorkspaceEdit> | undefined
  try {
    applyResult = applyWorkspaceEdit(options.root, plan.edits)
    const diagnosticsAfter = options.skipDiagnostics
      ? emptySnapshot('none')
      : await collectDiagnostics(options.root, applyResult.writtenFiles)
    plan.diagnosticsAfter = diagnosticsAfter

    const newErrors = diagnosticsDiff(plan.diagnosticsBefore, diagnosticsAfter)
    if (newErrors.length > 0) {
      rollbackWorkspaceEdit(options.root, applyResult.snapshots)
      return {
        ok: false,
        plan,
        writtenFiles: applyResult.writtenFiles,
        rolledBack: true,
        error: `New diagnostics after rename:\n${newErrors.map(d => `${d.file}:${d.line}:${d.column} ${d.message}`).join('\n')}`,
      }
    }

    if (options.checkCommand) {
      const check = await runCheck(options.checkCommand, options.root)
      if (!check.ok) {
        rollbackWorkspaceEdit(options.root, applyResult.snapshots)
        return {
          ok: false,
          plan,
          writtenFiles: applyResult.writtenFiles,
          rolledBack: true,
          error: check.error ?? `Check failed: ${options.checkCommand}`,
        }
      }
    }

    return { ok: true, plan, writtenFiles: applyResult.writtenFiles, rolledBack: false }
  } catch (error) {
    if (applyResult) {
      rollbackWorkspaceEdit(options.root, applyResult.snapshots)
    }
    return {
      ok: false,
      plan,
      writtenFiles: applyResult?.writtenFiles ?? [],
      rolledBack: true,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await shutdownLspManager().catch(() => {})
  }
}

export async function planMoveAst(options: MoveOptions): Promise<EditPlan> {
  const files = options.file ? [options.file, options.targetFile] : [options.targetFile]
  const ctx = loadProgram(options.root, files)
  const edit = tsMoveFunction(ctx, options)
  const diagnosticsBefore = options.skipDiagnostics
    ? emptySnapshot('none')
    : await collectDiagnostics(options.root, files)
  return createPlan(
    'move',
    `Move ${options.symbol} -> ${options.targetFile}${options.file ? ` from ${options.file}` : ''}`,
    edit,
    diagnosticsBefore,
  )
}

export async function applyMoveAst(options: MoveOptions): Promise<ApplyResult> {
  const plan = await planMoveAst(options)
  let applyResult: ReturnType<typeof applyWorkspaceEdit> | undefined
  try {
    applyResult = applyWorkspaceEdit(options.root, plan.edits)
    const diagnosticsAfter = options.skipDiagnostics
      ? emptySnapshot('none')
      : await collectDiagnostics(options.root, applyResult.writtenFiles)
    plan.diagnosticsAfter = diagnosticsAfter

    const newErrors = diagnosticsDiff(plan.diagnosticsBefore, diagnosticsAfter)
    if (newErrors.length > 0) {
      rollbackWorkspaceEdit(options.root, applyResult.snapshots)
      return {
        ok: false,
        plan,
        writtenFiles: applyResult.writtenFiles,
        rolledBack: true,
        error: `New diagnostics after move:\n${newErrors.map(d => `${d.file}:${d.line}:${d.column} ${d.message}`).join('\n')}`,
      }
    }

    if (options.checkCommand) {
      const check = await runCheck(options.checkCommand, options.root)
      if (!check.ok) {
        rollbackWorkspaceEdit(options.root, applyResult.snapshots)
        return {
          ok: false,
          plan,
          writtenFiles: applyResult.writtenFiles,
          rolledBack: true,
          error: check.error ?? `Check failed: ${options.checkCommand}`,
        }
      }
    }

    return { ok: true, plan, writtenFiles: applyResult.writtenFiles, rolledBack: false }
  } catch (error) {
    if (applyResult) rollbackWorkspaceEdit(options.root, applyResult.snapshots)
    return {
      ok: false,
      plan,
      writtenFiles: applyResult?.writtenFiles ?? [],
      rolledBack: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function planOrganizeImportsAst(options: OrganizeImportsOptions): Promise<EditPlan> {
  const files = options.file ? [options.file] : await listRepoCodeFiles(options.root).then(f => f.filter(p => /\.(ts|tsx|js|jsx)$/i.test(p)))
  const ctx = loadProgram(options.root, files)
  const edit = tsOrganizeImports(ctx, options)
  const diagnosticsBefore = options.skipDiagnostics
    ? emptySnapshot('none')
    : await collectDiagnostics(options.root, files)
  return createPlan('organize-imports', `Organize imports${options.file ? ` in ${options.file}` : ''}`, edit, diagnosticsBefore)
}

export async function applyOrganizeImportsAst(options: OrganizeImportsOptions): Promise<ApplyResult> {
  const plan = await planOrganizeImportsAst(options)
  let applyResult: ReturnType<typeof applyWorkspaceEdit> | undefined
  try {
    applyResult = applyWorkspaceEdit(options.root, plan.edits)
    const diagnosticsAfter = options.skipDiagnostics
      ? emptySnapshot('none')
      : await collectDiagnostics(options.root, applyResult.writtenFiles)
    plan.diagnosticsAfter = diagnosticsAfter

    const newErrors = diagnosticsDiff(plan.diagnosticsBefore, diagnosticsAfter)
    if (newErrors.length > 0) {
      rollbackWorkspaceEdit(options.root, applyResult.snapshots)
      return {
        ok: false,
        plan,
        writtenFiles: applyResult.writtenFiles,
        rolledBack: true,
        error: `New diagnostics after organize imports:\n${newErrors.map(d => `${d.file}:${d.line}:${d.column} ${d.message}`).join('\n')}`,
      }
    }

    if (options.checkCommand) {
      const check = await runCheck(options.checkCommand, options.root)
      if (!check.ok) {
        rollbackWorkspaceEdit(options.root, applyResult.snapshots)
        return {
          ok: false,
          plan,
          writtenFiles: applyResult.writtenFiles,
          rolledBack: true,
          error: check.error ?? `Check failed: ${options.checkCommand}`,
        }
      }
    }

    return { ok: true, plan, writtenFiles: applyResult.writtenFiles, rolledBack: false }
  } catch (error) {
    if (applyResult) rollbackWorkspaceEdit(options.root, applyResult.snapshots)
    return {
      ok: false,
      plan,
      writtenFiles: applyResult?.writtenFiles ?? [],
      rolledBack: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function findUnusedAst(options: UnusedOptions): Promise<EditPlan> {
  const files = options.file ? [options.file] : await listRepoCodeFiles(options.root).then(f => f.filter(p => /\.(ts|tsx|js|jsx)$/i.test(p)))
  const ctx = loadProgram(options.root, files)
  const refs = tsFindUnused(ctx, options)
  const diagnosticsBefore = emptySnapshot('none')
  return createReadPlan('unused', `Unused symbols${options.file ? ` in ${options.file}` : ''}`, refs, diagnosticsBefore)
}

export async function findCallersAst(options: CallersOptions): Promise<EditPlan> {
  const files = options.file ? [options.file] : await listRepoCodeFiles(options.root).then(f => f.filter(p => /\.(ts|tsx|js|jsx)$/i.test(p)))
  const ctx = loadProgram(options.root, files)
  const refs = tsFindCallers(ctx, options)
  const diagnosticsBefore = emptySnapshot('none')
  return createReadPlan('callers', `Callers of ${options.symbol}${options.file ? ` in ${options.file}` : ''}`, refs, diagnosticsBefore)
}

export function formatRenamePlanAst(plan: EditPlan): string {
  const patch = formatWorkspaceEditAsPatch('.', plan.edits)
  if (plan.edits.edits.length === 0) {
    return `No binding-aware rename matches for symbol.`
  }
  const byFile = new Map<string, number>()
  for (const edit of plan.edits.edits) {
    byFile.set(edit.file, (byFile.get(edit.file) ?? 0) + 1)
  }
  const lines = [
    plan.description,
    `${plan.edits.edits.length} occurrence(s) across ${byFile.size} file(s).`,
    '',
  ]
  for (const [file, count] of byFile) {
    lines.push(`${file} (${count})`)
  }
  lines.push('', patch)
  return lines.join('\n')
}

export function formatMovePlanAst(plan: EditPlan): string {
  const patch = formatWorkspaceEditAsPatch('.', plan.edits)
  if (plan.edits.edits.length === 0) return 'No move edits computed.'
  return [plan.description, '', patch].join('\n')
}

export function formatOrganizeImportsPlanAst(plan: EditPlan): string {
  const patch = formatWorkspaceEditAsPatch('.', plan.edits)
  if (plan.edits.edits.length === 0) return 'No imports to organize.'
  return [plan.description, '', patch].join('\n')
}

export function formatReadPlanAst(plan: EditPlan): string {
  const lines = [plan.description, '']
  for (const file of plan.affectedFiles) {
    const refs = []
    // Read-only plans don't store refs; callers can render the JSON plan.
  }
  return lines.join('\n')
}
