import type { PluginError } from '../../types/plugin.js'
import { isBinaryInstalled } from '../../utils/binaryCheck.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage, toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getPluginLspServers } from '../../utils/plugins/lspPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import type { ScopedLspServerConfig } from './types.js'

type BinaryChecker = (command: string) => Promise<boolean>

const BUILTIN_LSP_SERVER_SPECS = [
  {
    name: 'builtin:typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.mts': 'typescript',
      '.cts': 'typescript',
    },
  },
  {
    name: 'builtin:python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensionToLanguage: {
      '.py': 'python',
      '.pyi': 'python',
    },
  },
  {
    name: 'builtin:rust',
    command: 'rust-analyzer',
    args: [],
    extensionToLanguage: {
      '.rs': 'rust',
    },
  },
  {
    name: 'builtin:go',
    command: 'gopls',
    args: [],
    extensionToLanguage: {
      '.go': 'go',
    },
  },
] as const

export async function getBuiltInLspServers(options: {
  binaryChecker?: BinaryChecker
  workspaceFolder?: string
} = {}): Promise<Record<string, ScopedLspServerConfig>> {
  const checker = options.binaryChecker ?? isBinaryInstalled
  const workspaceFolder = options.workspaceFolder ?? getCwd()
  const servers: Record<string, ScopedLspServerConfig> = {}

  for (const spec of BUILTIN_LSP_SERVER_SPECS) {
    if (!(await checker(spec.command))) continue
    servers[spec.name] = {
      command: spec.command,
      args: [...spec.args],
      extensionToLanguage: { ...spec.extensionToLanguage },
      workspaceFolder,
      startupTimeout: 15_000,
      maxRestarts: 3,
      scope: 'builtin',
      source: 'ur',
    }
  }

  return servers
}

/**
 * Get all configured LSP servers from built-ins and plugins.
 *
 * @returns Object containing servers configuration keyed by scoped server name
 */
export async function getAllLspServers(): Promise<{
  servers: Record<string, ScopedLspServerConfig>
}> {
  const allServers: Record<string, ScopedLspServerConfig> =
    await getBuiltInLspServers()

  try {
    // Get all enabled plugins
    const { enabled: plugins } = await loadAllPluginsCacheOnly()

    // Load LSP servers from each plugin in parallel.
    // Each plugin is independent — results are merged in original order so
    // Object.assign collision precedence (later plugins win) is preserved.
    const results = await Promise.all(
      plugins.map(async plugin => {
        const errors: PluginError[] = []
        try {
          const scopedServers = await getPluginLspServers(plugin, errors)
          return { plugin, scopedServers, errors }
        } catch (e) {
          // Defensive: if one plugin throws, don't lose results from the
          // others. The previous serial loop implicitly tolerated this.
          logForDebugging(
            `Failed to load LSP servers for plugin ${plugin.name}: ${e}`,
            { level: 'error' },
          )
          return { plugin, scopedServers: undefined, errors }
        }
      }),
    )

    for (const { plugin, scopedServers, errors } of results) {
      const serverCount = scopedServers ? Object.keys(scopedServers).length : 0
      if (serverCount > 0) {
        // Merge into all servers (already scoped by getPluginLspServers)
        Object.assign(allServers, scopedServers)

        logForDebugging(
          `Loaded ${serverCount} LSP server(s) from plugin: ${plugin.name}`,
        )
      }

      // Log any errors encountered
      if (errors.length > 0) {
        logForDebugging(
          `${errors.length} error(s) loading LSP servers from plugin: ${plugin.name}`,
        )
      }
    }

    logForDebugging(`Total LSP servers loaded: ${Object.keys(allServers).length}`)
  } catch (error) {
    // Log error for monitoring production issues.
    // LSP is optional, so we don't throw - but we need visibility
    // into why plugin loading fails to improve the feature.
    logError(toError(error))

    logForDebugging(`Error loading LSP servers: ${errorMessage(error)}`)
  }

  return {
    servers: allServers,
  }
}
