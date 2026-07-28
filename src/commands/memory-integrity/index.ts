import type { Command } from '../../types/command.js'

const memoryIntegrity = {
  type: 'local',
  name: 'memory-integrity',
  aliases: ['mem-verify'],
  description:
    'Verify, baseline, or quarantine the file-backed memory stores (auto-memory, team memory)',
  argumentHint: '[verify|record|quarantine] [--store auto|team|<path>] [--json]',
  whenToUse:
    'Use `ur memory-integrity verify` to detect memory files that were modified, deleted, or dropped in by something other than UR — memory is injected into context, so an untracked file there is an injection vector.',
  supportsNonInteractive: true,
  load: () => import('./memory-integrity.js'),
} satisfies Command

export default memoryIntegrity
