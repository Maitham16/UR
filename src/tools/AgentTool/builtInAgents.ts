import { feature } from 'bun:bundle'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { UR_CODE_GUIDE_AGENT } from './built-in/urCodeGuideAgent.js'
import { EXPLORE_AGENT } from './built-in/exploreAgent.js'
import {
  GENERAL_PURPOSE_AGENT,
  WORKER_AGENT,
} from './built-in/generalPurposeAgent.js'
import { PLAN_AGENT } from './built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from './built-in/statuslineSetup.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'
import type { AgentDefinition } from './loadAgentsDir.js'

export function areExplorePlanAgentsEnabled(): boolean {
  // Plan-mode instructions name these agents directly. Keeping their
  // registration behind a compile-time experiment made the standard npm build
  // advertise tools that did not exist. Match the supported SDK opt-out so
  // older capability-unaware prompt paths do not advertise disabled agents.
  if (
    feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.UR_CODE_COORDINATOR_MODE)
  ) {
    return false
  }
  return !(
    isEnvTruthy(process.env.UR_AGENT_SDK_DISABLE_BUILTIN_AGENTS) &&
    getIsNonInteractiveSession()
  )
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
    WORKER_AGENT,
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
