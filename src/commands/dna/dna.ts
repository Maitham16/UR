import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { writeDna } from '../../ur/projectDna.js'

export const call: LocalCommandCall = async () => {
  return { type: 'text', value: writeDna(getCwd()) + '\n\n(saved to .ur/project_dna.md)' }
}
