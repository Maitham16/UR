import { existsSync, readFileSync } from 'node:fs'
import type { LocalCommandCall } from '../../types/command.js'
import {
  evaluateGuardrails,
  formatDecision,
  loadGuardrails,
  scaffoldGuardrails,
  validateGuardrails,
  type GuardrailPhase,
} from '../../services/guardrails/guardrails.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

function usage(): string {
  return [
    'Usage:',
    '  ur guardrails list [--json]',
    '  ur guardrails init [--force]',
    '  ur guardrails validate [--json]',
    '  ur guardrails check "<text>" [--phase input|output] [--tool <name>] [--dry-run] [--json]',
    '  ur guardrails check --file <path> [--phase ...] [--tool ...]',
    '',
    'Rules live in .ur/guardrails/*.json (regex | contains | pii | maxLength | jsonSchema | llm).',
    'A "block" rule trips the wire; it also layers into the `ur agent-task pr` self-review gate.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'list'

  if (action === 'help') return { type: 'text', value: usage() }

  if (action === 'init') {
    const result = scaffoldGuardrails(cwd, { force: tokens.includes('--force') })
    return {
      type: 'text',
      value: result.created
        ? `Created ${result.path}`
        : `Kept existing ${result.path} (use --force to overwrite)`,
    }
  }

  const config = loadGuardrails(cwd)

  if (action === 'list') {
    if (json) return { type: 'text', value: JSON.stringify(config, null, 2) }
    if (config.rules.length === 0) {
      return { type: 'text', value: 'No guardrails yet. Create the starter set: ur guardrails init' }
    }
    const lines = ['Guardrails', '']
    for (const rule of config.rules) {
      lines.push(
        `  [${rule.action ?? 'block'}] ${rule.id} (${rule.kind}, ${rule.phase ?? 'both'})` +
          `${rule.tools?.length ? ` tools=${rule.tools.join(',')}` : ''}` +
          `${rule.description ? ` — ${rule.description}` : ''}`,
      )
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (action === 'validate') {
    const validation = validateGuardrails(config)
    if (json) return { type: 'text', value: JSON.stringify(validation, null, 2) }
    const lines = [
      `Guardrails: ${config.rules.length} rule(s)`,
      validation.valid ? 'Valid: yes' : 'Valid: no',
    ]
    for (const error of validation.errors) lines.push(`  error: ${error}`)
    for (const warning of validation.warnings) lines.push(`  warn:  ${warning}`)
    return { type: 'text', value: lines.join('\n') }
  }

  if (action === 'check') {
    const filePath = optionValue(tokens, '--file')
    let text: string
    if (filePath) {
      if (!existsSync(filePath)) {
        return { type: 'text', value: `File not found: ${filePath}` }
      }
      text = readFileSync(filePath, 'utf-8')
    } else {
      text = tokens
        .filter(token => !token.startsWith('--') && token !== 'check')
        .join(' ')
    }
    if (!text) return { type: 'text', value: usage() }
    const phase = (optionValue(tokens, '--phase') as GuardrailPhase | undefined) ?? 'both'
    const decision = await evaluateGuardrails(config, text, {
      phase,
      toolName: optionValue(tokens, '--tool'),
      dryRun: tokens.includes('--dry-run'),
    })
    return { type: 'text', value: formatDecision(decision, json) }
  }

  return { type: 'text', value: usage() }
}
