import type { Command } from '../../types/command.js'

const desktopQa = {
  type: 'local',
  name: 'desktop-qa',
  aliases: ['qa-desktop'],
  description:
    'Run bounded Electron fixtures with teardown, masked screenshots, and privacy-gated raw trace/video evidence',
  argumentHint:
    'run|validate|list|init|schema|doctor [fixture.json] [--json] [--keep] [--allow-external]',
  supportsNonInteractive: true,
  load: () => import('./desktop-qa.js'),
} satisfies Command

export default desktopQa
