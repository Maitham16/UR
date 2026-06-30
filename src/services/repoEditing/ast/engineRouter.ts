/**
 * Engine router for AST-aware repo editing.
 *
 * Chooses the best available engine per language: TypeScript compiler API for
 * TS/JS by default, LSP for TS/JS when explicitly requested and for
 * Python/Rust/Go, with Tree-sitter as a future fallback.
 */

import type { EngineSelection, Language } from './types.js'

export function resolveEngine(
  language: Language,
  options: { preferLsp?: boolean; preferTreeSitter?: boolean },
): EngineSelection {
  if (options.preferTreeSitter) {
    return { engine: 'treesitter', reason: 'explicit --treesitter flag' }
  }
  if (options.preferLsp) {
    return { engine: 'lsp', reason: 'explicit --lsp flag' }
  }
  if (language === 'ts' || language === 'js' || language === 'tsx' || language === 'jsx') {
    return { engine: 'typescript', reason: 'TypeScript compiler API is primary for TS/JS' }
  }
  // For Python/Rust/Go we prefer LSP, but if no LSP server is available the
  // orchestrator can fall back to Tree-sitter by calling resolveEngine again.
  return { engine: 'lsp', reason: 'LSP is primary for Python/Rust/Go' }
}

export function fallbackToTreeSitter(language: Language): EngineSelection {
  return { engine: 'treesitter', reason: `no LSP server available for ${language}` }
}

export function languageFromPath(file: string): Language | undefined {
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
