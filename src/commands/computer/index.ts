import type { Command } from '../../types/command.js'

const computer = {
  type: 'local',
  name: 'computer',
  aliases: ['desktop-control'],
  description:
    'Control the desktop: screenshot, click, or type. State-changing actions require --yes',
  argumentHint: 'screenshot [path] | click <x> <y> [--right] --yes | type <text> --yes',
  supportsNonInteractive: true,
  load: () => import('./computer.js'),
} satisfies Command

export default computer
