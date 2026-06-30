/**
 * Engine router for AST-aware repo editing.
 *
 * Chooses the best available engine per language: TypeScript compiler API for
 * TS/JS by default, LSP for TS/JS when explicitly requested and for
 * Python/Rust/Go, with Tree-sitter as a future fallback.
 */

import {
  loadPluginLanguageAdapters,
  type PluginLanguageAdapter,
} from '../../../utils/plugins/loadPluginLanguageAdapters.js'
import type { EngineSelection, Language } from './types.js'
import { extname } from 'path'

const builtinLanguages: Language[] = [
  'ts',
  'js',
  'tsx',
  'jsx',
  'python',
  'rust',
  'go',
]

function isBuiltinLanguage(language: string): language is Language {
  return (builtinLanguages as string[]).includes(language)
}

function selectionFromAdapter(
  adapter: PluginLanguageAdapter,
  reason: string,
): EngineSelection {
  return {
    engine: adapter.engine,
    reason,
    grammarPackage: adapter.grammarPackage,
    lspServerName: adapter.lspServerName,
  }
}

export async function resolveEngine(
  language: string,
  options: { preferLsp?: boolean; preferTreeSitter?: boolean },
): Promise<EngineSelection> {
  if (options.preferTreeSitter) {
    return { engine: 'treesitter', reason: 'explicit --treesitter flag' }
  }
  if (options.preferLsp) {
    return { engine: 'lsp', reason: 'explicit --lsp flag' }
  }

  // Plugin adapters take precedence for plugin-defined languages.
  if (!isBuiltinLanguage(language)) {
    const adapters = await loadPluginLanguageAdapters()
    const adapter = adapters.find(a => a.language === language)
    if (adapter) {
      return selectionFromAdapter(
        adapter,
        `plugin language adapter for ${language}`,
      )
    }
  }

  if (language === 'ts' || language === 'js' || language === 'tsx' || language === 'jsx') {
    return { engine: 'typescript', reason: 'TypeScript compiler API is primary for TS/JS' }
  }
  // For Python/Rust/Go we prefer LSP, but if no LSP server is available the
  // orchestrator can fall back to Tree-sitter by calling resolveEngine again.
  return { engine: 'lsp', reason: 'LSP is primary for Python/Rust/Go' }
}

export function fallbackToTreeSitter(language: string): EngineSelection {
  return { engine: 'treesitter', reason: `no LSP server available for ${language}` }
}

export function languageFromPath(file: string): string | undefined {
  const ext = file.toLowerCase()
  if (ext.endsWith('.ts')) return 'ts'
  if (ext.endsWith('.tsx')) return 'tsx'
  if (ext.endsWith('.js')) return 'js'
  if (ext.endsWith('.jsx')) return 'jsx'
  if (ext.endsWith('.py')) return 'python'
  if (ext.endsWith('.rs')) return 'rust'
  if (ext.endsWith('.go')) return 'go'
  return undefined
}

export async function languageFromPathWithAdapters(
  file: string,
): Promise<string | undefined> {
  const builtin = languageFromPath(file)
  if (builtin) return builtin

  const ext = extname(file).toLowerCase()
  if (!ext) return undefined

  const adapters = await loadPluginLanguageAdapters()
  const adapter = adapters.find(a =>
    a.extensions.map(e => e.toLowerCase()).includes(ext),
  )
  return adapter?.language
}
