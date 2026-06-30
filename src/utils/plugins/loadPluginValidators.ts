import memoize from 'lodash-es/memoize.js'
import { basename, extname, join } from 'path'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import { jsonParse } from '../slowOperations.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'

export type PluginValidator = {
  name: string
  command: string
  when?: 'afterEdit' | 'afterBash' | 'always'
  patterns?: string[]
  timeoutMs?: number
  source: string
  plugin: string
}

async function loadValidatorsFromDirectory(
  validatorsPath: string,
  pluginName: string,
  sourceName: string,
  loadedPaths: Set<string>,
): Promise<PluginValidator[]> {
  const validators: PluginValidator[] = []
  const fs = getFsImplementation()
  let entries
  try {
    entries = await fs.readdir(validatorsPath)
  } catch {
    return validators
  }

  await Promise.all(
    entries.map(async entry => {
      if (!entry.isFile()) return
      const filePath = join(validatorsPath, entry.name)
      if (!filePath.endsWith('.json')) return
      const validator = await loadValidatorFromFile(
        filePath,
        pluginName,
        sourceName,
        loadedPaths,
      )
      if (validator) validators.push(validator)
    }),
  )
  return validators
}

async function loadValidatorFromFile(
  filePath: string,
  pluginName: string,
  sourceName: string,
  loadedPaths: Set<string>,
): Promise<PluginValidator | null> {
  const fs = getFsImplementation()
  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' })
    const parsed = jsonParse(content)
    if (!parsed || typeof parsed !== 'object') return null
    const raw = parsed as Record<string, unknown>
    if (typeof raw.command !== 'string' || raw.command.length === 0) {
      logForDebugging(
        `Validator ${filePath} missing required "command" field`,
        { level: 'warn' },
      )
      return null
    }
    const name =
      typeof raw.name === 'string' ? raw.name : basename(filePath, '.json')
    const when =
      raw.when === 'afterEdit' || raw.when === 'afterBash' || raw.when === 'always'
        ? raw.when
        : 'afterEdit'
    const patterns = Array.isArray(raw.patterns)
      ? raw.patterns.filter((p): p is string => typeof p === 'string')
      : undefined
    const timeoutMs =
      typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0
        ? raw.timeoutMs
        : undefined

    return {
      name,
      command: raw.command,
      when,
      patterns,
      timeoutMs,
      source: sourceName,
      plugin: pluginName,
    }
  } catch (error) {
    logForDebugging(`Failed to load validator from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

export const loadPluginValidators = memoize(
  async (): Promise<PluginValidator[]> => {
    const { enabled, errors } = await loadAllPluginsCacheOnly()

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    const perPluginValidators = await Promise.all(
      enabled.map(async (plugin): Promise<PluginValidator[]> => {
        const loadedPaths = new Set<string>()
        const pluginValidators: PluginValidator[] = []

        if (plugin.validatorsPath) {
          try {
            const validators = await loadValidatorsFromDirectory(
              plugin.validatorsPath,
              plugin.name,
              plugin.source,
              loadedPaths,
            )
            pluginValidators.push(...validators)
            if (validators.length > 0) {
              logForDebugging(
                `Loaded ${validators.length} validators from plugin ${plugin.name} default directory`,
              )
            }
          } catch (error) {
            logForDebugging(
              `Failed to load validators from plugin ${plugin.name} default directory: ${error}`,
              { level: 'error' },
            )
          }
        }

        if (plugin.validatorsPaths) {
          const pathResults = await Promise.all(
            plugin.validatorsPaths.map(async validatorPath => {
              try {
                const fs = getFsImplementation()
                const stats = await fs.stat(validatorPath)
                if (stats.isDirectory()) {
                  return loadValidatorsFromDirectory(
                    validatorPath,
                    plugin.name,
                    plugin.source,
                    loadedPaths,
                  )
                } else if (stats.isFile() && validatorPath.endsWith('.json')) {
                  const validator = await loadValidatorFromFile(
                    validatorPath,
                    plugin.name,
                    plugin.source,
                    loadedPaths,
                  )
                  return validator ? [validator] : []
                }
                return []
              } catch (error) {
                logForDebugging(
                  `Failed to load validators from plugin ${plugin.name} custom path ${validatorPath}: ${error}`,
                  { level: 'error' },
                )
                return []
              }
            }),
          )
          for (const validators of pathResults) {
            pluginValidators.push(...validators)
          }
        }

        return pluginValidators
      }),
    )

    const allValidators = perPluginValidators.flat()
    logForDebugging(`Total plugin validators loaded: ${allValidators.length}`)
    return allValidators
  },
)

export function clearPluginValidatorsCache(): void {
  loadPluginValidators.cache?.clear?.()
}
