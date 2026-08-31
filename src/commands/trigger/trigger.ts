import { existsSync, readFileSync } from 'node:fs'
import type { LocalCommandCall } from '../../types/command.js'
import {
  buildTriggerCommand,
  formatTriggerDecision,
  parseTriggerPayload,
  type TriggerSource,
} from '../../services/agents/triggerBridge.js'
import {
  defaultTriggerReceiverStatePath,
  startTriggerReceiver,
  TriggerDispatchQueue,
  TriggerReceiverState,
  triggerReceiverAllowListsFromEnv,
  triggerReceiverSecretsFromEnv,
} from '../../services/agents/triggerReceiver.js'
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
    '  ur trigger parse --file payload.json [--source github|slack|gmail|teams|generic] [--keyword /ur] [--json]',
    '  ur trigger run   --file payload.json [--keyword /ur] [--dry-run] [--max-turns N] [--json]',
    '  ur trigger serve [--host 127.0.0.1] [--port 8787] [--state-file path] [--require-auth] [--dry-run]',
    '',
    'Reads a webhook payload, decides whether it should dispatch UR, and (for run)',
    'launches a headless `ur -p` with the extracted prompt. The serve action accepts',
    'GitHub, Slack, Gmail Pub/Sub, Teams, and generic HTTP events, with',
    'provider verification when configured.',
  ].join('\n')
}

function integerOption(tokens: string[], name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = option(tokens, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = tokens[0] && !tokens[0].startsWith('--') ? tokens[0] : 'parse'
  const file = option(tokens, '--file')
  const source = option(tokens, '--source') as TriggerSource | undefined
  const keyword = option(tokens, '--keyword')
  const dryRun = tokens.includes('--dry-run')
  const maxTurnsRaw = option(tokens, '--max-turns')
  const maxTurns = maxTurnsRaw
    ? integerOption(tokens, '--max-turns', 0, 1, 100_000)
    : undefined

  if (source && !['github', 'slack', 'gmail', 'teams', 'generic'].includes(source)) {
    return { type: 'text', value: `Unknown trigger source: ${source}\n\n${usage()}` }
  }

  if (action !== 'parse' && action !== 'run' && action !== 'serve') {
    return { type: 'text', value: usage() }
  }
  if (action === 'serve') {
    const cwd = getCwd()
    const host = option(tokens, '--host') ?? '127.0.0.1'
    const port = integerOption(tokens, '--port', 8787, 0, 65535)
    const maxBodyBytes = integerOption(tokens, '--max-body-bytes', 1024 * 1024, 1024, 16 * 1024 * 1024)
    const maxConcurrency = integerOption(tokens, '--max-concurrency', 4, 1, 64)
    const maxQueue = integerOption(tokens, '--max-queue', 256, maxConcurrency, 10_000)
    const stateFile = option(tokens, '--state-file') ?? defaultTriggerReceiverStatePath(cwd)
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host)
    const requireAuth = tokens.includes('--require-auth')
    const insecureDevelopment =
      !requireAuth && (tokens.includes('--insecure-development') || loopback)
    const state = new TriggerReceiverState(stateFile)
    const queue = new TriggerDispatchQueue({
      state,
      cwd,
      maxConcurrency,
      maxQueue,
      maxTurns,
      dryRun,
      logger: message => process.stderr.write(`${message}\n`),
    })
    const receiver = await startTriggerReceiver({
      state,
      dispatcher: queue,
      secrets: triggerReceiverSecretsFromEnv(),
      allowLists: triggerReceiverAllowListsFromEnv(),
      keyword,
      insecureDevelopment,
      host,
      port,
      maxBodyBytes,
    })
    process.stdout.write([
      `UR trigger receiver listening on ${receiver.url}`,
      'Routes: /events/github /events/slack /events/gmail /events/teams /events/generic',
      `State: ${stateFile}`,
      insecureDevelopment
        ? 'Local mode: unconfigured routes are accepted on loopback; use --require-auth to verify every route.'
        : 'Provider routes without a configured verification secret are disabled.',
      dryRun ? 'Dry run: accepted events are parsed but UR is not launched.' : '',
    ].filter(Boolean).join('\n') + '\n')

    const closed = new Promise<void>(resolve => receiver.server.once('close', resolve))
    const stop = () => receiver.server.close()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    await closed
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await queue.whenIdle()
    return { type: 'text', value: 'UR trigger receiver stopped.' }
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
