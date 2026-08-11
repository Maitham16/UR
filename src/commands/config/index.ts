import type { Command } from '../../commands.js'

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: 'View or update settings (for example: /config thinking=false)',
  argumentHint: '[key=value ...]',
  load: () => import('./config.js'),
} satisfies Command

export default config
