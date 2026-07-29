import { describe, expect, test } from 'bun:test'
import {
  buildScheduleRemoteAgentsPrompt,
  MULTI_WORKER_SCHEDULE_GUIDANCE,
  taggedIdToUUID,
} from '../src/skills/bundled/scheduleRemoteAgents.js'

describe('remote-agent MCP server IDs', () => {
  test('decodes a versioned base58 identifier into a UUID', () => {
    expect(taggedIdToUUID('mcpsrv_011')).toBe(
      '00000000-0000-0000-0000-000000000000',
    )
    expect(taggedIdToUUID('mcpsrv_012')).toBe(
      '00000000-0000-0000-0000-000000000001',
    )
  })

  test('rejects malformed versions, payloads, and values wider than a UUID', () => {
    expect(taggedIdToUUID('other_011')).toBeNull()
    expect(taggedIdToUUID('mcpsrv_')).toBeNull()
    expect(taggedIdToUUID('mcpsrv_01')).toBeNull()
    expect(taggedIdToUUID('mcpsrv_021')).toBeNull()
    expect(taggedIdToUUID('mcpsrv_010')).toBeNull()
    expect(taggedIdToUUID(`mcpsrv_01${'z'.repeat(40)}`)).toBeNull()
  })
})

describe('/schedule multi-worker prompt safety', () => {
  const prompt = buildScheduleRemoteAgentsPrompt({
    userTimezone: 'Europe/Vienna',
    connectorsInfo: 'No connected MCP connectors found.',
    gitRepoUrl: 'https://github.com/acme/widgets',
    environmentsInfo: 'Available environments:\n- default (id: env-1, kind: cloud)',
    createdEnvironment: null,
    setupNotes: [],
    needsGitHubAccessReminder: false,
    userArgs: 'schedule a multi-worker repository audit',
  })

  test('distinguishes recurring trigger fires from in-session workers', () => {
    expect(prompt).toContain(MULTI_WORKER_SCHEDULE_GUIDANCE)
    expect(prompt).toContain(
      'A cron trigger starts one isolated remote session per fire.',
    )
    expect(prompt).toContain(
      'It does not itself coordinate child workers or prevent two cron fires from overlapping.',
    )
    expect(prompt).toContain(
      'Only when the user explicitly wants one scheduled run to delegate independent tasks',
    )
  })

  test('dispatches only dependency-ready independent tasks without duplicate attempts', () => {
    expect(prompt).toContain('stable `task_id` values')
    expect(prompt).toContain('explicit `depends_on` task IDs')
    expect(prompt).toContain(
      'only while pending, after every dependency succeeded and its retry backoff elapsed',
    )
    expect(prompt).toContain('Run only eligible independent tasks concurrently.')
    expect(prompt).toContain('Allow exactly one live attempt per task')
    expect(prompt).toContain(
      'never start a replacement until the previous worker is confirmed terminal',
    )
    expect(prompt).toContain('its own branch and worktree')
    expect(prompt).toContain('Serialize integration and verification.')
  })

  test('uses finite retries and stops on ambiguous mutations or cancellation', () => {
    expect(prompt).toContain('`max_workers: 3`')
    expect(prompt).toContain('`max_attempts_per_task: 2`')
    expect(prompt).toContain('`retry_backoff_seconds: [10]`')
    expect(prompt).toContain('`deadline_minutes: 25`')
    expect(prompt).toContain(
      'Never auto-retry an unknown outcome after a mutation, commit, push, PR, message, or external API call',
    )
    expect(prompt).toContain('mark it `needs_reconciliation`')
    expect(prompt).toContain(
      'Cancellation or deadline stops dispatch, cancels running workers where supported',
    )
    expect(prompt).toContain('do not respawn indefinitely')
    expect(prompt).toContain('require a durable run lease or target-system idempotency key')
  })
})
