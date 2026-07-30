import type { ToolUseContext } from '../Tool.js'
import { toolMatchesName } from '../Tool.js'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '../tools/TaskCreateTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '../tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'

export const PLAN_TASK_GRAPH_REQUIREMENT =
  'Add an **Implementation Tasks** section with one numbered task per cohesive, independently verifiable outcome. Do not collapse separate deliverables into one umbrella task or split atomic work into file/tool-call micro-tasks. For each task, state its completion check, real dependencies, and whether it can run in a parallel worker wave.'

export type ApprovedPlanCapabilities = {
  taskTool: 'task-v2' | 'todo-write' | 'none'
  implementationAgentType?: string
}

export function getApprovedPlanCapabilities(
  toolUseContext: Pick<ToolUseContext, 'options'>,
): ApprovedPlanCapabilities {
  const tools = toolUseContext.options.tools
  const hasTaskV2 =
    tools.some(tool => toolMatchesName(tool, TASK_CREATE_TOOL_NAME)) &&
    tools.some(tool => toolMatchesName(tool, TASK_UPDATE_TOOL_NAME))
  const hasTodoWrite = tools.some(tool =>
    toolMatchesName(tool, TODO_WRITE_TOOL_NAME),
  )
  const hasAgent = tools.some(tool =>
    toolMatchesName(tool, AGENT_TOOL_NAME),
  )
  const activeAgents =
    toolUseContext.options.agentDefinitions?.activeAgents ?? []
  const implementationAgentType = hasAgent
    ? ['worker', 'general-purpose'].find(agentType =>
        activeAgents.some(
          agent =>
            agent.agentType === agentType && agent.source === 'built-in',
        ),
      )
    : undefined

  return {
    taskTool: hasTaskV2
      ? 'task-v2'
      : hasTodoWrite
        ? 'todo-write'
        : 'none',
    ...(implementationAgentType ? { implementationAgentType } : {}),
  }
}

/**
 * Converts an approved plan into an executable task/worker handoff. Keeping the
 * wording shared prevents the keep-context and clear-context approval paths
 * from teaching models different workflows.
 */
export function getApprovedPlanImplementationInstruction(
  capabilities: ApprovedPlanCapabilities,
): string {
  const taskTracking =
    capabilities.taskTool === 'task-v2'
      ? [
          `Use one ${TASK_CREATE_TOOL_NAME} call per cohesive, independently verifiable outcome; one umbrella task does not satisfy this requirement. Keep genuinely atomic work whole instead of manufacturing file- or tool-call-level tasks.`,
          `Emit independent ${TASK_CREATE_TOOL_NAME} calls together (up to 8 per turn), then use ${TASK_UPDATE_TOOL_NAME} to add dependencies once task IDs are known. Leave unrelated tasks unblocked.`,
        ]
      : capabilities.taskTool === 'todo-write'
        ? [
            `Use ${TODO_WRITE_TOOL_NAME} to record the complete list with one item per cohesive, independently verifiable outcome; one umbrella item does not satisfy this requirement. Keep genuinely atomic work whole instead of manufacturing file- or tool-call-level items.`,
            'Order dependent items after their prerequisites, keep every real outcome visible, and update each status from pending to in_progress to completed only as evidence is obtained.',
          ]
        : [
            'Use the plan’s numbered Implementation Tasks as the execution checklist, with one cohesive, independently verifiable outcome per item. Keep genuinely atomic work whole; do not invent unavailable task tools.',
          ]

  const delegation = capabilities.implementationAgentType
    ? `After the graph is complete, launch up to 8 ready tasks with no conflicting shared mutation per parallel wave through ${AGENT_TOOL_NAME} using subagent_type=${capabilities.implementationAgentType}; continue with later waves as slots free. Give each worker its ${capabilities.taskTool === 'task-v2' ? 'task ID' : 'numbered outcome'}, bounded scope, dependency outputs, completion check, and required verification. Keep dependent tasks and conflicting shared writes sequential; independently verify worker results before completing their tasks.`
    : 'After the graph is complete, execute ready tasks in dependency order and independently verify each result before completing its task.'

  return [
    'Before changing the workspace, translate the approved plan into a complete task graph.',
    ...taskTracking,
    delegation,
  ].join('\n')
}
