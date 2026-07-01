import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getProviderRuntimeInfo } from '../../services/providers/providerRegistry.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  get description() {
    const settings = getSettingsForSource('userSettings')
    const providerRuntime = getProviderRuntimeInfo(settings)
    return `Set the model provider (currently ${providerRuntime.providerLabel})`
  },
  argumentHint: '[provider]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./provider.js'),
} satisfies Command
