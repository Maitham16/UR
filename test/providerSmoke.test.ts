import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')

describe('provider smoke command', () => {
  test('skips cleanly when live provider env vars are absent', () => {
    const env = { ...process.env }
    for (const name of [
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_MODEL',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'OLLAMA_MODEL',
      'LMSTUDIO_BASE_URL',
      'LMSTUDIO_MODEL',
      'VLLM_BASE_URL',
      'VLLM_MODEL',
    ]) {
      delete env[name]
    }

    const result = spawnSync('bun', ['run', 'provider:smoke'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Provider smoke summary: 0 passed, 7 skipped, 0 failed')
  })

  test('writes JSON skip report without credentials', () => {
    const env = { ...process.env }
    const outputDirectory = mkdtempSync(join(tmpdir(), 'ur-provider-smoke-'))
    const output = join(outputDirectory, 'latest.json')
    env.PROVIDER_SMOKE_OUTPUT = output
    for (const name of [
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_MODEL',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'OLLAMA_MODEL',
      'LMSTUDIO_BASE_URL',
      'LMSTUDIO_MODEL',
      'VLLM_BASE_URL',
      'VLLM_MODEL',
    ]) {
      delete env[name]
    }

    try {
      const result = spawnSync('bun', ['run', 'provider:smoke', '--', '--json'], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.summary).toMatchObject({ passed: 0, skipped: 7, failed: 0 })
      expect(parsed.providers[0]).toMatchObject({
        provider: 'openai-compatible',
        configured: false,
        skipped: true,
      })
      expect(existsSync(output)).toBe(true)
      expect(JSON.parse(readFileSync(output, 'utf8')).summary.skipped).toBe(7)
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })

  test('configured provider failure exits non-zero without requiring real credentials', () => {
    const env = { ...process.env }
    const outputDirectory = mkdtempSync(join(tmpdir(), 'ur-provider-smoke-'))
    env.PROVIDER_SMOKE_OUTPUT = join(outputDirectory, 'latest.json')
    for (const name of [
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'OLLAMA_MODEL',
      'LMSTUDIO_BASE_URL',
      'LMSTUDIO_MODEL',
      'VLLM_BASE_URL',
      'VLLM_MODEL',
    ]) {
      delete env[name]
    }
    env.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:9'
    env.OPENAI_COMPATIBLE_MODEL = 'provider-smoke-test'
    env.PROVIDER_SMOKE_TIMEOUT_MS = '250'

    try {
      const result = spawnSync('bun', ['run', 'provider:smoke', '--', '--json'], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
      })

      expect(result.status).toBe(1)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.summary.failed).toBe(1)
      expect(parsed.providers[0].configured).toBe(true)
      expect(parsed.providers[0].checks[0].status).toBe('failed')
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })
})
