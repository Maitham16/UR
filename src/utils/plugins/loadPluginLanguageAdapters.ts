import memoize from 'lodash-es/memoize.js'
import type {
  Engine,
  Language,
} from '../../services/repoEditing/ast/types.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'

export type PluginLanguageAdapter = {
  language: string
  extensions: string[]
  engine: Engine
  grammarPackage?: string
  lspServerName?: string
  source: string
  plugin: string
}

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

export const loadPluginLanguageAdapters = memoize(
  async (): Promise<PluginLanguageAdapter[]> => {
    const { enabled, errors } = await loadAllPluginsCacheOnly()

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    const adapters: PluginLanguageAdapter[] = []
    for (const plugin of enabled) {
      if (!plugin.languageAdapters) continue
      for (const [language, adapter] of Object.entries(
        plugin.languageAdapters,
      )) {
        adapters.push({
          language,
          extensions: adapter.extensions,
          engine: adapter.engine,
          grammarPackage: adapter.grammarPackage,
          lspServerName: adapter.lspServerName,
          source: plugin.source,
          plugin: plugin.name,
        })
      }
    }

    logForDebugging(
      `Total plugin language adapters loaded: ${adapters.length}`,
    )
    return adapters
  },
)

export function clearPluginLanguageAdaptersCache(): void {
  loadPluginLanguageAdapters.cache?.clear?.()
}

export async function getAllLanguages(): Promise<string[]> {
  const adapters = await loadPluginLanguageAdapters()
  const pluginLanguages = adapters.map(a => a.language)
  return [...new Set([...builtinLanguages, ...pluginLanguages])]
}

export async function resolvePluginLanguageAdapter(
  language: string,
): Promise<PluginLanguageAdapter | undefined> {
  const adapters = await loadPluginLanguageAdapters()
  return adapters.find(a => a.language === language)
}
