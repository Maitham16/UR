/** /recipe — structured-output child sessions from reusable playbooks. */
import type { Command } from '../../types/command.js'
const recipeCmd = {
  type: 'local',
  name: 'recipe',
  aliases: ['recipes'],
  description:
    'Reusable playbooks that run a child agent and enforce a JSON Schema on its output (init, list, run)',
  argumentHint:
    'init <name> | list | run <name> [input...] [--model m] [--max-turns n] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./recipe.js'),
} satisfies Command
export default recipeCmd
