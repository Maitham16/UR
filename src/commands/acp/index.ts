import type { Command } from '../../types/command.js'

const acp = {
  type: 'local',
  name: 'acp',
  description: 'Manage the local Agent Communication Protocol (ACP) server for IDE extensions',
  argumentHint: '[serve|stop|status] [--host] [--port] [--token] [--json]',
  supportsNonInteractive: true,
  load: () => import('./acp.js'),
} satisfies Command

export default acp
