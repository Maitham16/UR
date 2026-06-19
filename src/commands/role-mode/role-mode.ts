import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  getMode,
  listModeNames,
  renderModeAgent,
  ROLE_MODES,
} from './modes.js'

function formatList(): string {
  const lines = ['Built-in role modes:', '']
  for (const mode of ROLE_MODES) {
    const scope = mode.tools ? mode.tools.join(', ') : 'all tools'
    lines.push(`- ${mode.name} — ${mode.description}`)
    lines.push(`    tools: ${scope}`)
  }
  lines.push('')
  lines.push('Install with: ur role-mode install <name|all> [--force]')
  lines.push('Once installed they appear as agents (delegate to them via the Agent tool / /agents).')
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const positional = tokens.filter(t => !t.startsWith('--'))
  const command = positional[0] ?? 'list'

  if (command === 'list') {
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify(
          ROLE_MODES.map(m => ({
            name: m.name,
            description: m.description,
            tools: m.tools ?? '*',
            permissionMode: m.permissionMode ?? 'default',
          })),
          null,
          2,
        ),
      }
    }
    return { type: 'text', value: formatList() }
  }

  if (command === 'show') {
    const name = positional[1]
    const mode = name ? getMode(name) : undefined
    if (!mode) {
      return {
        type: 'text',
        value: `Unknown role mode "${name ?? ''}". Available: ${listModeNames().join(', ')}`,
      }
    }
    return { type: 'text', value: renderModeAgent(mode) }
  }

  if (command === 'install') {
    const target = positional[1] ?? 'all'
    const modes =
      target === 'all'
        ? ROLE_MODES
        : ROLE_MODES.filter(m => m.name === target.toLowerCase())
    if (modes.length === 0) {
      return {
        type: 'text',
        value: `Unknown role mode "${target}". Available: ${listModeNames().join(', ')}, or "all".`,
      }
    }
    const agentsDir = join(getCwd(), '.ur', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    const created: string[] = []
    const skipped: string[] = []
    for (const mode of modes) {
      const path = join(agentsDir, `${mode.name}.md`)
      if (existsSync(path) && !force) {
        skipped.push(`${mode.name} (exists; use --force to overwrite)`)
        continue
      }
      writeFileSync(path, renderModeAgent(mode), { encoding: 'utf-8' })
      created.push(path)
    }
    if (json) {
      return { type: 'text', value: JSON.stringify({ created, skipped }, null, 2) }
    }
    const lines: string[] = []
    if (created.length > 0) {
      lines.push(`Installed ${created.length} role mode${created.length === 1 ? '' : 's'}:`)
      lines.push(...created.map(p => `  ${p}`))
    }
    if (skipped.length > 0) {
      lines.push(`Skipped: ${skipped.join(', ')}`)
    }
    lines.push('')
    lines.push('These role modes are now available as agents (delegate to them via the Agent tool).')
    return { type: 'text', value: lines.join('\n') }
  }

  return {
    type: 'text',
    value: 'Usage: ur role-mode list|show <name>|install <name|all> [--force] [--json]',
  }
}
