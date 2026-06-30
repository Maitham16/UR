import memoize from 'lodash-es/memoize.js'
import { basename, dirname, extname, join } from 'path'
import type { AgentTemplate } from '../../services/agents/featureScaffolds.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import {
  coerceDescriptionToString,
  parseFrontmatter,
} from '../frontmatterParser.js'
import { getFsImplementation, isDuplicatePath } from '../fsOperations.js'
import { extractDescriptionFromMarkdown } from '../markdownConfigLoader.js'
import { loadAllPluginsCacheOnly } from './pluginLoader.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'

export type PluginTemplate = AgentTemplate & {
  source: string
  plugin: string
}

async function loadTemplatesFromDirectory(
  templatesPath: string,
  pluginName: string,
  sourceName: string,
  loadedPaths: Set<string>,
): Promise<PluginTemplate[]> {
  const templates: PluginTemplate[] = []
  await walkPluginMarkdown(
    templatesPath,
    async fullPath => {
      const template = await loadTemplateFromFile(
        fullPath,
        pluginName,
        sourceName,
        loadedPaths,
      )
      if (template) templates.push(template)
    },
    { logLabel: 'templates' },
  )
  return templates
}

async function loadTemplateFromFile(
  filePath: string,
  pluginName: string,
  sourceName: string,
  loadedPaths: Set<string>,
): Promise<PluginTemplate | null> {
  const fs = getFsImplementation()
  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' })
    const { frontmatter, content: markdownContent } = parseFrontmatter(
      content,
      filePath,
    )

    const name =
      (frontmatter.name as string) || basename(filePath).replace(/\.md$/, '')
    const description =
      coerceDescriptionToString(frontmatter.description, name) ??
      extractDescriptionFromMarkdown(
        markdownContent,
        `Template from ${pluginName} plugin`,
      )
    const color = (frontmatter.color as string) || 'blue'
    const effort = (frontmatter.effort as 'low' | 'medium' | 'high') || 'medium'
    const permissionMode = frontmatter.permissionMode as
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions'
      | 'plan'
      | undefined
    const memory = frontmatter.memory as 'project' | 'local' | 'user' | undefined

    return {
      name,
      description,
      color,
      effort,
      permissionMode,
      memory,
      body: markdownContent.trim(),
      source: sourceName,
      plugin: pluginName,
    }
  } catch (error) {
    logForDebugging(`Failed to load template from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

export const loadPluginTemplates = memoize(
  async (): Promise<PluginTemplate[]> => {
    const { enabled, errors } = await loadAllPluginsCacheOnly()

    if (errors.length > 0) {
      logForDebugging(
        `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
      )
    }

    const perPluginTemplates = await Promise.all(
      enabled.map(async (plugin): Promise<PluginTemplate[]> => {
        const loadedPaths = new Set<string>()
        const pluginTemplates: PluginTemplate[] = []

        if (plugin.templatesPath) {
          try {
            const templates = await loadTemplatesFromDirectory(
              plugin.templatesPath,
              plugin.name,
              plugin.source,
              loadedPaths,
            )
            pluginTemplates.push(...templates)
            if (templates.length > 0) {
              logForDebugging(
                `Loaded ${templates.length} templates from plugin ${plugin.name} default directory`,
              )
            }
          } catch (error) {
            logForDebugging(
              `Failed to load templates from plugin ${plugin.name} default directory: ${error}`,
              { level: 'error' },
            )
          }
        }

        if (plugin.templatesPaths) {
          const pathResults = await Promise.all(
            plugin.templatesPaths.map(async templatePath => {
              try {
                const fs = getFsImplementation()
                const stats = await fs.stat(templatePath)
                if (stats.isDirectory()) {
                  return loadTemplatesFromDirectory(
                    templatePath,
                    plugin.name,
                    plugin.source,
                    loadedPaths,
                  )
                } else if (stats.isFile() && templatePath.endsWith('.md')) {
                  const template = await loadTemplateFromFile(
                    templatePath,
                    plugin.name,
                    plugin.source,
                    loadedPaths,
                  )
                  return template ? [template] : []
                }
                return []
              } catch (error) {
                logForDebugging(
                  `Failed to load templates from plugin ${plugin.name} custom path ${templatePath}: ${error}`,
                  { level: 'error' },
                )
                return []
              }
            }),
          )
          for (const templates of pathResults) {
            pluginTemplates.push(...templates)
          }
        }

        return pluginTemplates
      }),
    )

    const allTemplates = perPluginTemplates.flat()
    logForDebugging(`Total plugin templates loaded: ${allTemplates.length}`)
    return allTemplates
  },
)

export function clearPluginTemplatesCache(): void {
  loadPluginTemplates.cache?.clear?.()
}
