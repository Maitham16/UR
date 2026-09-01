import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getKairosActive,
  getProjectRoot,
  getSessionId,
} from '../bootstrap/state.js'
import type { AppState } from '../state/AppStateStore.js'
import { formatAgentId } from '../utils/agentId.js'
import { getCwd } from '../utils/cwd.js'
import { getURConfigHomeDir } from '../utils/envUtils.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { setCliTeammateModeOverride } from '../utils/swarm/backends/teammateModeSnapshot.js'
import { TEAM_LEAD_NAME } from '../utils/swarm/constants.js'
import type { TeamFile } from '../utils/swarm/teamHelpers.js'
import {
  getTeamFilePath,
  registerTeamForSessionCleanup,
  sanitizeName,
  writeTeamFileAsync,
} from '../utils/swarm/teamHelpers.js'
import { assignTeammateColor } from '../utils/swarm/teammateLayoutManager.js'
import {
  ensureTasksDir,
  resetTaskList,
  setLeaderTeamName,
} from '../utils/tasks.js'

export type AssistantActivationPath = 'daemon' | 'settings'

let assistantForced = false
let assistantTeamPromise: Promise<NonNullable<AppState['teamContext']>> | null =
  null

export function markAssistantForced(): void {
  assistantForced = true
}

export function isAssistantForced(): boolean {
  return assistantForced
}

/**
 * Pre-entitlement intent check. main.tsx calls this before the GrowthBook gate,
 * so it must read the setting rather than relying only on kairosActive.
 */
export function isAssistantMode(): boolean {
  return (
    assistantForced ||
    getKairosActive() ||
    getInitialSettings().assistant === true
  )
}

export function getAssistantActivationPath(): AssistantActivationPath | undefined {
  if (!isAssistantMode()) return undefined
  return assistantForced ? 'daemon' : 'settings'
}

function readPrompt(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf8').trim()
    return content || null
  } catch {
    return null
  }
}

/**
 * Project instructions take precedence over the user's global assistant
 * profile only after the project trust dialog has been accepted. User-owned
 * global instructions remain safe to load before that point.
 */
export function getAssistantSystemPromptAddendum({
  includeProjectInstructions = true,
}: {
  includeProjectInstructions?: boolean
} = {}): string {
  if (includeProjectInstructions) {
    const projectPrompt = readPrompt(
      join(getProjectRoot(), '.ur', 'agents', 'assistant.md'),
    )
    if (projectPrompt) return projectPrompt
  }

  const userPrompt = readPrompt(
    join(getURConfigHomeDir(), 'agents', 'assistant.md'),
  )
  if (userPrompt) return userPrompt

  return [
    '# Assistant mode',
    '',
    'Stay responsive while work continues in the background. Delegate long-running or independent work to named agents, send concise user-facing checkpoints, and preserve useful context in the daily memory log.',
  ].join('\n')
}

/**
 * Creates the leader record needed by the in-process teammate backend. This is
 * idempotent for a session and intentionally mirrors TeamCreateTool's storage
 * contract so Agent(name: ...) works without a preceding TeamCreate call.
 */
export function initializeAssistantTeam(): Promise<
  NonNullable<AppState['teamContext']>
> {
  if (assistantTeamPromise) return assistantTeamPromise

  assistantTeamPromise = (async () => {
    setCliTeammateModeOverride('in-process')

    const sessionId = getSessionId()
    const teamName = sanitizeName(`assistant-${sessionId.slice(0, 8)}`)
    const leadAgentId = formatAgentId(TEAM_LEAD_NAME, teamName)
    const teamFilePath = getTeamFilePath(teamName)
    const now = Date.now()
    const cwd = getCwd()
    const leadColor = assignTeammateColor(leadAgentId)
    const teamFile: TeamFile = {
      name: teamName,
      description: 'Persistent assistant-mode in-process team',
      createdAt: now,
      leadAgentId,
      leadSessionId: sessionId,
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: 'assistant',
          joinedAt: now,
          tmuxPaneId: '',
          cwd,
          subscriptions: [],
          backendType: 'in-process',
        },
      ],
    }

    await writeTeamFileAsync(teamName, teamFile)
    registerTeamForSessionCleanup(teamName)
    await resetTaskList(teamName)
    await ensureTasksDir(teamName)
    setLeaderTeamName(teamName)

    return {
      teamName,
      teamFilePath,
      leadAgentId,
      isLeader: true,
      teammates: {
        [leadAgentId]: {
          name: TEAM_LEAD_NAME,
          agentType: 'assistant',
          color: leadColor,
          tmuxSessionName: '',
          tmuxPaneId: '',
          cwd,
          spawnedAt: now,
        },
      },
    }
  })().catch(error => {
    assistantTeamPromise = null
    throw error
  })

  return assistantTeamPromise
}

export function resetAssistantStateForTests(): void {
  assistantForced = false
  assistantTeamPromise = null
}
