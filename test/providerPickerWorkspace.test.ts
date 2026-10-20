import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetStateForTests, setAllowedSettingSources, setCwdState, setOriginalCwd } from '../src/bootstrap/state.js'
import { saveProviderPickerWorkspace } from '../src/components/ProviderFirstModelPicker.js'
import { getActiveProviderSettings } from '../src/services/providers/providerRegistry.js'
import { shouldRequireStartupModelSelection } from '../src/services/providers/startupModelSelection.js'
import { getInitialSettings, updateSettingsForSource } from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

let directory: string | undefined
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
  resetStateForTests()
  resetSettingsCache()
})

function workspace() {
  directory = mkdtempSync(join(tmpdir(), 'ur-picker-workspace-'))
  resetStateForTests()
  setOriginalCwd(directory)
  setCwdState(directory)
  setAllowedSettingSources(['localSettings'])
  resetSettingsCache()
}

test('saving an Anthropic workspace from the picker preserves the deliberately selected provider and model', () => {
  workspace()
  updateSettingsForSource('localSettings', {
    provider: { active: 'ollama', model: 'fixture-model', anthropic: { speed: 'fast' } },
    model: 'fixture-model',
  })
  expect(saveProviderPickerWorkspace('wrkspc_01Picker').ok).toBe(true)
  expect(getActiveProviderSettings()).toMatchObject({
    active: 'ollama', model: 'fixture-model',
    anthropic: { speed: 'fast', workspaceId: 'wrkspc_01Picker' },
  })
  expect(saveProviderPickerWorkspace('').ok).toBe(true)
  expect(getActiveProviderSettings()).toMatchObject({
    active: 'ollama', model: 'fixture-model', anthropic: { speed: 'fast' },
  })
  expect(getActiveProviderSettings().anthropic?.workspaceId).toBeUndefined()
})

test('workspace configuration alone does not satisfy first-workspace model selection', () => {
  workspace()
  expect(saveProviderPickerWorkspace('wrkspc_01Picker').ok).toBe(true)
  expect(shouldRequireStartupModelSelection({ workspaceSettings: [getInitialSettings()] })).toBe(true)
  expect(getActiveProviderSettings().model).toBeUndefined()
})
