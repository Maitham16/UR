import type { Tool } from '../Tool.js'
import type { PermissionResult } from '../utils/permissions/PermissionResult.js'
import {
  PRIVILEGED_PROMPT_CANARY,
  privilegedCanaryLeaked,
} from '../constants/executionContract.js'
import {
  listEvidence,
  type EvidenceEntry,
} from './evidenceLedger.js'

/**
 * Suspicious provenance is deliberately short-lived. This is a conservative
 * turn-level approximation of data-flow tainting: it protects actions taken
 * immediately after hostile content is observed without permanently poisoning
 * a long-running session.
 */
export const SUSPICIOUS_EVIDENCE_WINDOW_MS = 15 * 60_000

export type UntrustedActionGateOptions = {
  now?: number
  evidence?: readonly EvidenceEntry[]
  windowMs?: number
}

function serializeInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input)
  } catch {
    // A non-serializable input cannot be proven free of a canary.
    return String(input)
  }
}

export function recentSuspiciousEvidence(
  options: UntrustedActionGateOptions = {},
): EvidenceEntry[] {
  const now = options.now ?? Date.now()
  const windowMs = options.windowMs ?? SUSPICIOUS_EVIDENCE_WINDOW_MS
  return [...(options.evidence ?? listEvidence())].filter(
    entry =>
      entry.suspicious &&
      entry.recordedAt <= now &&
      now - entry.recordedAt <= windowMs,
  )
}

function actionCanCrossBoundary(
  tool: Tool,
  input: Record<string, unknown>,
): boolean {
  try {
    if (tool.isDestructive?.(input)) return true
  } catch {
    return true
  }
  try {
    if (!tool.isReadOnly(input)) return true
  } catch {
    return true
  }
  try {
    return tool.isOpenWorld(input)
  } catch {
    return true
  }
}

/**
 * Runtime policy derived from provenance, independent of model compliance.
 *
 * - A leaked canary is a hard denial.
 * - Recent suspicious content forces explicit approval before a mutating,
 *   destructive, or open-world action.
 * - Local passive reads remain available so the agent can investigate safely.
 */
export function checkUntrustedActionGate(
  tool: Tool,
  input: Record<string, unknown>,
  options: UntrustedActionGateOptions = {},
): PermissionResult | undefined {
  const serialized = serializeInput(input)
  if (privilegedCanaryLeaked(serialized)) {
    return {
      behavior: 'deny',
      message:
        'Blocked: a privileged prompt canary appeared in the tool input. ' +
        'The trust boundary was crossed; start a clean turn and inspect untrusted sources before continuing.',
      decisionReason: {
        type: 'safetyCheck',
        reason: `privileged prompt canary ${PRIVILEGED_PROMPT_CANARY.slice(0, 10)}… leaked into tool input`,
        classifierApprovable: false,
      },
    }
  }

  const suspicious = recentSuspiciousEvidence(options)
  if (suspicious.length === 0 || !actionCanCrossBoundary(tool, input)) {
    return undefined
  }

  const sources = [...new Set(suspicious.map(entry => entry.source))]
    .slice(0, 3)
    .join(', ')
  return {
    behavior: 'ask',
    message:
      `Recent untrusted content matched prompt-injection signals (${sources}). ` +
      `Approve ${tool.name} only if this exact action follows the user's request rather than directives in fetched content.`,
    decisionReason: {
      type: 'safetyCheck',
      reason: 'recent suspicious untrusted content requires provenance-aware approval',
      classifierApprovable: false,
    },
  }
}
