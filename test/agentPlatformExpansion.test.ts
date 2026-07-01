import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import type { ModelCapability } from '../src/commands/model-doctor/model-doctor.js'
import {
  deriveModelNeeds,
  filterModelPoolForLocalOnly,
  isCloudModelName,
  recommendModel,
  resolveModelForTask,
  scoreModel,
  shouldUseStrongModel,
} from '../src/services/agents/modelRouter.js'
import {
  buildTriggerCommand,
  detectTriggerSource,
  extractPrompt,
  parseTriggerPayload,
} from '../src/services/agents/triggerBridge.js'
import {
  addGoalNote,
  createGoal,
  listGoals,
  loadGoal,
  setGoalStatus,
} from '../src/services/agents/goals.js'
import {
  claimNextTask,
  createCrew,
  crewProgress,
  decomposeGoal,
  loadCrew,
  reopenClaimed,
  runCrew,
} from '../src/services/agents/crew.js'
import {
  buildCronLine,
  buildLaunchdPlist,
  buildSystemdService,
  buildSystemdTimer,
  runDaemon,
  schedulerLabel,
} from '../src/services/agents/scheduler.js'
import { parseResultText } from '../src/sdk/index.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'ur-expansion-'))
}

const VISION: ModelCapability = {
  name: 'llava:13b',
  advertisedCapabilities: ['vision'],
  contextLength: 8_000,
  likelyVision: true,
  likelyCode: false,
}
const CODER: ModelCapability = {
  name: 'qwen3-coder:480b',
  advertisedCapabilities: ['tools'],
  contextLength: 128_000,
  likelyVision: false,
  likelyCode: true,
}
const EMBED: ModelCapability = {
  name: 'nomic-embed-text',
  advertisedCapabilities: [],
  embeddingLength: 768,
  contextLength: 2_048,
  likelyVision: false,
  likelyCode: false,
}

describe('modelRouter', () => {
  test('derives vision need for screenshot/UI tasks', () => {
    expect(deriveModelNeeds('look at this screenshot of the UI', 'browser')).toContain('vision')
    expect(deriveModelNeeds('embed these notes into the index', 'memory')).toContain('embeddings')
    expect(deriveModelNeeds('refactor the parser function', 'coding')).toContain('code')
  })

  test('scoreModel penalizes a non-vision model when vision is required', () => {
    const visionScore = scoreModel(VISION, ['vision']).score
    const coderScore = scoreModel(CODER, ['vision']).score
    expect(visionScore).toBeGreaterThan(coderScore)
  })

  test('recommends the vision model for a vision task', () => {
    const result = recommendModel('describe the layout in this screenshot', [CODER, VISION])
    expect(result.needs).toContain('vision')
    expect(result.recommended).toBe('llava:13b')
  })

  test('recommends an embedding model for retrieval indexing', () => {
    const result = recommendModel('build a semantic embedding index of the docs', [CODER, EMBED])
    expect(result.recommended).toBe('nomic-embed-text')
  })

  test('degrades gracefully with no local models', () => {
    const result = recommendModel('do anything', [])
    expect(result.recommended).toBeNull()
    expect(result.rationale).toContain('No local Ollama models')
  })

  test('auto strategy uses cheap local models for simple tasks and strong models for planning/security/debugging', () => {
    const models: ModelCapability[] = [
      {
        name: 'llama3.2:3b',
        advertisedCapabilities: [],
        contextLength: 8_000,
        likelyVision: false,
        likelyCode: false,
      },
      {
        name: 'qwen2.5-coder:32b',
        advertisedCapabilities: ['tools'],
        contextLength: 128_000,
        likelyVision: false,
        likelyCode: true,
      },
    ]
    const pool = {
      cheap: ['llama3.2:3b'],
      strong: ['qwen2.5-coder:32b'],
      default: ['llama3.2:3b'],
    }
    expect(shouldUseStrongModel('hi')).toBe(false)
    expect(shouldUseStrongModel('plan the auth refactor')).toBe(true)
    expect(shouldUseStrongModel('debug this production security failure')).toBe(true)
    expect(resolveModelForTask('hi', 'auto', pool, models)).toBe('llama3.2:3b')
    expect(resolveModelForTask('plan the auth refactor', 'auto', pool, models)).toBe('qwen2.5-coder:32b')
    expect(resolveModelForTask('security review this diff', 'auto', pool, models)).toBe('qwen2.5-coder:32b')
  })

  test('local-only routing filters cloud models for offline work', () => {
    const models: ModelCapability[] = [
      {
        name: 'kimi-k2.7-code:cloud',
        advertisedCapabilities: ['tools'],
        contextLength: 128_000,
        likelyVision: false,
        likelyCode: true,
      },
      {
        name: 'qwen2.5-coder:7b',
        advertisedCapabilities: ['tools'],
        contextLength: 32_000,
        likelyVision: false,
        likelyCode: true,
      },
    ]
    const pool = {
      cheap: ['qwen2.5-coder:7b'],
      strong: ['kimi-k2.7-code:cloud', 'gpt-4o', 'qwen2.5-coder:7b'],
      default: ['kimi-k2.7-code:cloud'],
    }

    expect(isCloudModelName('kimi-k2.7-code:cloud')).toBe(true)
    expect(isCloudModelName('gpt-4o')).toBe(true)
    expect(isCloudModelName('gpt-oss:20b')).toBe(false)
    expect(filterModelPoolForLocalOnly(pool, true)).toEqual({
      cheap: ['qwen2.5-coder:7b'],
      strong: ['qwen2.5-coder:7b'],
      default: [],
    })
    expect(recommendModel('security review', models, { localOnly: true }).recommended).toBe('qwen2.5-coder:7b')
    expect(resolveModelForTask('security review', 'strong', pool, models, { localOnly: true })).toBe('qwen2.5-coder:7b')
    expect(resolveModelForTask('simple note', 'default', pool, models, { localOnly: true })).toBeUndefined()

    const embeddingOnly = recommendModel('security review', [
      {
        name: 'nomic-embed-text:latest',
        advertisedCapabilities: [],
        contextLength: 8_000,
        likelyVision: false,
        likelyCode: false,
        embeddingLength: 768,
      },
    ], { localOnly: true })
    expect(embeddingOnly.recommended).toBeNull()
    expect(embeddingOnly.rationale).toContain('code-capable')
    expect(resolveModelForTask('security review', 'strong', pool, [models[0]!], { localOnly: true })).toBe('qwen2.5-coder:7b')
  })
})

describe('triggerBridge', () => {
  test('extractPrompt returns text after the keyword and strips slack mentions', () => {
    expect(extractPrompt('hey /ur fix the bug', '/ur')).toBe('fix the bug')
    expect(extractPrompt('<@U1> /ur summarize this', '/ur')).toBe('summarize this')
    expect(extractPrompt('no mention here', '/ur')).toBeUndefined()
  })

  test('parses a GitHub issue comment payload', () => {
    const payload = {
      comment: { body: 'please /ur fix the failing test', user: { login: 'octocat' } },
      issue: { number: 42 },
      repository: { full_name: 'acme/widgets' },
      sender: { login: 'octocat' },
    }
    expect(detectTriggerSource(payload)).toBe('github')
    const decision = parseTriggerPayload(payload)
    expect(decision.triggered).toBe(true)
    expect(decision.source).toBe('github')
    expect(decision.prompt).toBe('fix the failing test')
    expect(decision.context.issue).toBe(42)
    expect(decision.context.repo).toBe('acme/widgets')
  })

  test('parses a Slack app_mention payload', () => {
    const payload = {
      type: 'event_callback',
      event: { type: 'app_mention', text: '<@U999> /ur summarize the README', channel: 'C123', user: 'U001' },
    }
    expect(detectTriggerSource(payload)).toBe('slack')
    const decision = parseTriggerPayload(payload)
    expect(decision.triggered).toBe(true)
    expect(decision.prompt).toBe('summarize the README')
    expect(decision.context.channel).toBe('C123')
  })

  test('a generic payload with an explicit prompt always triggers', () => {
    const decision = parseTriggerPayload({ prompt: 'just do it' }, { source: 'generic' })
    expect(decision.triggered).toBe(true)
    expect(decision.prompt).toBe('just do it')
  })

  test('no keyword means no trigger', () => {
    const decision = parseTriggerPayload({ comment: { body: 'nice work everyone' }, issue: { number: 1 } })
    expect(decision.triggered).toBe(false)
  })

  test('buildTriggerCommand puts the prompt last and uses headless json', () => {
    const { args } = buildTriggerCommand('do the thing', { bin: { file: 'ur', baseArgs: [] } })
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args[args.length - 1]).toBe('do the thing')
  })
})

describe('goals', () => {
  test('create, note, status, and list round-trip on disk', () => {
    const cwd = tmp()
    const spec = createGoal(cwd, 'ship v2', 'Ship the v2 milestone', { workflow: 'release' })
    expect(spec.status).toBe('active')
    expect(spec.workflow).toBe('release')

    addGoalNote(cwd, 'ship v2', 'finished the API layer')
    const reloaded = loadGoal(cwd, 'ship v2')
    expect(reloaded?.notes.length).toBe(1)
    expect(reloaded?.notes[0].text).toBe('finished the API layer')

    setGoalStatus(cwd, 'ship v2', 'done')
    expect(loadGoal(cwd, 'ship v2')?.status).toBe('done')
    expect(listGoals(cwd).length).toBe(1)
  })
})

describe('crew', () => {
  test('decomposeGoal prefers numbered, then bullets, then conjunctions', () => {
    expect(decomposeGoal('1. do a\n2. do b\n3. do c')).toEqual(['do a', 'do b', 'do c'])
    expect(decomposeGoal('- alpha\n- beta')).toEqual(['alpha', 'beta'])
    expect(decomposeGoal('write the parser and then add tests')).toEqual(['write the parser', 'add tests'])
    expect(decomposeGoal('one indivisible task')).toEqual(['one indivisible task'])
  })

  test('decomposeGoal handles inline numbering and literal \\n from the CLI round-trip', () => {
    expect(decomposeGoal('1. a 2. b 3. c')).toEqual(['a', 'b', 'c'])
    expect(decomposeGoal('1. write parser\\n2. add tests')).toEqual(['write parser', 'add tests'])
  })

  test('claimNextTask is race-free across workers', () => {
    const cwd = tmp()
    createCrew(cwd, 'board', '1. a\n2. b')
    const first = claimNextTask(cwd, 'board', 'w1')
    const second = claimNextTask(cwd, 'board', 'w2')
    expect(first?.id).not.toBe(second?.id)
    expect(claimNextTask(cwd, 'board', 'w3')).toBeNull()
  })

  test('reopenClaimed restores orphaned tasks', () => {
    const cwd = tmp()
    createCrew(cwd, 'board', '1. a\n2. b')
    claimNextTask(cwd, 'board', 'w1')
    const reopened = reopenClaimed(cwd, 'board')
    expect(reopened?.tasks.every(t => t.status === 'todo')).toBe(true)
  })

  test('runCrew completes every task with an injected runner', async () => {
    const cwd = tmp()
    createCrew(cwd, 'demo', '1. first\n2. second\n3. third')
    const result = await runCrew('demo', {
      cwd,
      workers: 2,
      runnerFor: () => async () => ({ output: 'all good VERDICT: PASS', verdict: 'PASS', isError: false }),
    })
    expect(result.handled.length).toBe(3)
    expect(result.progress.done).toBe(3)
    const spec = loadCrew(cwd, 'demo')
    expect(spec && crewProgress(spec).done).toBe(3)
  })

  test('runCrew marks FAIL verdicts as failed', async () => {
    const cwd = tmp()
    createCrew(cwd, 'bad', 'only task')
    const result = await runCrew('bad', {
      cwd,
      runnerFor: () => async () => ({ output: 'could not VERDICT: FAIL', verdict: 'FAIL', isError: false }),
    })
    expect(result.progress.failed).toBe(1)
  })
})

describe('scheduler', () => {
  test('produces a stable per-project label', () => {
    expect(schedulerLabel('/a/b')).toBe(schedulerLabel('/a/b'))
    expect(schedulerLabel('/a/b')).not.toBe(schedulerLabel('/a/c'))
  })

  test('builds platform unit files', () => {
    const config = { cwd: '/work/proj', intervalSec: 120 }
    const plist = buildLaunchdPlist(config)
    expect(plist).toContain('<key>StartInterval</key>')
    expect(plist).toContain('<integer>120</integer>')
    expect(plist).toContain('automation')

    expect(buildSystemdService(config)).toContain('ExecStart=')
    expect(buildSystemdTimer(config)).toContain('OnUnitActiveSec=120')
    const cron = buildCronLine(config)
    expect(cron.startsWith('* * * * *')).toBe(true)
    expect(cron).toContain('run-due')
  })

  test('runDaemon once executes a single tick', async () => {
    const cwd = tmp()
    const ticks = await runWithCwdOverride(cwd, async () => {
      const seen: number[] = []
      await runDaemon({ cwd, once: true, onTick: info => seen.push(info.ran) })
      return seen
    })
    expect(ticks.length).toBe(1)
    expect(ticks[0]).toBe(0) // no automations defined
  })

  test('runDaemon honors maxTicks with an injected sleep', async () => {
    const cwd = tmp()
    const count = await runWithCwdOverride(cwd, async () =>
      runDaemon({ cwd, maxTicks: 3, intervalSec: 1, sleep: async () => {} }),
    )
    expect(count).toBe(3)
  })
})

describe('sdk', () => {
  test('parseResultText extracts the final assistant text', () => {
    expect(parseResultText('{"result":"hello"}')).toBe('hello')
    expect(parseResultText('plain text output')).toBe('plain text output')
    expect(parseResultText('[{"type":"x"},{"text":"the answer"}]')).toBe('the answer')
    expect(parseResultText('')).toBe('')
  })
})
