import type { Command } from '../../types/command.js'

const speakCommand = {
  type: 'local',
  name: 'speak',
  aliases: ['say'],
  description: 'Read text aloud using the system speech synthesiser',
  argumentHint: '<text> [--voice <name>] [--rate <wpm>]',
  supportsNonInteractive: true,
  load: () => import('./speak.js'),
} satisfies Command

export default speakCommand
