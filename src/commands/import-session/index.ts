import type { Command } from '../../types/command.js'

const importSession = {
  type: 'local',
  name: 'import-session',
  description:
    'Import a session transcript exported from another machine so it can be resumed here',
  argumentHint: '<path-to-transcript.jsonl>',
  supportsNonInteractive: true,
  load: () => import('./import-session.js'),
} satisfies Command

export default importSession
