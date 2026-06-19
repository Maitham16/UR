/**
 * /ur-init — scaffold the project-local .ur asset folder
 * (docs, superpowers, brainstorming, memory, prompts).
 */
import type { Command } from '../../types/command.js'

const urInit = {
  type: 'local',
  name: 'ur-init',
  description: 'Generate the .ur asset folder (docs, superpowers, brainstorming, memory, prompts)',
  supportsNonInteractive: true,
  load: () => import('./ur-init.js'),
} satisfies Command

export default urInit
