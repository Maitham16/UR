import type { ToolUseContext } from '../../Tool.js'
import { countActionableTasksForGate } from '../../services/tools/taskListGate.js'
import {
  deleteTask,
  getTaskListId,
  inspectTaskListForGate,
} from '../../utils/tasks.js'
import {
  createTaskFromInput,
  type TaskCreateInput,
} from '../TaskCreateTool/TaskCreateTool.js'

export type PlanTaskBlueprint = Pick<
  TaskCreateInput,
  'subject' | 'description' | 'activeForm'
>

const ACTION_PREFIX =
  /^(?:add|allow|build|change|clean|configure|create|debug|delete|design|document|enable|ensure|expose|fix|implement|integrate|migrate|prevent|publish|refactor|remove|rename|repair|replace|research|restore|review|run|secure|synchronize|test|update|upgrade|validate|verify)\b/iu
const IMPLEMENTATION_SECTION =
  /\b(?:approach|changes?|execution|implementation|migration|plan|steps?|tasks?|work)\b/iu
const VERIFICATION_SECTION =
  /\b(?:acceptance|checks?|quality|tests?|validation|verification)\b/iu
const NON_EXECUTION_SECTION =
  /\b(?:alternatives?|assumptions?|context|decisions?|goals?|notes?|out of scope|requirements?|risks?|scope)\b/iu
const VERIFICATION_STEP = /\b(?:check|test|validate|verify)\b/iu

function plainText(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/u, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`~#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function boundedDescription(value: string): string {
  const normalized = value.trim()
  return normalized.length <= 4_000
    ? normalized
    : `${normalized.slice(0, 3_999)}…`
}

function taskSubject(value: string): string {
  const cleaned = plainText(value).replace(/[.;:,]+$/u, '')
  const pathStep = cleaned.match(/^([^:]{1,100}\.[A-Za-z0-9]+):\s*(.+)$/u)
  const candidate = pathStep ? `${pathStep[2]} in ${pathStep[1]}` : cleaned
  const actionable = ACTION_PREFIX.test(candidate)
    ? candidate
    : `Implement ${candidate.charAt(0).toLowerCase()}${candidate.slice(1)}`
  return (actionable.charAt(0).toUpperCase() + actionable.slice(1)).slice(
    0,
    120,
  )
}

type PlanCandidate = {
  line: string
  subject: string
  kind: 'implementation' | 'verification'
}

function extractCandidates(plan: string): PlanCandidate[] {
  let section: 'implementation' | 'verification' | 'ignored' | 'unknown' =
    'unknown'
  const candidates: PlanCandidate[] = []

  for (const rawLine of plan.split(/\r?\n/gu)) {
    const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)
    if (heading) {
      const title = plainText(heading[1] ?? '')
      section = VERIFICATION_SECTION.test(title)
        ? 'verification'
        : NON_EXECUTION_SECTION.test(title)
          ? 'ignored'
          : IMPLEMENTATION_SECTION.test(title)
            ? 'implementation'
            : 'unknown'
      continue
    }
    if (!/^\s*(?:[-*+]\s+|\d+[.)]\s+)\S/u.test(rawLine)) continue

    const line = plainText(rawLine)
    if (line.length < 8 || section === 'ignored') continue
    const kind =
      section === 'verification' || VERIFICATION_STEP.test(line)
        ? 'verification'
        : 'implementation'
    const subject = taskSubject(line)
    if (subject.length < 8) continue
    candidates.push({ line, subject, kind })
  }
  return candidates
}

/**
 * Convert a human-approved markdown plan into a small, visible execution
 * board. It is intentionally bounded: a long list of file bullets must not
 * create dozens of noisy tasks.
 */
export function derivePlanTaskBlueprints(plan: string): PlanTaskBlueprint[] {
  const unique: PlanCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of extractCandidates(plan)) {
    const key = candidate.subject.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
    if (unique.length >= 8) break
  }

  const implementation = unique
    .filter(item => item.kind === 'implementation')
    .slice(0, 5)
  const verification = unique.find(item => item.kind === 'verification')
  const blueprints: PlanTaskBlueprint[] = implementation.map(item => ({
    subject: item.subject,
    description: boundedDescription(`Approved plan step: ${item.line}`),
  }))

  if (blueprints.length === 0) {
    blueprints.push({
      subject: 'Implement the approved plan',
      description: boundedDescription(
        plan.trim() || 'Implement the work approved in plan mode.',
      ),
      activeForm: 'Implementing the approved plan',
    })
  }
  blueprints.push({
    subject: verification?.subject ?? 'Verify the completed implementation',
    description: boundedDescription(
      verification?.line ??
        'Run the relevant tests and checks, then confirm the approved plan is complete.',
    ),
    activeForm: 'Verifying the completed implementation',
  })
  return blueprints
}

/** Ensure approved plan mode always hands implementation a real task board. */
export async function ensureApprovedPlanTasks(
  plan: string | null,
  planFilePath: string,
  context: ToolUseContext,
): Promise<string[]> {
  const inspection = await inspectTaskListForGate(getTaskListId())
  if (countActionableTasksForGate(inspection.tasks) > 0) return []

  const created: string[] = []
  const implementationIds: string[] = []
  const blueprints = derivePlanTaskBlueprints(plan ?? '')
  try {
    for (const [index, blueprint] of blueprints.entries()) {
      const isVerification = index === blueprints.length - 1
      const task = await createTaskFromInput(
        {
          ...blueprint,
          ...(isVerification && implementationIds.length > 0
            ? { blockedBy: implementationIds }
            : {}),
          metadata: {
            source: 'approved-plan',
            planFilePath,
          },
        },
        context,
      )
      created.push(task.id)
      if (!isVerification) implementationIds.push(task.id)
    }
    return created
  } catch (error) {
    // ExitPlanMode is an approval boundary, so never leave a partial board if
    // a TaskCreated hook or dependency write rejects one of the later tasks.
    for (const taskId of created.reverse()) {
      await deleteTask(getTaskListId(), taskId).catch(() => false)
    }
    throw error
  }
}
