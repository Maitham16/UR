import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { UR_CODE_GUIDE_AGENT } from './built-in/urCodeGuideAgent.js'
import { EXPLORE_AGENT } from './built-in/exploreAgent.js'
import { GENERAL_PURPOSE_AGENT } from './built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from './built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from './built-in/statuslineSetup.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export function areExplorePlanAgentsEnabled(): boolean {
  // Explore and Plan are core UR capabilities for external users. They are
  // also the mechanically read-only target used by the task-free research
  // compatibility path, so compiling them out turns an otherwise valid
  // research delegation into TaskListRequired. Anthropic-internal builds may
  // retain their experiment; public, local, API, and subscription-CLI builds
  // must be deterministic.
  if (process.env.USER_TYPE !== 'ant') return true

  if (feature('BUILTIN_EXPLORE_PLAN_AGENTS')) {
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_stoat', true)
  }
  return false
}

export function getBuiltInAgents(): AgentDefinition[] {
  // Allow disabling all built-in agents via env var (useful for SDK users who want a blank slate)
  // Only applies in noninteractive mode (SDK/API usage)
  if (
    isEnvTruthy(process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS) &&
    getIsNonInteractiveSession()
  ) {
    return []
  }

  // Use lazy require inside the function body to avoid circular dependency
  // issues at module init time. The coordinatorMode module depends on tools
  // which depend on AgentTool which imports this file.
  if (feature('COORDINATOR_MODE')) {
    if (isEnvTruthy(process.env.UR_CODE_COORDINATOR_MODE)) {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { getCoordinatorAgents } =
        require('../../coordinator/workerAgent.js') as typeof import('../../coordinator/workerAgent.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      return getCoordinatorAgents()
    }
  }

  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
    STATUSLINE_SETUP_AGENT,
  ]

  if (areExplorePlanAgentsEnabled()) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }

  // Include Code Guide agent for non-SDK entrypoints
  const isNonSdkEntrypoint =
    process.env.UR_CODE_ENTRYPOINT !== 'sdk-ts' &&
    process.env.UR_CODE_ENTRYPOINT !== 'sdk-py' &&
    process.env.UR_CODE_ENTRYPOINT !== 'sdk-cli'

  if (isNonSdkEntrypoint) {
    agents.push(UR_CODE_GUIDE_AGENT)
  }

  // Verification agent: registered so the user can run deep verification on
  // demand via the /verify command. It does NOT auto-spawn after each turn by
  // default — the verifier subsystem (src/services/verifier) only nudges the
  // model to spawn it when UR_VERIFIER_AUTO_SUBAGENT is set. Opt out of
  // registering it at all (disabling manual /verify too) via
  // UR_VERIFIER_DISABLE_SUBAGENT.
  if (!isEnvTruthy(process.env.UR_VERIFIER_DISABLE_SUBAGENT)) {
    agents.push(VERIFICATION_AGENT)
  }

  return agents
}
