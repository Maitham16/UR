// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isURAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import {
  COST_TIER_3_15,
  COST_MODELH_35,
  COST_MODELH_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkmodelO1mAccess, checkmodelS1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getURAiUserDefaultModelDescription,
  getDefaultmodelSModel,
  getDefaultmodelOModel,
  getDefaultmodelHModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  ismodelO1mMergeEnabled,
  getmodelO46PricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'
import { getAntModels } from './antModels.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  // Subscribers
  if (isURAISubscriber()) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: getURAiUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

function getCustommodelSOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const custommodelSModel = process.env.URHQ_DEFAULT_MODELS_MODEL
  // When a 3P user has a custom modelS model string, show it directly
  if (is3P && custommodelSModel) {
    const is1m = has1mContext(custommodelSModel)
    return {
      value: 'modelS',
      label:
        process.env.URHQ_DEFAULT_MODELS_MODEL_NAME ?? custommodelSModel,
      description:
        process.env.URHQ_DEFAULT_MODELS_MODEL_DESCRIPTION ??
        `Custom modelS model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.URHQ_DEFAULT_MODELS_MODEL_DESCRIPTION ?? `Custom modelS model${is1m ? ' with 1M context' : ''}`} (${custommodelSModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getmodelSXXOption, getmodelOXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
function getmodelS46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().modelS46 : 'modelS',
    label: 'modelS',
    description: `modelS 4.6 · Best for everyday tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'modelS 4.6 - best for everyday tasks. Generally recommended for most coding tasks',
  }
}

function getCustommodelOOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const custommodelOModel = process.env.URHQ_DEFAULT_MODELO_MODEL
  // When a 3P user has a custom modelO model string, show it directly
  if (is3P && custommodelOModel) {
    const is1m = has1mContext(custommodelOModel)
    return {
      value: 'modelO',
      label: process.env.URHQ_DEFAULT_MODELO_MODEL_NAME ?? custommodelOModel,
      description:
        process.env.URHQ_DEFAULT_MODELO_MODEL_DESCRIPTION ??
        `Custom modelO model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.URHQ_DEFAULT_MODELO_MODEL_DESCRIPTION ?? `Custom modelO model${is1m ? ' with 1M context' : ''}`} (${custommodelOModel})`,
    }
  }
}

function getmodelO41Option(): ModelOption {
  return {
    value: 'modelO',
    label: 'modelO 4.1',
    description: `modelO 4.1 · Legacy`,
    descriptionForModel: 'modelO 4.1 - legacy version',
  }
}

function getmodelO46Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().modelO46 : 'modelO',
    label: 'modelO',
    description: `modelO 4.6 · Most capable for complex work${getmodelO46PricingSuffix(fastMode)}`,
    descriptionForModel: 'modelO 4.6 - most capable for complex work',
  }
}

export function getmodelS46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().modelS46 + '[1m]' : 'modelS[1m]',
    label: 'modelS (1M context)',
    description: `modelS 4.6 for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'modelS 4.6 with 1M context window - for long sessions with large codebases',
  }
}

export function getmodelO46_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().modelO46 + '[1m]' : 'modelO[1m]',
    label: 'modelO (1M context)',
    description: `modelO 4.6 for long sessions${getmodelO46PricingSuffix(fastMode)}`,
    descriptionForModel:
      'modelO 4.6 with 1M context window - for long sessions with large codebases',
  }
}

function getCustommodelHOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const custommodelHModel = process.env.URHQ_DEFAULT_MODELH_MODEL
  // When a 3P user has a custom modelH model string, show it directly
  if (is3P && custommodelHModel) {
    return {
      value: 'modelH',
      label: process.env.URHQ_DEFAULT_MODELH_MODEL_NAME ?? custommodelHModel,
      description:
        process.env.URHQ_DEFAULT_MODELH_MODEL_DESCRIPTION ??
        'Custom modelH model',
      descriptionForModel: `${process.env.URHQ_DEFAULT_MODELH_MODEL_DESCRIPTION ?? 'Custom modelH model'} (${custommodelHModel})`,
    }
  }
}

function getmodelH45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'modelH',
    label: 'modelH',
    description: `modelH 4.5 · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_MODELH_45)}`}`,
    descriptionForModel:
      'modelH 4.5 - fastest for quick answers. Lower cost but less capable than modelS 4.6.',
  }
}

function getmodelH35Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'modelH',
    label: 'modelH',
    description: `modelH 3.5 for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_MODELH_35)}`}`,
    descriptionForModel:
      'modelH 3.5 - faster and lower cost, but less capable than modelS. Use for simple tasks.',
  }
}

function getmodelHOption(): ModelOption {
  // Return correct modelH option based on provider
  const modelHModel = getDefaultmodelHModel()
  return modelHModel === getModelStrings().modelH45
    ? getmodelH45Option()
    : getmodelH35Option()
}

function getMaxmodelOOption(fastMode = false): ModelOption {
  return {
    value: 'modelO',
    label: 'modelO',
    description: `modelO 4.6 · Most capable for complex work${fastMode ? getmodelO46PricingSuffix(true) : ''}`,
  }
}

export function getMaxmodelS46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const billingInfo = isURAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'modelS[1m]',
    label: 'modelS (1M context)',
    description: `modelS 4.6 with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

export function getMaxmodelO46_1MOption(fastMode = false): ModelOption {
  const billingInfo = isURAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'modelO[1m]',
    label: 'modelO (1M context)',
    description: `modelO 4.6 with 1M context${billingInfo}${getmodelO46PricingSuffix(fastMode)}`,
  }
}

function getMergedmodelO1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().modelO46 + '[1m]' : 'modelO[1m]',
    label: 'modelO (1M context)',
    description: `modelO 4.6 with 1M context · Most capable for complex work${!is3P && fastMode ? getmodelO46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      'modelO 4.6 with 1M context - most capable for complex work',
  }
}

const MaxmodelS46Option: ModelOption = {
  value: 'modelS',
  label: 'modelS',
  description: 'modelS 4.6 · Best for everyday tasks',
}

const MaxmodelH45Option: ModelOption = {
  value: 'modelH',
  label: 'modelH',
  description: 'modelH 4.5 · Fastest for quick answers',
}

function getmodelOPlanOption(): ModelOption {
  return {
    value: 'modelOplan',
    label: 'modelO Plan Mode',
    description: 'Use modelO 4.6 in plan mode, modelS 4.6 otherwise',
  }
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (getAPIProvider() === 'ollama') {
    return [getDefaultOptionForUser(fastMode)]
  }

  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedmodelO1MOption(fastMode),
      getmodelS46Option(),
      getmodelS46_1MOption(),
      getmodelH45Option(),
    ]
  }

  if (isURAISubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: modelO is default, show modelS as alternative
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!ismodelO1mMergeEnabled() && checkmodelO1mAccess()) {
        premiumOptions.push(getMaxmodelO46_1MOption(fastMode))
      }

      premiumOptions.push(MaxmodelS46Option)
      if (checkmodelS1mAccess()) {
        premiumOptions.push(getMaxmodelS46_1MOption())
      }

      premiumOptions.push(MaxmodelH45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: modelS is default, show modelO as alternative
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkmodelS1mAccess()) {
      standardOptions.push(getMaxmodelS46_1MOption())
    }

    if (ismodelO1mMergeEnabled()) {
      standardOptions.push(getMergedmodelO1MOption(fastMode))
    } else {
      standardOptions.push(getMaxmodelOOption(fastMode))
      if (checkmodelO1mAccess()) {
        standardOptions.push(getMaxmodelO46_1MOption(fastMode))
      }
    }

    standardOptions.push(MaxmodelH45Option)
    return standardOptions
  }

  // PAYG 1P API: Default (modelS) + modelS 1M + modelO 4.6 + modelO 1M + modelH
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (checkmodelS1mAccess()) {
      payg1POptions.push(getmodelS46_1MOption())
    }
    if (ismodelO1mMergeEnabled()) {
      payg1POptions.push(getMergedmodelO1MOption(fastMode))
    } else {
      payg1POptions.push(getmodelO46Option(fastMode))
      if (checkmodelO1mAccess()) {
        payg1POptions.push(getmodelO46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getmodelH45Option())
    return payg1POptions
  }

  // PAYG 3P: Default (modelS 4.5) + modelS (3P custom) or modelS 4.6/1M + modelO (3P custom) or modelO 4.1/modelO 4.6/modelO1M + modelH + modelO 4.1
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const custommodelS = getCustommodelSOption()
  if (custommodelS !== undefined) {
    payg3pOptions.push(custommodelS)
  } else {
    // Add modelS 4.6 since modelS 4.5 is the default
    payg3pOptions.push(getmodelS46Option())
    if (checkmodelS1mAccess()) {
      payg3pOptions.push(getmodelS46_1MOption())
    }
  }

  const custommodelO = getCustommodelOOption()
  if (custommodelO !== undefined) {
    payg3pOptions.push(custommodelO)
  } else {
    // Add modelO 4.1, modelO 4.6 and modelO 4.6 1M
    payg3pOptions.push(getmodelO41Option()) // This is the default modelO
    payg3pOptions.push(getmodelO46Option(fastMode))
    if (checkmodelO1mAccess()) {
      payg3pOptions.push(getmodelO46_1MOption(fastMode))
    }
  }
  const custommodelH = getCustommodelHOption()
  if (custommodelH !== undefined) {
    payg3pOptions.push(custommodelH)
  } else {
    payg3pOptions.push(getmodelHOption())
  }
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // modelS family
  if (
    canonical.includes('ur-modelS-4-6') ||
    canonical.includes('ur-modelS-4-5') ||
    canonical.includes('ur-modelS-4-') ||
    canonical.includes('ur-3-7-modelS') ||
    canonical.includes('ur-3-5-modelS')
  ) {
    const currentName = getMarketingNameForModel(getDefaultmodelSModel())
    if (currentName) {
      return { alias: 'modelS', currentVersionName: currentName }
    }
  }

  // modelO family
  if (canonical.includes('ur-modelO-4')) {
    const currentName = getMarketingNameForModel(getDefaultmodelOModel())
    if (currentName) {
      return { alias: 'modelO', currentVersionName: currentName }
    }
  }

  // modelH family
  if (
    canonical.includes('ur-modelH') ||
    canonical.includes('ur-3-5-modelH')
  ) {
    const currentName = getMarketingNameForModel(getDefaultmodelHModel())
    if (currentName) {
      return { alias: 'modelH', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known UR model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the URHQ_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.URHQ_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.URHQ_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.URHQ_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'modelOplan') {
    return filterModelOptionsByAllowlist([...options, getmodelOPlanOption()])
  } else if (customModel === 'modelO' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxmodelOOption(fastMode),
    ])
  } else if (customModel === 'modelO[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedmodelO1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known UR models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
