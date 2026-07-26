import type { Command } from '../../commands.js'

const btw = {
  type: 'local-jsx',
  name: 'btw',
  description:
    'Create or continue a durable side chat without interrupting the main conversation',
  immediate: true,
  argumentHint: '<question> | continue/list/show/rename/close',
  load: () => import('./btw.js'),
} satisfies Command

export default btw
