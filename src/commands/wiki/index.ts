/** /wiki — auto-generated living repo wiki + repo map. */
import type { Command } from '../../types/command.js'
const wikiCmd = {
  type: 'local',
  name: 'wiki',
  aliases: ['repo-wiki'],
  description:
    'Generate a living repo wiki (architecture, key files, dependency map) and the prompt-injected repo map',
  argumentHint: 'generate [--quiet] | map | install-hook | status [--json]',
  supportsNonInteractive: true,
  load: () => import('./wiki.js'),
} satisfies Command
export default wikiCmd
