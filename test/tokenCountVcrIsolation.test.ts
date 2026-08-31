import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTokenCountVCR } from '../src/services/vcr.js'

let fixtureRoot = ''
let previousFixtureRoot: string | undefined
let previousVcrRecord: string | undefined

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'ur-token-vcr-'))
  previousFixtureRoot = process.env.UR_CODE_TEST_FIXTURES_ROOT
  previousVcrRecord = process.env.VCR_RECORD
  process.env.UR_CODE_TEST_FIXTURES_ROOT = fixtureRoot
  process.env.VCR_RECORD = '1'
})

afterEach(async () => {
  if (previousFixtureRoot === undefined) {
    delete process.env.UR_CODE_TEST_FIXTURES_ROOT
  } else {
    process.env.UR_CODE_TEST_FIXTURES_ROOT = previousFixtureRoot
  }
  if (previousVcrRecord === undefined) delete process.env.VCR_RECORD
  else process.env.VCR_RECORD = previousVcrRecord
  await rm(fixtureRoot, { recursive: true, force: true })
})

describe('token-count VCR provider isolation', () => {
  test('same payload cannot reuse a fixture from another runtime identity', async () => {
    const messages = [{ role: 'user', content: 'same request' }]
    const tools = [{ name: 'same-tool' }]
    let executions = 0

    const ollama = await withTokenCountVCR(
      messages,
      tools,
      {
        provider: 'ollama',
        model: 'qwen3:latest',
        endpoint: 'http://localhost:11434',
        countMode: 'ollama',
      },
      async () => {
        executions++
        return 11
      },
    )
    const openai = await withTokenCountVCR(
      messages,
      tools,
      {
        provider: 'openai-api',
        model: 'gpt-5.6-sol',
        endpoint: 'https://api.openai.com/v1',
        countMode: 'openai',
      },
      async () => {
        executions++
        return 22
      },
    )
    const ollamaReplay = await withTokenCountVCR(
      messages,
      tools,
      {
        provider: 'ollama',
        model: 'qwen3:latest',
        endpoint: 'http://localhost:11434',
        countMode: 'ollama',
      },
      async () => {
        executions++
        return 99
      },
    )

    expect({ ollama, openai, ollamaReplay }).toEqual({
      ollama: 11,
      openai: 22,
      ollamaReplay: 11,
    })
    expect(executions).toBe(2)
    expect(await readdir(join(fixtureRoot, 'fixtures'))).toHaveLength(2)
  })
})
