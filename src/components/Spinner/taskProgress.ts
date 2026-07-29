import { compareTaskIds, type Task } from '../../utils/tasks.js'

/**
 * Return the task the agent is actively executing.
 *
 * Failed and skipped tasks are terminal states, not current work. Sorting also
 * makes the display deterministic if malformed state temporarily contains
 * more than one in-progress task.
 */
export function findCurrentTask(tasks: readonly Task[] | undefined): Task | undefined {
  return tasks
    ?.filter(task => task.status === 'in_progress')
    .sort((left, right) => compareTaskIds(left.id, right.id))[0]
}

/**
 * Return the first pending task whose dependencies have all completed.
 *
 * Do not fall back to a blocked task: advertising it as "Next" implies the
 * agent can execute it, which is false and makes dependency stalls harder to
 * diagnose.
 */
export function findNextActionableTask(
  tasks: readonly Task[] | undefined,
): Task | undefined {
  if (!tasks) return undefined

  const unresolvedIds = new Set(
    tasks
      .filter(task => task.status !== 'completed')
      .map(task => task.id),
  )

  return tasks
    .filter(task => task.status === 'pending')
    .sort((left, right) => compareTaskIds(left.id, right.id))
    .find(task => !task.blockedBy.some(id => unresolvedIds.has(id)))
}
