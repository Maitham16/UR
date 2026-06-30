import {
  formatScaffoldResult,
  getAllAgentTemplates,
  installAgentTemplates,
  installAllAgentTemplates,
  listAgentTemplateNames,
} from '../../services/agents/featureScaffolds.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

async function formatTemplateList(json: boolean): Promise<string> {
  const all = await getAllAgentTemplates()
  if (json) {
    return JSON.stringify({ templates: all }, null, 2)
  }

  const lines = ['Available agent templates', '']
  for (const template of all) {
    lines.push(`${template.name}${template.plugin ? ` (${template.plugin})` : ''}`)
    lines.push(`  ${template.description}`)
  }
  lines.push('')
  lines.push('Install all: ur agent-templates install')
  lines.push('Install selected: ur agent-templates install reviewer test-runner')
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'list'

  if (command === 'list') {
    return { type: 'text', value: await formatTemplateList(json) }
  }

  if (command === 'install' || command === 'init') {
    const all = await getAllAgentTemplates()
    const knownNames = new Set(all.map(template => template.name))
    const requestedNames = tokens.filter(
      token =>
        !token.startsWith('--') &&
        token !== command,
    )
    const unknownNames = requestedNames.filter(name => !knownNames.has(name))
    const names = requestedNames.filter(name => knownNames.has(name))
    if (unknownNames.length > 0) {
      return {
        type: 'text',
        value: `Unknown agent template${unknownNames.length === 1 ? '' : 's'}: ${unknownNames.join(', ')}\nKnown templates: ${all.map(t => t.name).join(', ')}`,
      }
    }
    const result =
      names.length === 0
        ? await installAllAgentTemplates(getCwd(), { force })
        : installAgentTemplates(getCwd(), names, { force })
    if (json) {
      return { type: 'text', value: JSON.stringify(result, null, 2) }
    }
    return { type: 'text', value: formatScaffoldResult(result) }
  }

  return {
    type: 'text',
    value: `Unknown agent-templates command: ${command}\n\n${await formatTemplateList(false)}`,
  }
}
