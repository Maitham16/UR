/** /ur-doctor — comprehensive UR environment check (toolchain, Ollama, .ur, MCP). */
import type { Command } from '../../types/command.js'
const urDoctor = {
  type: 'local',
  name: 'ur-doctor',
  description: 'Comprehensive UR health check: OS, tools, Ollama, .ur, MCP, playwright',
  supportsNonInteractive: true,
  load: () => import('./ur-doctor.js'),
} satisfies Command
export default urDoctor
