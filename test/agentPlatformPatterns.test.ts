import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  buildExecutionPlan,
  compilePatternToWorkflow,
  getPattern,
  scaffoldPattern,
} from '../src/services/agents/patterns.js'
import {
  buildRunPlan,
  loadRunState,
  loadWorkflow,
  markStepComplete,
  parseWorkflowText,
  renderWorkflowAscii,
  saveWorkflow,
  validateWorkflow,
  type WorkflowSpec,
} from '../src/services/agents/workflows.js'
import {
  inspectMessages,
  type MessageLike,
} from '../src/services/agents/inspector.js'
import { routeIntent } from '../src/services/agents/intentRouter.js'
import {
  addSource,
  buildIndex,
  pruneKnowledge,
  searchKnowledge,
} from '../src/services/agents/knowledge.js'
import { cosineSimilarity, type Embedder } from '../src/services/agents/embeddings.js'
import {
  executeWorkflow,
  type ExecEvent,
  type StepRunner,
} from '../src/services/agents/executor.js'
import {
  LiveExecutionBoard,
  formatLiveEvent,
} from '../src/services/agents/liveBoard.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('collaboration patterns', () => {
  test('PEER has a review loop and four stages', () => {
    const peer = getPattern('peer')
    expect(peer).toBeDefined()
    expect(peer?.stages.map(stage => stage.id)).toEqual([
      'plan',
      'execute',
      'express',
      'review',
    ])
    expect(peer?.loop?.to).toBe('plan')
  })

  test('execution plan substitutes the task into every stage prompt', () => {
    const peer = getPattern('peer')!
    const plan = buildExecutionPlan(peer, 'fix the flaky auth test')
    expect(plan.steps).toHaveLength(4)
    expect(plan.steps[0].prompt).toContain('fix the flaky auth test')
    expect(plan.steps[3].agent).toBe('verification')
  })

  test('a pattern compiles into a valid checkpointed workflow', () => {
    const doe = getPattern('doe')!
    const workflow = compilePatternToWorkflow(doe)
    const validation = validateWorkflow(workflow)
    expect(validation.valid).toBe(true)
    expect(validation.order[0]).toBe('data')
  })

  test('install scaffolds the pattern spec and workflow file', () => {
    const dir = tempDir('ur-pattern-')
    const result = scaffoldPattern(dir, 'peer')
    expect(result.created).toContain('patterns/peer.json')
    expect(result.created).toContain('workflows/peer.yaml')
    expect(existsSync(join(dir, '.ur', 'workflows', 'peer.yaml'))).toBe(true)
  })

  test('pattern command lists and runs', async () => {
    const dir = tempDir('ur-pattern-cmd-')
    const { call } = await import('../src/commands/pattern/pattern.js')
    const list = await runWithCwdOverride(dir, () => call('list'))
    if (list.type !== 'text') throw new Error('expected text')
    expect(list.value).toContain('PEER')

    const run = await runWithCwdOverride(dir, () =>
      call('run peer "add a rate limiter" --json'),
    )
    if (run.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(run.value).steps).toHaveLength(4)
  })

  test('concurrent pattern compiles into a fan-out / fan-in DAG', () => {
    const conc = getPattern('concurrent')!
    const workflow = compilePatternToWorkflow(conc)
    const validation = validateWorkflow(workflow)
    expect(validation.valid).toBe(true)
    const synth = workflow.steps.find(s => s.id === 'synthesize')!
    expect(synth.dependsOn).toEqual(['survey', 'research', 'risks'])
    // The three branches fan out with no dependencies, so they run in parallel.
    for (const id of ['survey', 'research', 'risks']) {
      expect(workflow.steps.find(s => s.id === id)!.dependsOn).toEqual([])
    }
    // The fan-in step pulls in every upstream output via {{prior}}.
    expect(synth.prompt).toContain('{{prior}}')
  })

  test('handoff pattern triages, then delegates to a specialist', () => {
    const handoff = getPattern('handoff')!
    const workflow = compilePatternToWorkflow(handoff)
    expect(validateWorkflow(workflow).valid).toBe(true)
    expect(workflow.steps[0].id).toBe('triage')
    expect(workflow.steps.find(s => s.id === 'handle')!.dependsOn).toEqual(['triage'])
  })

  test('debate pattern has an adversarial moderation loop', () => {
    const debate = getPattern('debate')!
    expect(debate.stages.map(s => s.id)).toEqual(['propose', 'critique', 'moderate'])
    expect(debate.loop?.from).toBe('moderate')
    expect(debate.loop?.to).toBe('propose')
    expect(validateWorkflow(compilePatternToWorkflow(debate)).valid).toBe(true)
  })
})

describe('workflow engine', () => {
  const linear: WorkflowSpec = {
    version: 1,
    name: 'ship',
    steps: [
      { id: 'research', name: 'Research', agent: 'docs-researcher', prompt: 'r', dependsOn: [] },
      { id: 'build', name: 'Build', agent: 'worker', prompt: 'b', dependsOn: ['research'], checkpoint: true },
      { id: 'verify', name: 'Verify', agent: 'verification', prompt: 'v', dependsOn: ['build'], gate: 'verification' },
    ],
  }

  test('detects cycles and missing dependencies', () => {
    const cyclic: WorkflowSpec = {
      version: 1,
      name: 'cyc',
      steps: [
        { id: 'a', name: 'A', agent: 'worker', prompt: 'x', dependsOn: ['b'] },
        { id: 'b', name: 'B', agent: 'worker', prompt: 'y', dependsOn: ['a'] },
      ],
    }
    expect(validateWorkflow(cyclic).valid).toBe(false)
    const missing = validateWorkflow({
      version: 1,
      name: 'm',
      steps: [{ id: 'a', name: 'A', agent: 'worker', prompt: 'x', dependsOn: ['z'] }],
    })
    expect(missing.errors.join(' ')).toContain('missing step "z"')
  })

  test('topologically orders a valid graph and renders ASCII', () => {
    const validation = validateWorkflow(linear)
    expect(validation.order).toEqual(['research', 'build', 'verify'])
    expect(renderWorkflowAscii(linear)).toContain('Research')
  })

  test('run plan advances through checkpoints', () => {
    const dir = tempDir('ur-wf-')
    saveWorkflow(dir, linear)
    const loaded = loadWorkflow(dir, 'ship')
    expect(loaded?.steps).toHaveLength(3)

    let plan = buildRunPlan(linear, loadRunState(dir, 'ship'))
    expect(plan.nextStepId).toBe('research')
    expect(plan.steps[1].status).toBe('blocked')

    markStepComplete(dir, 'ship', 'research')
    plan = buildRunPlan(linear, loadRunState(dir, 'ship'))
    expect(plan.completed).toBe(1)
    expect(plan.nextStepId).toBe('build')
  })

  test('round-trips through YAML', () => {
    const dir = tempDir('ur-wf-yaml-')
    const saved = saveWorkflow(dir, linear)
    expect(saved.created).toBe(true)
    const reparsed = parseWorkflowText(readFileSync(saved.path, 'utf-8'))
    expect(reparsed.name).toBe('ship')
    expect(reparsed.steps[2].gate).toBe('verification')
  })
})

describe('agent run inspector', () => {
  test('reconstructs subagent runs, verdicts, and errors', () => {
    const messages: MessageLike[] = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'starting' },
            {
              type: 'tool_use',
              name: 'Agent',
              id: 't1',
              input: { subagent_type: 'plan', description: 'Plan it', prompt: 'make a plan' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'done — VERDICT: PASS' },
          ],
        },
      },
    ]
    const report = inspectMessages(messages)
    expect(report.summary.agentRuns).toBe(1)
    expect(report.summary.errors).toBe(0)
    expect(report.agents[0].subagentType).toBe('plan')
    expect(report.agents[0].verdict).toBe('PASS')
    expect(report.agents[0].status).toBe('ok')
  })
})

describe('intent router', () => {
  test('routes security, research, and complex coding tasks', () => {
    expect(routeIntent('audit the auth code for prompt injection vulnerabilities').category).toBe(
      'security',
    )
    const research = routeIntent('research and compare the latest agent interop specs from the docs')
    expect(research.category).toBe('research')
    expect(research.pattern).toBe('doe')

    const complex = routeIntent(
      'refactor the payment module and then add retries and also update the tests',
    )
    expect(complex.pattern).toBe('peer')
  })

  test('routes parallel, routing, and decision tasks to the new patterns', () => {
    expect(
      routeIntent('analyze these three modules in parallel and merge the findings').pattern,
    ).toBe('concurrent')
    expect(
      routeIntent('triage this incoming bug report and route it to the right specialist').pattern,
    ).toBe('handoff')
    expect(
      routeIntent('decide between Postgres and DynamoDB here; weigh the trade-offs').pattern,
    ).toBe('debate')
  })
})

describe('knowledge base', () => {
  test('adds, indexes, and searches with provenance', async () => {
    const dir = tempDir('ur-knowledge-')
    writeFileSync(join(dir, 'arch.md'), '# Arch\n\nUR routes all model traffic through the local Ollama app.\n')
    addSource(dir, 'arch.md', { label: 'architecture' })
    addSource(dir, 'Workers run via the Agent tool', { note: true })
    const index = await buildIndex(dir)
    expect(index.chunks.length).toBeGreaterThan(0)
    expect(index.mode).toBe('lexical')

    const results = await searchKnowledge(dir, 'ollama model traffic')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].ref).toBe('arch.md')
    expect(results[0].startLine).toBeGreaterThan(0)
  })

  test('dense retrieval ranks by embedding similarity', async () => {
    const dir = tempDir('ur-knowledge-embed-')
    writeFileSync(join(dir, 'a.md'), 'The Ollama runtime serves local models.\n')
    writeFileSync(join(dir, 'b.md'), 'Release notes summarize user-facing changes.\n')
    addSource(dir, 'a.md')
    addSource(dir, 'b.md')
    // Deterministic offline embedder: [ollama-ness, release-ness].
    const fakeEmbedder: Embedder = async texts =>
      texts.map(text => [
        /ollama|model/i.test(text) ? 1 : 0,
        /release|notes/i.test(text) ? 1 : 0,
      ])
    const index = await buildIndex(dir, { embedder: fakeEmbedder, embedModel: 'fake' })
    expect(index.mode).toBe('embedding')

    const results = await searchKnowledge(dir, 'local model serving', { embedder: fakeEmbedder })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].ref).toBe('a.md')
  })

  test('prune respects retention age', async () => {
    const dir = tempDir('ur-knowledge-prune-')
    addSource(dir, 'a recent durable fact', { note: true })
    await buildIndex(dir)
    const result = pruneKnowledge(dir, { olderThanDays: 36500 })
    expect(result.removedSources).toBe(0)
  })

  test('cosine similarity is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })
})

describe('workflow executor', () => {
  const peerSpec: WorkflowSpec = {
    version: 1,
    name: 'peer-test',
    pattern: 'peer',
    steps: [
      { id: 'plan', name: 'Plan', agent: 'plan', prompt: 'p', dependsOn: [] },
      { id: 'exec', name: 'Exec', agent: 'worker', prompt: 'e {{plan}}', dependsOn: ['plan'], checkpoint: true },
      { id: 'review', name: 'Review', agent: 'verification', prompt: 'r {{exec}}', dependsOn: ['exec'], gate: 'verification' },
    ],
  }
  const loop = { from: 'review', to: 'plan', maxIterations: 3 }

  test('runs a linear DAG and checkpoints each step', async () => {
    const checkpoints: string[][] = []
    const runStep: StepRunner = async ({ step }) => ({ output: `${step.id} ok`, verdict: step.id === 'review' ? 'PASS' : null })
    const result = await executeWorkflow(peerSpec, {
      runStep,
      onCheckpoint: (_id, completed) => checkpoints.push([...completed]),
    })
    expect(result.status).toBe('completed')
    expect(checkpoints.at(-1)).toEqual(['plan', 'exec', 'review'])
  })

  test('PEER loop re-runs the body until the reviewer passes', async () => {
    let reviewCalls = 0
    const runStep: StepRunner = async ({ step, feedback }) => {
      if (step.id === 'review') {
        reviewCalls++
        const pass = reviewCalls >= 2
        return { output: pass ? 'VERDICT: PASS' : 'too shallow VERDICT: FAIL', verdict: pass ? 'PASS' : 'FAIL' }
      }
      // Plan should receive reviewer feedback on the second cycle.
      if (step.id === 'plan' && reviewCalls === 1) expect(feedback).toContain('too shallow')
      return { output: `${step.id} ok`, verdict: null }
    }
    const result = await executeWorkflow(peerSpec, { runStep, loop })
    expect(result.status).toBe('completed')
    expect(result.iterations).toBe(2)
    expect(result.steps.find(s => s.id === 'plan')?.iterations).toBe(2)
  })

  test('stops at the iteration budget when the reviewer never passes', async () => {
    const runStep: StepRunner = async ({ step }) =>
      step.id === 'review'
        ? { output: 'VERDICT: FAIL', verdict: 'FAIL' }
        : { output: `${step.id} ok`, verdict: null }
    const result = await executeWorkflow(peerSpec, { runStep, loop: { from: 'review', to: 'plan', maxIterations: 2 } })
    expect(result.status).toBe('max-iterations')
    expect(result.iterations).toBe(2)
  })

  test('an unapproved approval gate holds the run', async () => {
    const spec: WorkflowSpec = {
      version: 1,
      name: 'gated',
      steps: [
        { id: 'build', name: 'Build', agent: 'worker', prompt: 'b', dependsOn: [] },
        { id: 'ship', name: 'Ship', agent: 'worker', prompt: 's', dependsOn: ['build'], gate: 'approval' },
      ],
    }
    const runStep: StepRunner = async ({ step }) => ({ output: `${step.id} ok` })
    const held = await executeWorkflow(spec, { runStep, approve: () => false })
    expect(held.status).toBe('held')
    const shipped = await executeWorkflow(spec, { runStep, approve: () => true })
    expect(shipped.status).toBe('completed')
  })

  const fanOut: WorkflowSpec = {
    version: 1,
    name: 'fan',
    steps: [
      { id: 'a', name: 'A', agent: 'worker', prompt: 'a', dependsOn: [] },
      { id: 'b', name: 'B', agent: 'worker', prompt: 'b', dependsOn: [] },
      { id: 'c', name: 'C', agent: 'worker', prompt: 'c', dependsOn: [] },
      { id: 'join', name: 'Join', agent: 'general-purpose', prompt: 'j {{prior}}', dependsOn: ['a', 'b', 'c'] },
    ],
  }

  function countingRunner(delayMs: number): { runStep: StepRunner; peak: () => number } {
    let active = 0
    let peak = 0
    const runStep: StepRunner = async ({ step }) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      active--
      return { output: `${step.id} ok` }
    }
    return { runStep, peak: () => peak }
  }

  test('runs independent ready steps concurrently up to the cap', async () => {
    const { runStep, peak } = countingRunner(10)
    const waves: string[][] = []
    const result = await executeWorkflow(fanOut, {
      runStep,
      maxConcurrency: 3,
      onEvent: event => {
        if (event.kind === 'wave') waves.push(event.ids)
      },
    })
    expect(result.status).toBe('completed')
    expect(peak()).toBe(3)
    expect(waves[0]).toEqual(['a', 'b', 'c'])
    // The join step still receives every upstream output.
    expect(result.steps.find(s => s.id === 'join')?.status).toBe('done')
  })

  test('respects the concurrency cap (cap of 2 never runs three at once)', async () => {
    const { runStep, peak } = countingRunner(10)
    const result = await executeWorkflow(fanOut, { runStep, maxConcurrency: 2 })
    expect(result.status).toBe('completed')
    expect(peak()).toBe(2)
  })

  test('maxConcurrency 1 forces strictly sequential execution', async () => {
    const { runStep, peak } = countingRunner(5)
    const result = await executeWorkflow(fanOut, { runStep, maxConcurrency: 1 })
    expect(result.status).toBe('completed')
    expect(peak()).toBe(1)
  })

  test('the concurrent pattern fans its branches out through the executor', async () => {
    const concurrent = compilePatternToWorkflow(getPattern('concurrent')!)
    const { runStep, peak } = countingRunner(10)
    const verdictRunner: StepRunner = async input => {
      const out = await runStep(input)
      return { ...out, verdict: input.step.id === 'synthesize' ? 'PASS' : null }
    }
    const result = await executeWorkflow(concurrent, { runStep: verdictRunner, maxConcurrency: 3 })
    expect(result.status).toBe('completed')
    expect(peak()).toBe(3)
  })

  test('a live board can be driven straight from executor events', async () => {
    const board = new LiveExecutionBoard(
      fanOut.name,
      fanOut.steps.map(s => ({ id: s.id, agent: s.agent })),
    )
    const result = await executeWorkflow(fanOut, {
      runStep: async ({ step }) => ({ output: `${step.id} ok` }),
      maxConcurrency: 3,
      onEvent: event => board.apply(event),
    })
    expect(result.status).toBe('completed')
    expect(board.status).toBe('completed')
    const counts = board.counts()
    expect(counts.done).toBe(4)
    expect(counts.total).toBe(4)
    expect(board.waves).toBe(1)
    expect(board.renderBoard()).toContain('✓ join')
  })
})

describe('live execution board', () => {
  const events: ExecEvent[] = [
    { kind: 'wave', ids: ['a', 'b'], iteration: 1 },
    { kind: 'step-start', id: 'a', agent: 'worker', iteration: 1 },
    { kind: 'step-start', id: 'b', agent: 'worker', iteration: 1 },
    { kind: 'step-done', id: 'a', verdict: null },
    { kind: 'step-done', id: 'b', verdict: null },
    { kind: 'step-start', id: 'review', agent: 'verification', iteration: 1 },
    { kind: 'step-done', id: 'review', verdict: 'PASS' },
    { kind: 'gate', id: 'review', gate: 'verification', result: 'pass' },
    { kind: 'finish', status: 'completed' },
  ]

  test('folds events into per-step state and counts', () => {
    const board = new LiveExecutionBoard('demo')
    for (const event of events) board.apply(event)
    expect(board.status).toBe('completed')
    expect(board.waves).toBe(1)
    const counts = board.counts()
    expect(counts.done).toBe(3)
    expect(counts.total).toBe(3)
    const render = board.renderBoard()
    expect(render).toContain('VERDICT: PASS')
    expect(render).toContain('✓ review')
  })

  test('an approval hold surfaces a held step', () => {
    const board = new LiveExecutionBoard('demo')
    board.apply({ kind: 'step-start', id: 'ship', agent: 'worker', iteration: 1 })
    board.apply({ kind: 'step-done', id: 'ship', verdict: null })
    board.apply({ kind: 'gate', id: 'ship', gate: 'approval', result: 'hold' })
    expect(board.counts().held).toBe(1)
  })

  test('streams a readable line per event and a parallel-wave summary', () => {
    expect(formatLiveEvent({ kind: 'wave', ids: ['a', 'b', 'c'], iteration: 1 })).toBe(
      '▶ running 3 in parallel: a, b, c',
    )
    expect(formatLiveEvent({ kind: 'step-done', id: 'r', verdict: 'PASS' })).toContain(
      'VERDICT: PASS',
    )
    // A single-step wave is not noisy-logged (the step-start line covers it).
    expect(formatLiveEvent({ kind: 'wave', ids: ['only'], iteration: 1 })).toBeNull()
  })
})
