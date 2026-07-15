import type { Command } from '../../types/command.js'

const acp = {
  type: 'local',
  name: 'acp',
  description: 'Manage Agent Client Protocol (ACP) editor and HTTP compatibility transports',
  argumentHint: '[serve|stdio|stop|status] [--host] [--port] [--token] [--debug] [--json]',
  supportsNonInteractive: true,
  load: () => import('./acp.js'),
} satisfies Command

export default acp
