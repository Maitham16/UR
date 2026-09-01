import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getProjectRoot,
  setProjectRoot,
} from '../src/bootstrap/state.js'
import {
  getAssistantSystemPromptAddendum,
  initializeAssistantTeam,
  resetAssistantStateForTests,
} from '../src/assistant/index.js'
import {
  activateProactive,
  deactivateProactive,
  getNextTickAt,
  isProactiveActive,
  pauseProactive,
  resetProactiveStateForTests,
  resumeProactive,
  setContextBlocked,
  shouldTick,
} from '../src/proactive/index.js'
import {
  createProactiveTick,
  PROACTIVE_TICK_DELAY_MS,
} from '../src/proactive/useProactive.js'
import {
  resolveSleepDurationMs,
  SleepTool,
  waitForSleep,
} from '../src/tools/SleepTool/SleepTool.js'
import { PushNotificationTool } from '../src/tools/PushNotificationTool/PushNotificationTool.js'
import { SendUserFileTool } from '../src/tools/SendUserFileTool/SendUserFileTool.js'
import type { ToolUseContext } from '../src/Tool.js'
import {
  cleanupTeamDirectories,
  unregisterTeamForSessionCleanup,
} from '../src/utils/swarm/teamHelpers.js'
import { clearCliTeammateModeOverride } from '../src/utils/swarm/backends/teammateModeSnapshot.js'
import { clearLeaderTeamName } from '../src/utils/tasks.js'
import {
  getSessionSettingsCache,
  resetSettingsCache,
  setSessionSettingsCache,
} from '../src/utils/settings/settingsCache.js'
import { registerDreamSkill } from '../src/skills/bundled/dream.js'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../src/skills/bundledSkills.js'
import { getAutoMemPath } from '../src/memdir/paths.js'

const originalProjectRoot = getProjectRoot()
const originalConfigDir = process.env.UR_CONFIG_DIR
const originalMemoryOverride = process.env.UR_COWORK_MEMORY_PATH_OVERRIDE
const temporaryDirectories: string[] = []

afterEach(async () => {
  resetAssistantStateForTests()
  resetProactiveStateForTests()
  clearBundledSkills()
  setProjectRoot(originalProjectRoot)
  if (originalConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = originalConfigDir
  if (originalMemoryOverride === undefined)
    delete process.env.UR_COWORK_MEMORY_PATH_OVERRIDE
  else process.env.UR_COWORK_MEMORY_PATH_OVERRIDE = originalMemoryOverride
  getAutoMemPath.cache.clear()
  await Promise.all(
    temporaryDirectories.splice(0).map(path =>
      rm(path, { recursive: true, force: true }),
    ),
  )
})

describe('KAIROS assistant prompt selection', () => {
  test('defers project instructions until trust while retaining user instructions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ur-kairos-project-'))
    const config = await mkdtemp(join(tmpdir(), 'ur-kairos-config-'))
    temporaryDirectories.push(root, config)
    await mkdir(join(root, '.ur', 'agents'), { recursive: true })
    await mkdir(join(config, 'agents'), { recursive: true })
    await writeFile(
      join(root, '.ur', 'agents', 'assistant.md'),
      'project assistant instructions',
    )
    await writeFile(
      join(config, 'agents', 'assistant.md'),
      'user assistant instructions',
    )
    setProjectRoot(root)
    process.env.UR_CONFIG_DIR = config

    expect(
      getAssistantSystemPromptAddendum({ includeProjectInstructions: false }),
    ).toBe('user assistant instructions')
    expect(
      getAssistantSystemPromptAddendum({ includeProjectInstructions: true }),
    ).toBe('project assistant instructions')
  })

  test('initializes one reusable in-process assistant team', async () => {
    const config = await mkdtemp(join(tmpdir(), 'ur-kairos-team-'))
    temporaryDirectories.push(config)
    process.env.UR_CONFIG_DIR = config
    const first = initializeAssistantTeam()
    const second = initializeAssistantTeam()
    expect(second).toBe(first)
    const team = await first
    try {
      expect(team.isLeader).toBe(true)
      expect(Object.values(team.teammates)).toHaveLength(1)
      expect(Object.values(team.teammates)[0]?.name).toBe('team-lead')
      const persisted = JSON.parse(await readFile(team.teamFilePath, 'utf8')) as {
        members: Array<{ backendType?: string }>
      }
      expect(persisted.members[0]?.backendType).toBe('in-process')
    } finally {
      unregisterTeamForSessionCleanup(team.teamName)
      await cleanupTeamDirectories(team.teamName)
      clearLeaderTeamName()
      clearCliTeammateModeOverride('auto')
    }
  })
})

describe('/dream lifecycle', () => {
  test('builds the consolidation prompt without recording false success', async () => {
    const memory = await mkdtemp(join(tmpdir(), 'ur-kairos-dream-'))
    temporaryDirectories.push(memory)
    process.env.UR_COWORK_MEMORY_PATH_OVERRIDE = memory
    getAutoMemPath.cache.clear()
    clearBundledSkills()
    registerDreamSkill()
    const dream = getBundledSkills().find(skill => skill.name === 'dream')
    expect(dream).toBeDefined()
    if (!dream || dream.type !== 'prompt') {
      throw new Error('dream did not register as a prompt skill')
    }
    const blocks = await dream.getPromptForCommand(
      'focus on provider decisions',
      {} as ToolUseContext,
    )
    expect(blocks[0]?.type).toBe('text')
    expect(blocks[0]?.type === 'text' ? blocks[0].text : '').toContain(
      'focus on provider decisions',
    )
    await expect(readFile(join(memory, '.consolidate-lock'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
  })
})

describe('proactive tick and Sleep scheduling', () => {
  test('tracks activation, pause, and context blocking as one state machine', () => {
    expect(isProactiveActive()).toBe(false)
    activateProactive('test')
    expect(shouldTick()).toBe(true)
    expect(SleepTool.isEnabled()).toBe(true)
    pauseProactive()
    expect(shouldTick()).toBe(false)
    resumeProactive()
    setContextBlocked(true)
    expect(shouldTick()).toBe(false)
    setContextBlocked(false)
    expect(shouldTick()).toBe(true)
    deactivateProactive()
    expect(SleepTool.isEnabled()).toBe(false)
    expect(getNextTickAt()).toBeNull()
  })

  test('yields one event-loop turn and emits the documented tick envelope', () => {
    expect(PROACTIVE_TICK_DELAY_MS).toBe(0)
    const tick = createProactiveTick(new Date('2026-01-02T03:04:05Z'))
    expect(tick).toMatch(/^<tick>.+<\/tick>$/)
  })

  test('clamps requested duration and supports managed indefinite waits', () => {
    expect(resolveSleepDurationMs(1, { minSleepDurationMs: 2_000 })).toBe(
      2_000,
    )
    expect(resolveSleepDurationMs(10, { maxSleepDurationMs: 3_000 })).toBe(
      3_000,
    )
    expect(
      resolveSleepDurationMs(10, {
        minSleepDurationMs: 5_000,
        maxSleepDurationMs: 3_000,
      }),
    ).toBe(3_000)
    expect(resolveSleepDurationMs(1, { maxSleepDurationMs: -1 })).toBe(
      Infinity,
    )
  })

  test('wakes for queued work and for cancellation without waiting for deadline', async () => {
    let pending = false
    setTimeout(() => {
      pending = true
    }, 5)
    const queued = await waitForSleep({
      durationMs: 1_000,
      signal: new AbortController().signal,
      pollMs: 2,
      hasPendingCommand: () => pending,
    })
    expect(queued.reason).toBe('message')
    expect(queued.sleptMs).toBeLessThan(200)

    const controller = new AbortController()
    setTimeout(() => controller.abort('test'), 5)
    const interrupted = await waitForSleep({
      durationMs: Infinity,
      signal: controller.signal,
      pollMs: 2,
      hasPendingCommand: () => false,
    })
    expect(interrupted.reason).toBe('interrupted')
    expect(interrupted.effectiveDurationMs).toBeNull()
  })

  test('publishes and clears the live Sleep deadline', async () => {
    const previousSettings = getSessionSettingsCache()
    setSessionSettingsCache({ settings: {}, errors: [] })
    activateProactive('test')
    const context = {
      abortController: new AbortController(),
      toolUseId: 'sleep-test',
    } as ToolUseContext
    try {
      const sleeping = SleepTool.call(
        { duration: 0.01 },
        context,
        (() => undefined) as never,
        {} as never,
        undefined,
      )
      expect(getNextTickAt()).toBeGreaterThan(Date.now() - 1)
      const result = await sleeping
      expect(result.data.reason).toBe('elapsed')
      expect(getNextTickAt()).toBeNull()
    } finally {
      if (previousSettings) setSessionSettingsCache(previousSettings)
      else resetSettingsCache()
    }
  })
})

describe('KAIROS communication tools', () => {
  test('ship complete non-null contracts', () => {
    for (const tool of [SendUserFileTool, PushNotificationTool, SleepTool]) {
      expect(tool).toBeTruthy()
      expect(tool.name).not.toBe('')
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
      expect(typeof tool.call).toBe('function')
      expect(typeof tool.prompt).toBe('function')
      expect(typeof tool.renderPermissionRequest).toBe('function')
    }
  })

  test('PushNotification truthfully reports transport availability', async () => {
    const sent: Array<{ message: string; notificationType: string }> = []
    const context = {
      sendOSNotification: (value: {
        message: string
        notificationType: string
      }) => sent.push(value),
    } as unknown as ToolUseContext
    const result = await PushNotificationTool.call(
      { message: 'Background work finished' },
      context,
    )
    expect(result.data.delivered).toBe(true)
    expect(sent).toEqual([
      {
        message: 'Background work finished',
        notificationType: 'agent_push',
      },
    ])
  })
})
