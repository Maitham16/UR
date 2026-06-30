import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  applyRename,
  buildRepoEditIndex,
  formatRenamePlan,
  formatSearchHits,
  loadRepoEditIndex,
  planRename,
  repoEditIndexPath,
  searchRepoEditIndex,
} from '../../services/repoEditing/reliableRepoEdit.js'
import {
  applyMoveAst,
  applyOrganizeImportsAst,
  applyRenameAst,
  findCallersAst,
  findUnusedAst,
  formatMovePlanAst,
  formatOrganizeImportsPlanAst,
  formatRenamePlanAst,
  planMoveAst,
  planOrganizeImportsAst,
  planRenameAst,
} from '../../services/repoEditing/ast/repoEditAst.js'
import { formatWorkspaceEditAsPatch } from '../../services/repoEditing/ast/workspaceEdit.js'

function usage(): string {
  return [
    'Usage:',
    '  ur repo-edit index [--json]',
    '  ur repo-edit search <query> [--json]',
    '  ur repo-edit plan rename <from> --to <to> [--json]',
    '  ur repo-edit preview rename <from> --to <to> [--json]',
    '  ur repo-edit apply rename <from> --to <to> [--check <cmd>] [--json]',
    '  ur repo-edit rename <from> --to <to> [--file <path>] [--engine ts|lsp|treesitter] [--check <cmd>] [--json]',
    '  ur repo-edit move <symbol> --to <target-file> --file <source-file> [--check <cmd>] [--json]',
    '  ur repo-edit organize-imports [--file <path>] [--check <cmd>] [--json]',
    '  ur repo-edit unused [--file <path>] [--json]',
    '  ur repo-edit callers <symbol> [--file <path>] [--json]',
    '',
    'Rename operations are AST-aware for JavaScript and TypeScript files:',
    'identifier nodes are changed, while comments and strings are not.',
    'Use --engine lsp for language-server rename, --engine treesitter for',
    'best-effort identifier matching.',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  const flagsWithValue = new Set(['--to', '--check', '--file', '--engine'])
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function renameArgs(tokens: string[]): { from: string; to: string } | null {
  const values = positionals(tokens)
  if (values[1] !== 'rename' || !values[2]) return null
  const to = option(tokens, '--to')
  if (!to) return null
  return { from: values[2], to }
}

function moveArgs(tokens: string[]): { symbol: string; targetFile: string } | null {
  const values = positionals(tokens)
  if (values[1] !== 'move' || !values[2]) return null
  const target = option(tokens, '--to')
  if (!target) return null
  return { symbol: values[2], targetFile: target }
}

function callersArgs(tokens: string[]): string | undefined {
  const values = positionals(tokens)
  return values[1] === 'callers' ? values[2] : undefined
}

function parseSymbolLocation(symbol: string): { name: string; line?: number; column?: number } {
  const match = symbol.match(/^(.+):(\d+):(\d+)$/)
  if (!match) return { name: symbol }
  return { name: match[1]!, line: parseInt(match[2]!, 10), column: parseInt(match[3]!, 10) }
}

function parseEngine(value: string | undefined): 'typescript' | 'lsp' | 'treesitter' | undefined {
  if (value === 'ts' || value === 'typescript') return 'typescript'
  if (value === 'lsp') return 'lsp'
  if (value === 'treesitter') return 'treesitter'
  return undefined
}

function applyResultToText(
  result:
    | Awaited<ReturnType<typeof applyRenameAst>>
    | Awaited<ReturnType<typeof applyMoveAst>>
    | Awaited<ReturnType<typeof applyOrganizeImportsAst>>,
  label: string,
): string {
  if (!result.ok) {
    return (
      `Repo edit failed; rollback ${result.rolledBack ? 'completed' : 'not needed'}.\n` +
      `${result.error ?? 'Unknown error'}\n\nPatch preview:\n${formatWorkspaceEditAsPatch(getCwd(), result.plan.edits)}`
    )
  }
  return `Applied ${label}.\n\nPatch preview:\n${formatWorkspaceEditAsPatch(getCwd(), result.plan.edits)}`
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = positionals(tokens)[0] ?? 'status'
  const root = getCwd()

  try {
    if (action === 'index') {
      const index = buildRepoEditIndex(root)
      const summary = {
        path: repoEditIndexPath(root),
        files: index.files.length,
        codeFiles: index.files.filter(file => file.code).length,
        symbols: index.files.reduce(
          (total, file) => total + file.symbols.length,
          0,
        ),
        builtAt: index.builtAt,
      }
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ index: summary }, null, 2)
          : `Built repo-edit index at ${summary.path}\n` +
            `  files:    ${summary.files}\n` +
            `  code:     ${summary.codeFiles}\n` +
            `  symbols:  ${summary.symbols}`,
      }
    }

    if (action === 'status') {
      const index = loadRepoEditIndex(root)
      const status = index
        ? {
            path: repoEditIndexPath(root),
            builtAt: index.builtAt,
            files: index.files.length,
            codeFiles: index.files.filter(file => file.code).length,
            symbols: index.files.reduce(
              (total, file) => total + file.symbols.length,
              0,
            ),
          }
        : { missing: true, path: repoEditIndexPath(root) }
      return { type: 'text', value: JSON.stringify(status, null, 2) }
    }

    if (action === 'search') {
      const query = positionals(tokens).slice(1).join(' ')
      if (!query) return { type: 'text', value: usage() }
      const hits = searchRepoEditIndex(root, query)
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ hits }, null, 2)
          : formatSearchHits(hits),
      }
    }

    if (action === 'rename') {
      const rename = renameArgs(tokens)
      if (!rename) return { type: 'text', value: usage() }
      const file = option(tokens, '--file')
      const location = file ? parseSymbolLocation(rename.from) : { name: rename.from }
      const plan = await planRenameAst({
        root,
        from: location.name,
        to: rename.to,
        file,
        line: location.line,
        column: location.column,
        engine: parseEngine(option(tokens, '--engine')),
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (json) {
        return { type: 'text', value: JSON.stringify({ plan }, null, 2) }
      }
      return { type: 'text', value: formatRenamePlanAst(plan) }
    }

    if (action === 'apply') {
      const rename = renameArgs(tokens)
      if (!rename) return { type: 'text', value: usage() }
      const file = option(tokens, '--file')
      const location = file ? parseSymbolLocation(rename.from) : { name: rename.from }
      const result = await applyRenameAst({
        root,
        from: location.name,
        to: rename.to,
        file,
        line: location.line,
        column: location.column,
        engine: parseEngine(option(tokens, '--engine')),
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (json) {
        return { type: 'text', value: JSON.stringify(result, null, 2) }
      }
      return { type: 'text', value: applyResultToText(result, `rename ${rename.from} -> ${rename.to}`) }
    }

    if (action === 'move') {
      const move = moveArgs(tokens)
      if (!move) return { type: 'text', value: usage() }
      const file = option(tokens, '--file')
      if (!file) return { type: 'text', value: 'move requires --file <source-file>' }
      const location = parseSymbolLocation(move.symbol)
      const plan = await planMoveAst({
        root,
        symbol: location.name,
        targetFile: move.targetFile,
        file,
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (tokens.includes('--preview') || (!tokens.includes('--apply') && !json)) {
        return { type: 'text', value: json ? JSON.stringify({ plan }, null, 2) : formatMovePlanAst(plan) }
      }
      const result = await applyMoveAst({
        root,
        symbol: location.name,
        targetFile: move.targetFile,
        file,
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (json) {
        return { type: 'text', value: JSON.stringify(result, null, 2) }
      }
      return { type: 'text', value: applyResultToText(result, `move ${move.symbol} -> ${move.targetFile}`) }
    }

    if (action === 'organize-imports') {
      const file = option(tokens, '--file')
      const plan = await planOrganizeImportsAst({
        root,
        file,
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (tokens.includes('--preview') || (!tokens.includes('--apply') && !json)) {
        return { type: 'text', value: json ? JSON.stringify({ plan }, null, 2) : formatOrganizeImportsPlanAst(plan) }
      }
      const result = await applyOrganizeImportsAst({
        root,
        file,
        checkCommand: option(tokens, '--check'),
        skipDiagnostics: tokens.includes('--skip-diagnostics'),
      })
      if (json) {
        return { type: 'text', value: JSON.stringify(result, null, 2) }
      }
      return { type: 'text', value: applyResultToText(result, 'organize imports') }
    }

    if (action === 'unused') {
      const file = option(tokens, '--file')
      const plan = await findUnusedAst({ root, file })
      return { type: 'text', value: json ? JSON.stringify({ plan }, null, 2) : plan.description }
    }

    if (action === 'callers') {
      const symbol = callersArgs(tokens)
      if (!symbol) return { type: 'text', value: usage() }
      const file = option(tokens, '--file')
      const location = parseSymbolLocation(symbol)
      const plan = await findCallersAst({ root, symbol: location.name, file })
      return { type: 'text', value: json ? JSON.stringify({ plan }, null, 2) : plan.description }
    }

    if (action === 'plan' || action === 'preview') {
      const rename = renameArgs(tokens)
      if (!rename) return { type: 'text', value: usage() }
      const plan = planRename(root, rename.from, rename.to)

      if (action === 'plan') {
        return {
          type: 'text',
          value: json ? JSON.stringify({ plan }, null, 2) : formatRenamePlan(plan),
        }
      }

      return {
        type: 'text',
        value: json
          ? JSON.stringify({ plan, patch: plan.patch }, null, 2)
          : plan.patch || formatRenamePlan(plan),
      }
    }
  } catch (error) {
    return {
      type: 'text',
      value: `repo-edit failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { type: 'text', value: usage() }
}
