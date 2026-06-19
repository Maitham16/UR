/** /dna — detect and save the project's DNA (language, build/test/lint, folders). */
import type { Command } from '../../types/command.js'

const dna = {
  type: 'local',
  name: 'dna',
  description: 'Detect project DNA (language, package manager, build/test/lint) and save to .ur',
  supportsNonInteractive: true,
  load: () => import('./dna.js'),
} satisfies Command

export default dna
