/**
 * /stability — Stability-Aware MAPE-K controls (from the paper).
 * Metadata only; implementation is lazy-loaded from stability.ts.
 */
import type { Command } from '../../types/command.js'

const stability = {
  type: 'local',
  name: 'stability',
  description: 'Stability-Aware MAPE-K controls: metrics, firewall, root-cause, evidence',
  argumentHint: 'metrics | firewall | why <error> | policy | evidence | actions | cooldown',
  supportsNonInteractive: true,
  load: () => import('./stability.js'),
} satisfies Command

export default stability
