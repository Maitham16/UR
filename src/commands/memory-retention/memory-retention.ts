import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  formatMemoryRetention,
  loadMemoryRetentionPolicy,
  pruneMemoryRetention,
  saveMemoryRetentionPolicy,
} from '../../services/agents/memoryRetention.js'

function option(tokens: string[], name: string): number | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  const n = Number(tokens[index + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

function positional(tokens: string[]): string {
  return tokens.find(t => !t.startsWith('--') && !/^\d+$/.test(t)) ?? 'show'
}

function usage(): string {
  return [
    'Usage:',
    '  ur memory retention show [--json]',
    '  ur memory retention set [--ttl-days N] [--max-entries N] [--decay-days N] [--json]',
    '  ur memory retention prune [--json]',
    'Slash command: /memory-retention show|set|prune ...',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = positional(tokens)

  if (action === 'show' || action === 'status') {
    return {
      type: 'text',
      value: formatMemoryRetention(
        { policy: loadMemoryRetentionPolicy(cwd), files: [] },
        json,
      ),
    }
  }

  if (action === 'set') {
    const policy = saveMemoryRetentionPolicy(cwd, {
      ttlDays: option(tokens, '--ttl-days'),
      maxEntries: option(tokens, '--max-entries'),
      decayDays: option(tokens, '--decay-days'),
    })
    return {
      type: 'text',
      value: formatMemoryRetention({ policy, files: [] }, json),
    }
  }

  if (action === 'prune' || action === 'apply') {
    return {
      type: 'text',
      value: formatMemoryRetention(pruneMemoryRetention(cwd), json),
    }
  }

  return { type: 'text', value: usage() }
}
