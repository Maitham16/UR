import { runPromptPlan } from '../src/services/promptPlanning/executor.js'
import type { NexusTask, PromptPlan } from '../src/services/promptPlanning/types.js'

function makeTask(id: string, order: number, title: string, status: NexusTask['status'], deps: string[] = []): NexusTask {
  return {
    id,
    order,
    title,
    description: `desc ${id}`,
    status,
    dependencies: deps,
    assignedAgent: 'executor',
    input: { prompt: `prompt ${id}`, assumptions: ['assume ok'], requiredFiles: [], targetFiles: [], resources: [] },
    expectedOutput: '',
    verificationCriteria: [],
    fileTargets: [],
    riskLevel: 'low',
    approvalRequired: false,
    approvalPaths: [],
    outsideWorkspacePaths: [],
  }
}

const tasks = [makeTask('1', 1, 'A', 'pending'), makeTask('2', 2, 'B', 'pending', ['1'])]
const plan: PromptPlan = {
  id: 'plan-1',
  originalPrompt: 'test',
  tasks,
  assumptions: [],
  createdAt: new Date().toISOString(),
  config: { taskPlanning: true, parallelAgents: false, maxAgents: 1, showTaskBoard: true, strictVerification: false },
}

const result = await runPromptPlan(plan, {
  cwd: process.cwd(),
  executeTask: async (task) => {
    console.log('executing', task.id)
    return { ok: true, output: 'completed' }
  },
  onEvent: event => {
    if (event.type === 'status') {
      console.log('status', event.task.id, event.task.status)
    }
    if (event.type === 'board') {
      console.log('BOARD---')
      console.log(event.board)
      console.log('---END BOARD')
    }
  },
})

console.log('result', JSON.stringify({ finished: result.finished, failed: result.failed, blocked: result.blocked, skipped: result.skipped }, null, 2))
console.log('tasks', result.tasks.map(t => ({ id: t.id, status: t.status })))
