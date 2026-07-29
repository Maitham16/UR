import {
  isRuntimeTaskType,
  type Task,
  type TaskType,
} from './Task.js'
import { DreamTask } from './tasks/DreamTask/DreamTask.js'
import { InProcessTeammateTask } from './tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import { LocalAgentTask } from './tasks/LocalAgentTask/LocalAgentTask.js'
import { LocalShellTask } from './tasks/LocalShellTask/LocalShellTask.js'
import { RemoteAgentTask } from './tasks/RemoteAgentTask/RemoteAgentTask.js'

/**
 * Get every task implementation that can be created by this runtime.
 *
 * Historical serialized task discriminators deliberately do not appear here:
 * they remain parseable through TaskState, but this distribution has no
 * constructor or honest stop/cleanup implementation for them.
 *
 * Build the array inside the function: several task implementations reach the
 * shared task-state helpers through an import cycle, so capturing their
 * bindings in a top-level constant can observe them before initialization.
 */
export function getAllTasks(): Task[] {
  return [
    LocalShellTask,
    LocalAgentTask,
    RemoteAgentTask,
    InProcessTeammateTask,
    DreamTask,
  ]
}

/**
 * Get a task by its type.
 */
export function getTaskByType(type: TaskType): Task | undefined {
  if (!isRuntimeTaskType(type)) {
    return undefined
  }
  return getAllTasks().find(task => task.type === type)
}
