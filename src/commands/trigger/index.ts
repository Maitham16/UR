import type { Command } from '../../types/command.js'

const trigger = {
  type: 'local',
  name: 'trigger',
  aliases: ['mention'],
  description:
    'Parse a GitHub/Slack webhook payload and optionally launch a headless UR run',
  argumentHint: 'parse|run --file payload.json [--source github|slack] [--keyword /ur] [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./trigger.js'),
} satisfies Command

export default trigger
