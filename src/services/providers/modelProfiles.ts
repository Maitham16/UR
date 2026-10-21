import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProviderMessage, ProviderMessageClient } from '../api/providerClient.js'

export type CapabilityObservation = {
  status: 'verified' | 'failed' | 'unobserved'
  detail: string
  durationMs: number
}
export type ModelProfile = {
  schemaVersion: 1
  provider: string
  model: string
  endpoint: string
  measuredAt: string
  contextWindow?: { tokens: number; source: 'provider-advertised' }
  checks: Record<'tools' | 'structuredOutput' | 'continuation' | 'streamCancellation', CapabilityObservation>
  usage: { inputTokens: number; outputTokens: number; requests: number }
  defaults: { toolCatalog: 'auto'; structuredOutput: 'native' | 'validate-text'; contextWindow?: number }
}

/** A fingerprint may identify an endpoint, never credentials or query secrets. */
export function profileEndpoint(endpoint: string): string {
  try { const url = new URL(endpoint); return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}` } catch { return 'configured-provider' }
}

function profilePath(root: string, provider: string, model: string, endpoint: string): string {
  const key = createHash('sha256').update(JSON.stringify([provider, model, profileEndpoint(endpoint)])).digest('hex')
  return join(root, '.ur', 'model-profiles', `${key}.json`)
}

export async function saveModelProfile(root: string, profile: ModelProfile): Promise<void> {
  const path = profilePath(root, profile.provider, profile.model, profile.endpoint)
  await mkdir(join(root, '.ur', 'model-profiles'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(profile, null, 2), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

export async function loadModelProfile(root: string, provider: string, model: string, endpoint: string): Promise<(ModelProfile & { stale: boolean }) | null> {
  try {
    const profile = JSON.parse(await readFile(profilePath(root, provider, model, endpoint), 'utf8')) as ModelProfile
    if (profile.schemaVersion !== 1 || profile.provider !== provider || profile.model !== model || profile.endpoint !== profileEndpoint(endpoint) || !profile.checks) return null
    return { ...profile, stale: !Number.isFinite(Date.parse(profile.measuredAt)) || Date.now() - Date.parse(profile.measuredAt) > 7 * 86400_000 }
  } catch { return null }
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  return Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('') : ''
}

/** Real, deliberately small model calls. No tools execute and no user files are sent. */
export async function probeModelProfile(options: {
  provider: string; model: string; endpoint: string; client: ProviderMessageClient
  signal?: AbortSignal; timeoutMs?: number; contextWindow?: number
}): Promise<ModelProfile> {
  const usage = { inputTokens: 0, outputTokens: 0, requests: 0 }
  const timeout = options.timeoutMs ?? 60_000
  const base = { model: options.model, max_tokens: 128, stream: false }
  const send = async (request: Record<string, unknown>, signal: AbortSignal) => {
    usage.requests++
    const response = await options.client.beta.messages.create({ ...base, ...request }, { signal })
    const counts = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
    usage.inputTokens += Math.max(0, counts?.input_tokens ?? 0)
    usage.outputTokens += Math.max(0, counts?.output_tokens ?? 0)
    return response as ProviderMessage
  }
  const observe = async (check: (signal: AbortSignal) => Promise<{ status?: CapabilityObservation['status']; detail: string }>): Promise<CapabilityObservation> => {
    options.signal?.throwIfAborted()
    const started = performance.now()
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeout)])
    let onAbort: () => void = () => {}
    const deadline = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Capability probe aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
    try {
      const result = await Promise.race([check(signal), deadline])
      return { status: result.status ?? 'verified', detail: result.detail, durationMs: performance.now() - started }
    } catch (error) {
      options.signal?.throwIfAborted()
      return { status: 'failed', detail: error instanceof Error ? error.message : String(error), durationMs: performance.now() - started }
    } finally { signal.removeEventListener('abort', onAbort) }
  }
  const tools = await observe(async signal => {
    const instruction = 'Call capability_echo exactly once with value "ur-profile-probe" and count 2. After its result, repeat the echoed value in plain text.'
    const response = await send({
      messages: [{ role: 'user', content: instruction }],
      tools: [{ name: 'capability_echo', description: 'Return typed capability test data; this probe never executes tools.', input_schema: { type: 'object', properties: { value: { type: 'string' }, count: { type: 'integer' } }, required: ['value', 'count'], additionalProperties: false } }],
      tool_choice: { type: 'tool', name: 'capability_echo' },
    }, signal)
    const calls = Array.isArray(response.content) ? response.content.filter((block: { type?: string }) => block.type === 'tool_use') : []
    if (calls.length !== 1 || typeof calls[0].id !== 'string' || calls[0].name !== 'capability_echo' || calls[0].input?.value !== 'ur-profile-probe' || calls[0].input?.count !== 2) throw new Error('Expected one correctly typed capability_echo tool call; provider/model did not produce it')
    const continued = await send({ messages: [
      { role: 'user', content: instruction },
      { role: 'assistant', content: response.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: calls[0].id, content: JSON.stringify(calls[0].input) }] },
    ] }, signal)
    if (!textOf(continued).includes('ur-profile-probe')) throw new Error('Provider/model did not complete the typed tool-result round trip')
    return { detail: 'One typed tool call and its echoed tool-result round trip succeeded; no filesystem or external tool was executed' }
  })
  const structuredOutput = await observe(async signal => {
    const response = await send({
      messages: [{ role: 'user', content: 'Return exactly {"ready":true,"count":2} as JSON.' }],
      output_format: { type: 'json_schema', schema: { type: 'object', properties: { ready: { type: 'boolean' }, count: { type: 'integer' } }, required: ['ready', 'count'], additionalProperties: false } },
    }, signal)
    const value = JSON.parse(textOf(response))
    if (value?.ready !== true || value.count !== 2 || Object.keys(value).length !== 2) throw new Error('Structured-output response failed the requested schema and values')
    return { detail: 'Requested JSON schema returned exact boolean/integer values; one sample is not a general correctness guarantee' }
  })
  const continuation = await observe(async signal => {
    const instruction = 'Count from 1 to 200, one integer per line. Begin immediately, no explanation.'
    const first = await send({ max_tokens: 16, messages: [{ role: 'user', content: instruction }] }, signal)
    const partial = textOf(first)
    if (first.stop_reason !== 'max_tokens') return { status: 'unobserved', detail: `Provider did not expose an output boundary in this sample (stop=${String(first.stop_reason)})` }
    if (!partial.trim()) return { status: 'unobserved', detail: 'Output boundary reached before visible text; continuation progress could not be measured' }
    const next = await send({ max_tokens: 32, messages: [{ role: 'user', content: instruction }, { role: 'assistant', content: partial }, { role: 'user', content: 'Continue with the next integer; do not repeat earlier numbers.' }] }, signal)
    const priorNumbers = partial.match(/\b\d+\b/g)?.map(Number) ?? []
    const nextNumbers = textOf(next).match(/\b\d+\b/g)?.map(Number) ?? []
    if (!priorNumbers.length || !nextNumbers.length || nextNumbers[0]! <= Math.max(...priorNumbers)) throw new Error('Continuation did not advance beyond the prior visible numeric sequence')
    return { detail: 'Observed max_tokens and a subsequent response with novel numeric progress' }
  })
  const streamCancellation = await observe(async signal => {
    const cancellation = new AbortController()
    const combined = AbortSignal.any([signal, cancellation.signal])
    usage.requests++
    const response = await options.client.beta.messages.create({ ...base, stream: true, max_tokens: 256, messages: [{ role: 'user', content: 'Count slowly from 1 to 1000, one integer per line.' }] }, { signal: combined })
    if (!response || typeof response.withResponse !== 'function') throw new Error('Provider returned no streaming response handle')
    const envelope = await response.withResponse() as { data?: AsyncIterable<{ type?: string }>; controller?: AbortController }
    const data = envelope?.data
    if (!data || typeof data[Symbol.asyncIterator] !== 'function') throw new Error('Provider returned no async event stream')
    let observed = false
    try {
      for await (const event of data) {
        if (event.type === 'content_block_delta') {
          observed = true
          cancellation.abort()
          if ('controller' in response && response.controller instanceof AbortController) response.controller.abort()
          break // closes the adapter iterator and its HTTP reader
        }
      }
    } catch (error) { if (!observed) throw error }
    if (!observed) return { status: 'unobserved', detail: 'Stream ended without a content delta; active cancellation was not exercised' }
    return { detail: 'Received a content delta, aborted the active request, and closed its iterator; provider-side billing/compute cancellation is not observable' }
  })
  const contextWindow = Number.isFinite(options.contextWindow) && options.contextWindow! > 0 ? options.contextWindow : undefined
  return {
    schemaVersion: 1, provider: options.provider, model: options.model, endpoint: profileEndpoint(options.endpoint), measuredAt: new Date().toISOString(),
    ...(contextWindow ? { contextWindow: { tokens: contextWindow, source: 'provider-advertised' as const } } : {}),
    checks: { tools, structuredOutput, continuation, streamCancellation }, usage,
    defaults: { toolCatalog: 'auto', structuredOutput: structuredOutput.status === 'verified' ? 'native' : 'validate-text', ...(contextWindow ? { contextWindow } : {}) },
  }
}
