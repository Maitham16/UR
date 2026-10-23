import { afterEach, expect, test } from 'bun:test'
import * as React from 'react'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { render } from '../src/ink.js'
import { ModelSpeedControl } from '../src/components/ModelSpeedControl.js'
import { ModelThinkingBudgetControl } from '../src/components/ModelThinkingBudgetControl.js'
import { executeThinking, executeThinkingBudget } from '../src/commands/thinking/thinking.js'
import { executeEffort } from '../src/commands/effort/effort.js'
import { applyNativeFastMode } from '../src/commands/fast/fast.js'
import { cacheProviderModelsForProvider, clearProviderModelCacheForTests, getActiveProviderSettings, getProviderReasoningCapabilitiesForModel, setProviderModel } from '../src/services/providers/providerRegistry.js'
import { getModelPerformanceOptions, getSavedModelPerformanceMode, type ModelPerformanceMode } from '../src/services/providers/modelPerformance.js'
import { getSupportedEffortLevelsForModel, getProviderEffortWireValue, getEffortSuffix } from '../src/utils/effort.js'
import { isThinkingMandatory } from '../src/utils/thinking.js'
import { getInitialSettings, updateSettingsForSource } from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'
import { resetStateForTests, setAllowedSettingSources, setCwdState, setOriginalCwd } from '../src/bootstrap/state.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'

const previousConfig = process.env.UR_CONFIG_DIR
let directory: string | undefined
afterEach(() => {
  clearProviderModelCacheForTests(); resetStateForTests(); resetSettingsCache()
  if (previousConfig === undefined) delete process.env.UR_CONFIG_DIR; else process.env.UR_CONFIG_DIR = previousConfig
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})
function workspace() {
  directory = mkdtempSync(join(tmpdir(), 'ur-provider-controls-'))
  process.env.UR_CONFIG_DIR = join(directory, 'config'); mkdirSync(process.env.UR_CONFIG_DIR)
  resetStateForTests(); setCwdState(directory); setOriginalCwd(directory)
  setAllowedSettingSources(['userSettings', 'localSettings']); resetSettingsCache()
  updateSettingsForSource('localSettings', { provider: { active: 'gemini-api', model: 'gemini-2.5-pro',
    baseUrls: { 'gemini-api': 'https://fixture.invalid/v1beta' }, anthropic: { workspaceId: 'wrkspc_01Fixture' }, openrouter: { allowFallbacks: false } } })
}

test('current models and thin cached names retain exact native controls', () => {
  workspace()
  cacheProviderModelsForProvider('openai-api', ['gpt-6.1-sol'])
  cacheProviderModelsForProvider('gemini-api', ['gemini-3.8-flash'])
  expect(getSupportedEffortLevelsForModel('gpt-6.1-sol', 'openai-api')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  expect(isThinkingMandatory('gpt-6.1-sol', 'openai-api')).toBe(true)
  expect(getSupportedEffortLevelsForModel('gpt-5.5', 'openai-api')).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'ultra'])
  expect(getProviderReasoningCapabilitiesForModel('gpt-5.4-2026-03-05', 'openai-api')?.defaultEffort).toBe('none')
  expect(getModelPerformanceOptions('openai-api', 'gpt-5.5-pro').map(option => option.value)).toEqual(['auto', 'standard', 'flex'])
  expect(getProviderReasoningCapabilitiesForModel('gpt-5.5-pro', 'openai-api')?.defaultEffort).toBe('high')
  expect(getSupportedEffortLevelsForModel('gpt-6-luna', 'openai-api')).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  expect(getSupportedEffortLevelsForModel('gemini-3.8-flash', 'gemini-api')).toEqual(['low', 'medium', 'high'])
  expect(isThinkingMandatory('gemini-3.8-flash', 'gemini-api')).toBe(true)
  expect(getSupportedEffortLevelsForModel('gemini-2.5-pro', 'gemini-api')).toEqual([])
  expect(getProviderReasoningCapabilitiesForModel('gemini-2.5-pro', 'gemini-api')?.thinkingBudget).toEqual({ min: 128, max: 32768, dynamic: true, canDisable: false })
})

test('explicit live negatives and newly advertised off modes override documented fallbacks', () => {
  workspace()
  cacheProviderModelsForProvider('openai-api', [{ id: 'gpt-6.1-sol', displayName: 'fixture', description: '', reasoning: { supportsThinking: false } }])
  expect(getSupportedEffortLevelsForModel('gpt-6.1-sol', 'openai-api')).toEqual([])
  expect(isThinkingMandatory('gpt-6.1-sol', 'openai-api')).toBe(false)
  cacheProviderModelsForProvider('gemini-api', [{ id: 'gemini-3.8-flash', displayName: 'fixture', description: '', reasoning: { supportedEfforts: ['none', 'low'] } }])
  expect(getSupportedEffortLevelsForModel('gemini-3.8-flash', 'gemini-api')).toEqual(['none', 'low'])
  expect(isThinkingMandatory('gemini-3.8-flash', 'gemini-api')).toBe(false)
})

test('NVIDIA effort ladders and defaults come from each published request schema', () => {
  expect(getSupportedEffortLevelsForModel('nvidia/nemotron-3-ultra-550b-a55b', 'nvidia-nim')).toEqual(['none', 'medium', 'high'])
  expect(getSupportedEffortLevelsForModel('deepseek-ai/deepseek-v4-pro-0813', 'nvidia-nim')).toEqual(['none', 'high', 'max', 'ultra'])
  expect(getProviderReasoningCapabilitiesForModel('deepseek-ai/deepseek-v4-pro-0813', 'nvidia-nim')?.defaultEffort).toBe('none')
  expect(getProviderReasoningCapabilitiesForModel('moonshotai/kimi-k3', 'nvidia-nim')?.defaultEffort).toBe('max')
  expect(isThinkingMandatory('openai/gpt-oss-120b', 'nvidia-nim')).toBe(true)
  expect(getProviderReasoningCapabilitiesForModel('google/gemma-4-31b-it', 'nvidia-nim')?.thinkingValues).toEqual([false, true])
})

test('/thinking maps to native effort none without changing a global boolean preference', () => {
  workspace()
  const off = executeThinking('off', true, 'gpt-6-luna', 'openai-api', 'high')
  expect(off.message).toContain('OFF via native effort none')
  expect(off.effortUpdate?.value).toBe('none')
  expect(getInitialSettings().effortLevel).toBe('none')
  expect(getInitialSettings().alwaysThinkingEnabled).toBeUndefined()
  expect(executeThinking('status', true, 'gpt-6-luna', 'openai-api', 'none').message).toContain('Thinking: OFF')
  expect(executeThinking('on', false, 'gpt-6-luna', 'openai-api', 'none').effortUpdate?.value).toBe('medium')
  const before = JSON.stringify(getInitialSettings())
  expect(executeThinking('off', false, 'gpt-6.1-sol', 'openai-api').message).toContain('always ON')
  expect(executeEffort('none', 'gpt-6.1-sol', 'openai-api').effortUpdate).toBeUndefined()
  expect(JSON.stringify(getInitialSettings())).toBe(before)
})

test('token budgets are model-scoped, validated, removable, and report the effective off state', () => {
  workspace()
  expect(executeThinkingBudget('8192', 'gemini-2.5-pro', 'gemini-api').providerUpdate).toBeDefined()
  expect(executeThinkingBudget('0', 'gemini-2.5-flash', 'gemini-api').providerUpdate).toBeDefined()
  expect(getActiveProviderSettings().thinkingBudgets?.['gemini-api']).toMatchObject({ 'gemini-2.5-pro': 8192, 'gemini-2.5-flash': 0 })
  expect(executeThinking('status', true, 'gemini-2.5-flash', 'gemini-api').message).toContain('Thinking: OFF')
  const before = JSON.stringify(getInitialSettings())
  expect(executeThinkingBudget('0', 'gemini-2.5-pro', 'gemini-api').message).toContain('Not applied')
  expect(executeThinkingBudget('32769', 'gemini-2.5-pro', 'gemini-api').message).toContain('Not applied')
  expect(JSON.stringify(getInitialSettings())).toBe(before)
  expect(executeThinkingBudget('default', 'gemini-2.5-pro', 'gemini-api').providerUpdate).toBeDefined()
  expect(getActiveProviderSettings().thinkingBudgets?.['gemini-api']?.['gemini-2.5-pro']).toBeUndefined()
  expect(getActiveProviderSettings().thinkingBudgets?.['gemini-api']?.['gemini-2.5-flash']).toBe(0)
  expect(executeThinkingBudget('auto', 'gemini-2.5-pro', 'gemini-api').message).toContain('AUTO')
  expect(getActiveProviderSettings().thinkingBudgets?.['gemini-api']?.['gemini-2.5-pro']).toBe(-1)
  cacheProviderModelsForProvider('openrouter', [{ id: 'fixture-mixed-budget', displayName: 'fixture', description: '', reasoning: { supportsThinking: true, supportedEfforts: ['none', 'low', 'high'], supportsMaxTokens: true } }])
  expect(executeEffort('none', 'fixture-mixed-budget', 'openrouter').effortUpdate).toBeDefined()
  expect(executeThinkingBudget('4096', 'fixture-mixed-budget', 'openrouter').providerUpdate).toBeDefined()
  expect(executeThinking('status', false, 'fixture-mixed-budget', 'openrouter', 'none').message).toContain('Thinking: ON')
  expect(getEffortSuffix('fixture-mixed-budget', 'none', 'openrouter')).toBe('')
})

test('model, serving tier, and budget confirmation saves together and rejects partial invalid changes', () => {
  workspace()
  expect(setProviderModel('gemini-api', 'gemini-2.5-pro', { performanceMode: 'priority', thinkingBudget: 4096 }).ok).toBe(true)
  expect(getActiveProviderSettings()).toMatchObject({ active: 'gemini-api', model: 'gemini-2.5-pro', gemini: { serviceTier: 'priority' },
    anthropic: { workspaceId: 'wrkspc_01Fixture' }, baseUrls: { 'gemini-api': 'https://fixture.invalid/v1beta' } })
  const before = JSON.stringify(getInitialSettings())
  expect(setProviderModel('gemini-api', 'gemini-2.5-flash', { performanceMode: 'priority', thinkingBudget: 999999 }).ok).toBe(false)
  expect(JSON.stringify(getInitialSettings())).toBe(before)
  expect(getModelPerformanceOptions('ollama', 'qwen3')).toEqual([])
  expect(getModelPerformanceOptions('nvidia-nim', 'moonshotai/kimi-k3')).toEqual([])
})

test('/fast changes a native tier or routing preference while preserving the model', () => {
  workspace()
  let state = { ...getDefaultAppState(), provider: { ...getActiveProviderSettings(), active: 'openai-api' as const }, mainLoopModel: 'gpt-6.1-sol' }
  const context = { getAppState: () => state, setAppState: (update: (previous: typeof state) => typeof state) => { state = update(state) } }
  expect(applyNativeFastMode(true, context as never)).toContain('FAST')
  expect(state.mainLoopModel).toBe('gpt-6.1-sol')
  expect(getActiveProviderSettings().openai?.serviceTier).toBe('fast')
  expect(getSavedModelPerformanceMode('openai-api', state.mainLoopModel, getActiveProviderSettings())).toBe('fast')
  const router = { ...state, provider: { ...state.provider, active: 'openrouter' as const }, mainLoopModel: 'moonshotai/kimi-k3' }
  let routed = router
  expect(applyNativeFastMode(true, { getAppState: () => routed, setAppState: update => { routed = update(routed as never) as typeof router } } as never)).toContain('LOW LATENCY')
  expect(getActiveProviderSettings().openrouter).toMatchObject({ routing: 'latency', allowFallbacks: false, speed: 'standard', serviceTier: 'auto' })
  expect(routed.mainLoopModel).toBe('moonshotai/kimi-k3')
})

async function keyboardProbe(component: (changed: (value: unknown) => void) => React.ReactNode, keys: string[]): Promise<unknown[]> {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void }
  input.isTTY = true; input.setRawMode = () => {}; input.ref = () => {}; input.unref = () => {}
  const output = new PassThrough(), changes: unknown[] = []
  const instance = await render(component(value => changes.push(value)), { stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false })
  try { for (const key of keys) { await new Promise(resolve => setTimeout(resolve, 35)); input.write(key) }; await new Promise(resolve => setTimeout(resolve, 35)); return changes }
  finally { instance.unmount(); input.destroy(); output.destroy() }
}

test('real keyboard input previews speed and budget choices without persisting before confirmation', async () => {
  workspace()
  const before = JSON.stringify(getInitialSettings())
  function Speed({ changed }: { changed: (value: unknown) => void }) {
    const [mode, setMode] = React.useState<ModelPerformanceMode>('standard')
    return <ModelSpeedControl provider="openai-api" model="gpt-6.1-sol" value={mode} onChange={value => { changed(value); setMode(value) }} />
  }
  expect(await keyboardProbe(changed => <Speed changed={changed} />, ['s', 's', 's'])).toEqual(['fast', 'ultrafast', 'flex'])
  function Budget({ changed }: { changed: (value: unknown) => void }) {
    const [value, setValue] = React.useState<number>()
    return <ModelThinkingBudgetControl provider="gemini-api" capabilities={getProviderReasoningCapabilitiesForModel('gemini-2.5-pro', 'gemini-api')}
      value={value} onChange={next => { changed(next); setValue(next === 'default' ? undefined : next) }} />
  }
  expect(await keyboardProbe(changed => <Budget changed={changed} />, ['b', 'b', 'b'])).toEqual([-1, 128, 32768])
  expect(JSON.stringify(getInitialSettings())).toBe(before)
})


test('provider-defined effort names persist and unknown names never replace them', () => {
  workspace()
  cacheProviderModelsForProvider('vllm', [{ id: 'custom-native-model', displayName: 'custom', description: '',
    reasoning: { supportsThinking: true, supportedEfforts: ['Brief', 'Deep'], defaultEffort: 'Deep' } }])
  expect(executeEffort('Deep', 'custom-native-model', 'vllm').effortUpdate?.value).toBe('deep')
  expect(getInitialSettings().effortLevel).toBe('deep')
  expect(getProviderEffortWireValue('custom-native-model', 'DEEP', 'vllm')).toBe('Deep')
  expect(executeEffort('max', 'custom-native-model', 'vllm').effortUpdate).toBeUndefined()
  expect(executeEffort('low', 'custom-native-model', 'vllm').effortUpdate).toBeUndefined()
  expect(executeEffort('invented', 'custom-native-model', 'vllm').effortUpdate).toBeUndefined()
  expect(getInitialSettings().effortLevel).toBe('deep')
})
