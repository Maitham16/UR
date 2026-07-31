import { existsSync, readFileSync } from 'node:fs'
import type { LocalCommandCall } from '../../types/command.js'
import {
  buildTriggerCommand,
  formatTriggerDecision,
  parseTriggerPayload,
  type TriggerSource,
} from '../../services/agents/triggerBridge.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function usage(): string {
  return [
    'Usage:',
    '  ur trigger parse --file payload.json [--source github|slack|generic] [--keyword /ur] [--json]',
    '  ur trigger run   --file payload.json [--keyword /ur] [--dry-run] [--max-turns N] [--json]',
    '',
    'Reads a webhook payload, decides whether it should dispatch UR, and (for run)',
    'launches a headless `ur -p` with the extracted prompt.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens.find(token => !token.startsWith('--')) ?? 'parse'
  const file = option(tokens, '--file')
  const source = option(tokens, '--source') as TriggerSource | undefined
  const keyword = option(tokens, '--keyword')
  const dryRun = tokens.includes('--dry-run')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const maxTurns = maxTurnsRaw ? Number(maxTurnsRaw) : undefined

  if (action !== 'parse' && action !== 'run') {
    return { type: 'text', value: usage() }
  }
  if (!file) {
    return { type: 'text', value: `Missing --file <payload.json>.\n\n${usage()}` }
  }
  if (!existsSync(file)) {
    return { type: 'text', value: `Payload file not found: ${file}` }
  }

  const payload = safeParseJSON(readFileSync(file, 'utf-8'), false)
  if (payload === null || typeof payload !== 'object') {
    return { type: 'text', value: `Payload is not valid JSON: ${file}` }
  }

  const decision = parseTriggerPayload(payload, { source, keyword })

  if (action === 'parse' || !decision.triggered) {
    const command = decision.triggered && decision.prompt
      ? buildTriggerCommand(decision.prompt, { maxTurns })
      : null
    return { type: 'text', value: formatTriggerDecision(decision, command, json) }
  }

  // action === 'run' && triggered
  const command = buildTriggerCommand(decision.prompt as string, { maxTurns })
  if (dryRun) {
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ decision, command, dryRun: true }, null, 2)
        : `${formatTriggerDecision(decision, command, false)}\n\n(dry run — not executed)`,
    }
  }

  const result = await execFileNoThrowWithCwd(command.file, command.args, {
    cwd: getCwd(),
    timeout: 30 * 60 * 1000,
    preserveOutputOnError: true,
  })
  const output = (result.stdout || result.stderr || '').trim()
  return {
    type: 'text',
    value: json
      ? JSON.stringify({ decision, command, exitCode: result.code, output }, null, 2)
      : `${formatTriggerDecision(decision, command, false)}\n\nExit: ${result.code}\n${output}`,
  }
}
