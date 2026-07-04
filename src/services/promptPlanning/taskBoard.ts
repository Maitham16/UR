import type { NexusTask, PromptPlan } from './types.js'

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ')
}

export type TaskBoardOptions = {
  activeAgents?: number
  maxAgents?: number
}

function publicStatus(task: NexusTask): string {
  if (task.status === 'pending' || task.status === 'ready') return 'queued'
  if (task.status === 'blocked' || task.status === 'needs-context') {
    return 'needs context'
  }
  if (task.status === 'needs-scope') return 'needs scope'
  if (task.status === 'waiting-approval') return 'waiting approval'
  if (task.status === 'paused-review') return 'paused for review'
  if (task.status === 'skipped') return 'skipped by policy'
  return task.status
}

function isWaiting(task: NexusTask): boolean {
  return [
    'blocked',
    'waiting-approval',
    'needs-scope',
    'needs-context',
    'paused-review',
  ].includes(task.status)
}

export function progressSummary(tasks: NexusTask[]): string {
  const finished = tasks.filter(task => task.status === 'finished').length
  const running = tasks.filter(task => task.status === 'running').length
  const queued = tasks.filter(task =>
    task.status === 'pending' || task.status === 'ready',
  ).length
  const waiting = tasks.filter(isWaiting).length
  const failed = tasks.filter(task => task.status === 'failed').length
  const skipped = tasks.filter(task => task.status === 'skipped').length
  return `Progress: ${finished}/${tasks.length} finished, ${running} running, ${queued} queued, ${waiting} waiting, ${failed} failed, ${skipped} skipped`
}

export function renderTaskBoard(
  planOrTasks: PromptPlan | NexusTask[],
  options: TaskBoardOptions = {},
): string {
  const tasks = Array.isArray(planOrTasks) ? planOrTasks : planOrTasks.tasks
  const activeAgents =
    options.activeAgents ?? tasks.filter(task => task.status === 'running').length
  const maxAgents =
    options.maxAgents ??
    (Array.isArray(planOrTasks) ? activeAgents || 1 : planOrTasks.config.maxAgents)
  const orderedTasks = [...tasks].sort((a, b) => a.order - b.order)
  const rows = orderedTasks.map(task => {
    const status = pad(publicStatus(task), 18)
    const agent = pad(String(task.assignedAgent), 8)
    return `${task.order}. ${status} | ${agent} | ${task.title}`
  })

  return [
    '[UR-Nexus Task Board]',
    `Agents: ${activeAgents} active / ${maxAgents} max`,
    ...rows,
    '',
    progressSummary(tasks),
  ].join('\n')
}
