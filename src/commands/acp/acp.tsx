import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import {
  getAcpServerPort,
  serveAcp,
  stopAcpServer,
} from '../../services/agents/acpServer.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set([
    '--host',
    '--port',
    '--token',
  ])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur acp serve [--host 127.0.0.1] [--port 8123] [--token <secret>] [--dry-run] [--debug]',
    '  ur acp stdio            Run a stdio ACP agent for editors (Zed, ACP Neovim)',
    '  ur acp stop',
    '  ur acp status [--json]',
    '',
    'Set UR_ACP_TOKEN instead of --token to keep the secret out of process arguments.',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = positionals(tokens)[0] ?? 'status'
  const host = option(tokens, '--host') ?? '127.0.0.1'
  const port = Number(option(tokens, '--port') ?? '8123')
  const token = option(tokens, '--token') ?? process.env.UR_ACP_TOKEN
  const dryRun = tokens.includes('--dry-run')
  const debug = tokens.includes('--debug')

  if (action === 'serve' || action === 'start') {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      return { type: 'text', value: 'Port must be an integer between 1 and 65535' }
    }
    await serveAcp({ host, port, token, cwd: process.cwd(), dryRun, debug })
    return { type: 'text', value: '' }
  }

  if (action === 'stdio') {
    const { startAcpStdioAgent } = await import('../../services/agents/acpStdio.js')
    await startAcpStdioAgent({ cwd: process.cwd() })
    return { type: 'text', value: '' }
  }

  if (action === 'stop') {
    await stopAcpServer()
    return { type: 'text', value: json ? JSON.stringify({ stopped: true }) : 'UR HTTP agent server stopped' }
  }

  if (action === 'status') {
    const runningPort = getAcpServerPort()
    const result = { running: runningPort !== null, port: runningPort }
    return {
      type: 'text',
      value: json ? JSON.stringify(result, null, 2) : `UR HTTP agent server: ${result.running ? `running on port ${result.port}` : 'not running'}`,
    }
  }

  return { type: 'text', value: usage() }
}
