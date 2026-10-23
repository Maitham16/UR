import { afterEach, expect, test } from 'bun:test'
import * as React from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { render } from '../src/ink.js'
import { ModelSpeedControl } from '../src/components/ModelSpeedControl.js'
import { parseDiscoveredModels } from '../src/services/providers/modelCatalog.js'
import { cacheProviderModelsForProvider, clearProviderModelCacheForTests, getActiveProviderSettings, getProviderReasoningCapabilitiesForModel, setProviderModel } from '../src/services/providers/providerRegistry.js'
import { getSupportedEffortLevelsForModel, getProviderEffortWireValue } from '../src/utils/effort.js'
import { getThinkingOffMode, isThinkingMandatory, modelSupportsThinking, providerSupportsThinkingToggle } from '../src/utils/thinking.js'
import { executeThinking } from '../src/commands/thinking/thinking.js'
import { applyNativeFastMode } from '../src/commands/fast/fast.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { resetStateForTests, setAllowedSettingSources, setCwdState, setOriginalCwd } from '../src/bootstrap/state.js'
import { getInitialSettings, updateSettingsForSource } from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

let directory: string | undefined
afterEach(() => {
  clearProviderModelCacheForTests()
  resetStateForTests(); resetSettingsCache()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

function workspace() {
  directory = mkdtempSync(join(tmpdir(), 'ur-model-controls-'))
  resetStateForTests(); setCwdState(directory); setOriginalCwd(directory)
  setAllowedSettingSources(['localSettings']); resetSettingsCache()
  updateSettingsForSource('localSettings', { provider: { active: 'anthropic-api', model: 'claude-opus-5-5',
    baseUrls: { 'anthropic-api': 'https://contract.invalid/v1' },
    anthropic: { workspaceId: 'wrkspc_01Fixture', speed: 'standard' } } })
}

test('native live capability fields expose exact future-model levels and accepted thinking modes', () => {
  const [model] = parseDiscoveredModels({ data: [{ id: 'future-claude', max_input_tokens: 123000, max_tokens: 8192,
    capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: false }, high: { supported: true } },
      thinking: { supported: true, types: { adaptive: { supported: true }, disabled: { supported: false } } } } }] }, 'Claude API')
  expect(model?.reasoning).toMatchObject({ supportsThinking: true, supportedEfforts: ['low', 'high'], thinkingTypes: ['adaptive'], mandatory: true })
  expect(model?.outputTokenLimit).toBe(8192)
  expect(model?.contextLength).toBe(123000)
  workspace()
  cacheProviderModelsForProvider('anthropic-api', [{ ...model!, description: 'fixture' }])
  expect(getSupportedEffortLevelsForModel('future-claude', 'anthropic-api')).toEqual(['low', 'high'])
  expect(providerSupportsThinkingToggle('anthropic-api', 'future-claude')).toBe(false)
})

test('thin cached rows retain documented controls and explicit negative metadata wins', () => {
  workspace()
  cacheProviderModelsForProvider('anthropic-api', ['claude-opus-5-5'])
  expect(modelSupportsThinking('claude-opus-5-5', 'anthropic-api')).toBe(true)
  expect(getSupportedEffortLevelsForModel('claude-opus-5-5', 'anthropic-api')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  expect(getProviderEffortWireValue('claude-opus-5-5', 'xhigh', 'anthropic-api')).toBe('xhigh')
  expect(getProviderReasoningCapabilitiesForModel('claude-opus-5-5', 'anthropic-api')?.defaultEffort).toBe('medium')
  cacheProviderModelsForProvider('anthropic-api', [{ id: 'claude-opus-5-5', displayName: 'overridden', description: 'fixture', reasoning: { supportsThinking: false, supportedEfforts: [], mandatory: false, thinkingTypes: [] } }])
  expect(modelSupportsThinking('claude-opus-5-5', 'anthropic-api')).toBe(false)
  expect(getSupportedEffortLevelsForModel('claude-opus-5-5', 'anthropic-api')).toEqual([])
})

test('mandatory thinking never saves a false preference and Sonnet uses its accepted off mode', () => {
  workspace()
  const before = JSON.stringify(getInitialSettings())
  const result = executeThinking('off', false, 'claude-opus-5-5', 'anthropic-api')
  expect(result.message).toContain('always ON')
  expect(result.message).toContain('/effort')
  expect(result.thinkingUpdate).toBeUndefined()
  expect(JSON.stringify(getInitialSettings())).toBe(before)
  expect(isThinkingMandatory('claude-fable-5-1', 'anthropic-api')).toBe(true)
  expect(getThinkingOffMode('claude-sonnet-5-5', 'anthropic-api')).toBe('between_tools')
  expect(getThinkingOffMode('claude-haiku-5-5', 'anthropic-api')).toBe('disabled')
})

test('confirmed speed is saved atomically with model and preserves workspace and endpoint', () => {
  workspace()
  expect(setProviderModel('anthropic-api', 'claude-opus-5-5', { performanceMode: 'fast' }).ok).toBe(true)
  expect(getActiveProviderSettings()).toMatchObject({ active: 'anthropic-api', model: 'claude-opus-5-5',
    baseUrls: { 'anthropic-api': 'https://contract.invalid/v1' }, anthropic: { speed: 'fast', workspaceId: 'wrkspc_01Fixture' } })
  const before = JSON.stringify(getInitialSettings())
  expect(setProviderModel('anthropic-api', 'claude-sonnet-5-5', { performanceMode: 'fast' }).ok).toBe(false)
  expect(JSON.stringify(getInitialSettings())).toBe(before)
})

test('/fast uses native settings and never forces a different model', () => {
  workspace()
  let state = { ...getDefaultAppState(), provider: getActiveProviderSettings(), mainLoopModel: 'claude-opus-5-5' }
  const context = { getAppState: () => state, setAppState: (updater: (previous: typeof state) => typeof state) => { state = updater(state) } }
  expect(applyNativeFastMode(true, context as never)).toContain('FAST')
  expect(state.provider.anthropic?.speed).toBe('fast')
  expect(state.mainLoopModel).toBe('claude-opus-5-5')
  state.mainLoopModel = 'claude-sonnet-5-5'
  expect(applyNativeFastMode(true, context as never)).toContain('No native fast serving tier')
  expect(state.mainLoopModel).toBe('claude-sonnet-5-5')
  expect(applyNativeFastMode(false, context as never)).toContain('STANDARD')
})

test('speed key previews a choice without writing settings before confirmation', async () => {
  workspace()
  const before = JSON.stringify(getInitialSettings())
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void }
  input.isTTY = true; input.setRawMode = () => {}
  input.ref = () => {}; input.unref = () => {}
  const output = new PassThrough()
  let finish: (value: string) => void = () => {}
  const changed = new Promise<string>(resolve => { finish = resolve })
  const instance = await render(<ModelSpeedControl provider="anthropic-api" model="claude-opus-5-5" value="standard" onChange={finish} />, { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false })
  try {
    await new Promise(resolve => setTimeout(resolve, 30))
    input.write('s')
    expect(await Promise.race([changed, new Promise(resolve => setTimeout(() => resolve('timeout'), 3000))])).toBe('fast')
    expect(JSON.stringify(getInitialSettings())).toBe(before)
  } finally { instance.unmount(); input.destroy(); output.destroy() }
})
