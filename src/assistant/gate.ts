import { feature } from 'bun:bundle'
import { checkGate_CACHED_OR_BLOCKING } from '../services/analytics/growthbook.js'

export const KAIROS_GATE_NAME = 'tengu_kairos'

/**
 * Blocking entitlement check for settings-driven assistant activation. The
 * GrowthBook helper returns a cached true immediately and refreshes a
 * missing/stale false before denying access. Project trust gates only the
 * project-local prompt addendum, not assistant activation itself.
 */
export async function isKairosEnabled(): Promise<boolean> {
  return feature('KAIROS')
    ? checkGate_CACHED_OR_BLOCKING(KAIROS_GATE_NAME)
    : false
}
