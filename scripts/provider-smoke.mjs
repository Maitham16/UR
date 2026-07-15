#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenAICompatibleClient } from '../src/services/api/openaiCompatible.js'
import { createOpenRouterClient } from '../src/services/api/openrouter.js'
import { createStandardAPIClient } from '../src/services/api/standardAPI.js'
import { createOllamaURHQClient } from '../src/services/api/ollama.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const timeoutMs = positiveInt(process.env.PROVIDER_SMOKE_TIMEOUT_MS) ?? 30_000
const maxRetries = positiveInt(process.env.PROVIDER_SMOKE_MAX_RETRIES) ?? 0
const runToolCalls = truthy(process.env.PROVIDER_SMOKE_TOOL_CALLS)
const reportOutput = process.env.PROVIDER_SMOKE_OUTPUT
  ? resolve(process.cwd(), process.env.PROVIDER_SMOKE_OUTPUT)
  : join(root, 'diagnostics', 'provider-smoke', 'latest.json')

const providers = [
  {
    id: 'openai-compatible',
    required: ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL'],
    model: process.env.OPENAI_COMPATIBLE_MODEL,
    endpoint: () => process.env.OPENAI_COMPATIBLE_BASE_URL ?? null,
    toolCallsSupported: true,
    create: () =>
      createOpenAICompatibleClient({
        baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
        maxRetries,
      }),
  },
  {
    id: 'openrouter',
    required: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'],
    model: process.env.OPENROUTER_MODEL,
    endpoint: () => 'https://openrouter.ai/api/v1',
    toolCallsSupported: true,
    create: () =>
      createOpenRouterClient({
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL,
        maxRetries,
      }),
  },
  {
    id: 'anthropic-api',
    required: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    model: process.env.ANTHROPIC_MODEL,
    endpoint: () => process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    toolCallsSupported: true,
    create: () =>
      createStandardAPIClient({
        providerId: 'anthropic-api',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        maxRetries,
      }),
  },
  {
    id: 'gemini-api',
    required: ['GEMINI_API_KEY', 'GEMINI_MODEL'],
    model: process.env.GEMINI_MODEL,
    endpoint: () => process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com',
    toolCallsSupported: true,
    create: () =>
      createStandardAPIClient({
        providerId: 'gemini-api',
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL,
        baseUrl: process.env.GEMINI_BASE_URL,
        maxRetries,
      }),
  },
  {
    id: 'ollama',
    required: ['OLLAMA_MODEL'],
    model: process.env.OLLAMA_MODEL,
    endpoint: () => process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    toolCallsSupported: false,
    create: () =>
      createOllamaURHQClient({
        baseUrlOverride: process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST,
      }),
  },
  {
    id: 'lmstudio',
    required: ['LMSTUDIO_BASE_URL', 'LMSTUDIO_MODEL'],
    model: process.env.LMSTUDIO_MODEL,
    endpoint: () => process.env.LMSTUDIO_BASE_URL ?? null,
    toolCallsSupported: true,
    create: () =>
      createOpenAICompatibleClient({
        baseUrl: process.env.LMSTUDIO_BASE_URL,
        apiKey: process.env.LMSTUDIO_API_KEY,
        maxRetries,
      }),
  },
  {
    id: 'vllm',
    required: ['VLLM_BASE_URL', 'VLLM_MODEL'],
    model: process.env.VLLM_MODEL,
    endpoint: () => process.env.VLLM_BASE_URL ?? null,
    toolCallsSupported: true,
    create: () =>
      createOpenAICompatibleClient({
        baseUrl: process.env.VLLM_BASE_URL,
        apiKey: process.env.VLLM_API_KEY,
        maxRetries,
      }),
  },
]

function positiveInt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ''))
}

function missingEnv(provider) {
  return provider.required.filter(name => !process.env[name])
}

function status(name, state, reason = null, durationMs = null) {
  return { name, status: state, reason, durationMs }
}

function textParams(model, stream = false) {
  return {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 16,
    temperature: 0,
    stream,
  }
}

function toolParams(model) {
  return {
    model,
    messages: [{ role: 'user', content: 'Call ProviderSmokeEcho with text set to ok.' }],
    max_tokens: 64,
    temperature: 0,
    tools: [
      {
        name: 'ProviderSmokeEcho',
        description: 'Echoes a short smoke-test value.',
        input_schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'ProviderSmokeEcho' },
  }
}

async function collectStream(stream) {
  let sawText = false
  let sawStop = false
  for await (const event of stream) {
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      sawText = true
    }
    if (event?.type === 'message_stop') {
      sawStop = true
      break
    }
  }
  return { sawText, sawStop }
}

function hasToolUse(message) {
  return Array.isArray(message?.content) && message.content.some(block => block?.type === 'tool_use')
}

function errorReason(error) {
  return error instanceof Error ? error.message : String(error)
}

async function timedCheck(name, fn) {
  const started = Date.now()
  try {
    await fn()
    return status(name, 'passed', null, Date.now() - started)
  } catch (error) {
    return status(name, 'failed', errorReason(error), Date.now() - started)
  }
}

async function runConfiguredProvider(provider) {
  const client = await provider.create()
  const options = { timeoutMs }
  const checks = []

  const text = await timedCheck('text', async () => {
    await client.beta.messages.create(textParams(provider.model), options)
  })
  checks.push(text)
  if (text.status === 'failed') {
    checks.push(status('streaming', 'skipped', 'text request failed'))
    checks.push(status('tool-call', 'skipped', 'text request failed'))
    return checks
  }

  checks.push(
    await timedCheck('streaming', async () => {
      const streamResponse = await client.beta.messages
        .create(textParams(provider.model, true), options)
        .withResponse()
      const stream = await collectStream(streamResponse.data)
      if (!stream.sawStop) {
        throw new Error('stream did not reach message_stop')
      }
    }),
  )

  if (!runToolCalls) {
    checks.push(status('tool-call', 'skipped', 'set PROVIDER_SMOKE_TOOL_CALLS=1 to enable'))
  } else if (!provider.toolCallsSupported) {
    checks.push(status('tool-call', 'skipped', 'provider smoke does not declare tool-call support'))
  } else {
    checks.push(
      await timedCheck('tool-call', async () => {
        const toolResponse = await client.beta.messages.create(toolParams(provider.model), options)
        if (!hasToolUse(toolResponse)) {
          throw new Error('tool-call check did not return a tool_use block')
        }
      }),
    )
  }

  return checks
}

async function providerReport(provider) {
  const missing = missingEnv(provider)
  const base = {
    provider: provider.id,
    configured: missing.length === 0,
    skipped: missing.length > 0,
    skipReason: missing.length > 0 ? `missing ${missing.join(', ')}` : null,
    model: provider.model ?? null,
    endpoint: provider.endpoint(),
    timeoutMs,
    checks: [],
  }
  if (missing.length > 0) {
    base.checks = [
      status('text', 'skipped', base.skipReason),
      status('streaming', 'skipped', base.skipReason),
      status('tool-call', 'skipped', base.skipReason),
    ]
    return base
  }

  base.checks = await runConfiguredProvider(provider)
  base.skipped = false
  return base
}

async function main() {
  const started = Date.now()
  const providersReport = []
  for (const provider of providers) {
    providersReport.push(await providerReport(provider))
  }

  const failed = providersReport.filter(provider =>
    provider.configured && provider.checks.some(check => check.status === 'failed'),
  )
  const passed = providersReport.filter(
    provider =>
      provider.configured &&
      provider.checks.every(check => check.status === 'passed' || check.status === 'skipped'),
  )
  const skipped = providersReport.filter(provider => !provider.configured)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    timeoutMs,
    maxRetries,
    providers: providersReport,
    summary: {
      passed: passed.length,
      skipped: skipped.length,
      failed: failed.length,
      durationMs: Date.now() - started,
    },
  }

  if (jsonOutput) {
    mkdirSync(dirname(reportOutput), { recursive: true })
    writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    console.error(`Wrote provider smoke JSON: ${reportOutput}`)
  } else {
    for (const provider of providersReport) {
      const detail = provider.skipReason ? ` - ${provider.skipReason}` : ''
      const providerStatus =
        provider.configured && provider.checks.some(check => check.status === 'failed')
          ? 'failed'
          : provider.configured
            ? 'passed'
            : 'skipped'
      console.log(`${provider.provider}: ${providerStatus}${detail}`)
      if (provider.configured) {
        for (const check of provider.checks) {
          const reason = check.reason ? ` (${check.reason})` : ''
          console.log(`  ${check.name}: ${check.status}${reason}`)
        }
      }
    }
    console.log(
      `Provider smoke summary: ${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed`,
    )
  }

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
