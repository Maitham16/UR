/** /graph — research graph v1 (sources, papers, claims, methods, …). */
import type { Command } from '../../types/command.js'
const graph = {
  type: 'local',
  name: 'graph',
  description: 'Research graph: add/list entities (papers, claims, methods, datasets, …)',
  argumentHint: '[entity] [text]  ·  bare = summary',
  supportsNonInteractive: true,
  load: () => import('./graph.js'),
} satisfies Command
export default graph
