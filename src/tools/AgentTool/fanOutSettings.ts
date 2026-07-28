import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  DEFAULT_MAX_AGENT_DEPTH,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  type FanOutLimits,
} from './fanOutLimits.js'

/** Absolute ceilings. A settings file cannot disable the governor. */
const HARD_MAX_DEPTH = 10
const HARD_MAX_CONCURRENT = 100

function clamp(value: unknown, fallback: number, hardMax: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  if (rounded < 1) return 1
  return Math.min(rounded, hardMax)
}

/**
 * Effective fan-out limits: defaults, overridable through
 * `agents.maxDepth` / `agents.maxConcurrent`, clamped to a hard ceiling.
 *
 * Read per spawn rather than cached, so raising a limit takes effect without
 * restarting a long session.
 */
export function resolveFanOutLimits(
  settings = getInitialSettings(),
): FanOutLimits {
  const agents = (settings as { agents?: Record<string, unknown> }).agents ?? {}
  return {
    maxDepth: clamp(agents.maxDepth, DEFAULT_MAX_AGENT_DEPTH, HARD_MAX_DEPTH),
    maxConcurrent: clamp(
      agents.maxConcurrent,
      DEFAULT_MAX_CONCURRENT_AGENTS,
      HARD_MAX_CONCURRENT,
    ),
  }
}
