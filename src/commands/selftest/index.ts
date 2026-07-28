import type { Command } from '../../types/command.js'

const selftest = {
  type: 'local',
  name: 'selftest',
  aliases: ['drills'],
  description:
    'End-to-end drills against the shipped binary, plus the prompts for the ones that need a live model',
  argumentHint: '[run|list] [--json]',
  whenToUse:
    'Use `ur selftest run` after upgrading to confirm features work end-to-end, not just in unit tests, and to get the manual prompts for anything that needs a live model.',
  supportsNonInteractive: true,
  load: () => import('./selftest.js'),
} satisfies Command

export default selftest
