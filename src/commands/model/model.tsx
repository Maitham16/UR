import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { ModelPicker } from '../../components/ModelPicker.js';
import { ProviderFirstModelPicker } from '../../components/ProviderFirstModelPicker.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { EffortLevel } from '../../utils/effort.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { clearFastModeCooldown, isFastModeAvailable, isFastModeEnabled, isFastModeSupportedByModel } from '../../utils/fastMode.js';
import { MODEL_ALIASES } from '../../utils/model/aliases.js';
import { checkmodelO1mAccess, checkmodelS1mAccess } from '../../utils/model/check1mAccess.js';
import { getDefaultMainLoopModelSetting, ismodelO1mMergeEnabled, renderDefaultModelSetting } from '../../utils/model/model.js';
import { isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { getActiveProviderSettings, type ProviderId, setProviderModel, validateProviderModelPair } from '../../services/providers/providerRegistry.js';
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js';
function ModelPickerWrapper(t0) {
  const $ = _c(17);
  const {
    onDone
  } = t0;
  const mainLoopModel = useAppState(_temp);
  const mainLoopModelForSession = useAppState(_temp2);
  const isFastMode = useAppState(_temp3);
  const setAppState = useSetAppState();
  let t1;
  if ($[0] !== mainLoopModel || $[1] !== onDone) {
    t1 = function handleCancel() {
      logEvent("tengu_model_command_menu", {
        action: "cancel" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const displayModel = renderModelLabel(mainLoopModel);
      onDone(`Kept model as ${chalk.bold(displayModel)}`, {
        display: "system"
      });
    };
    $[0] = mainLoopModel;
    $[1] = onDone;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleCancel = t1;
  let t2;
  if ($[3] !== isFastMode || $[4] !== mainLoopModel || $[5] !== onDone || $[6] !== setAppState) {
    t2 = function handleSelect(model, effort, metadata) {
      logEvent("tengu_model_command_menu", {
        action: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        from_model: mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        to_model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setAppState(prev => ({
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null
      }));
      if (model && metadata) {
        setProviderModel(metadata.providerId, model, {
          modelSource: metadata.modelSource
        });
      }
      let message = metadata ? `Selected provider: ${chalk.bold(metadata.providerName)} (${metadata.accessType})\nSelected model: ${chalk.bold(renderModelLabel(model))}\nModel source: ${metadata.modelSource}\nRuntime backend: ${metadata.runtimeBackend}` : `Set model to ${chalk.bold(renderModelLabel(model))}`;
      if (effort !== undefined) {
        message = message + ` with ${chalk.bold(effort)} effort`;
      }
      let wasFastModeToggledOn = undefined;
      if (isFastModeEnabled()) {
        clearFastModeCooldown();
        if (!isFastModeSupportedByModel(model) && isFastMode) {
          setAppState(_temp4);
          wasFastModeToggledOn = false;
        } else {
          if (isFastModeSupportedByModel(model) && isFastModeAvailable() && isFastMode) {
            message = message + " \xB7 Fast mode ON";
            wasFastModeToggledOn = true;
          }
        }
      }
      if (isBilledAsExtraUsage(model, wasFastModeToggledOn === true, ismodelO1mMergeEnabled())) {
        message = message + " \xB7 Billed as extra usage";
      }
      if (wasFastModeToggledOn === false) {
        message = message + " \xB7 Fast mode OFF";
      }
      onDone(message);
    };
    $[3] = isFastMode;
    $[4] = mainLoopModel;
    $[5] = onDone;
    $[6] = setAppState;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const handleSelect = t2;
  let t3;
  if ($[8] !== isFastMode || $[9] !== mainLoopModel) {
    t3 = isFastModeEnabled() && isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable();
    $[8] = isFastMode;
    $[9] = mainLoopModel;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  let t4;
  if ($[11] !== handleCancel || $[12] !== handleSelect || $[13] !== mainLoopModel || $[14] !== mainLoopModelForSession || $[15] !== t3) {
    t4 = <ProviderFirstModelPicker initial={mainLoopModel} onSelect={handleSelect} onCancel={handleCancel} isStandaloneCommand={true} />;
    $[11] = handleCancel;
    $[12] = handleSelect;
    $[13] = mainLoopModel;
    $[14] = mainLoopModelForSession;
    $[15] = t3;
    $[16] = t4;
  } else {
    t4 = $[16];
  }
  return t4;
}
function _temp4(prev_0) {
  return {
    ...prev_0,
    fastMode: false
  };
}
function _temp3(s_1) {
  return s_1.fastMode;
}
function _temp2(s_0) {
  return s_0.mainLoopModelForSession;
}
function _temp(s) {
  return s.mainLoopModel;
}
function SetModelAndClose({
  args,
  onDone
}: {
  args: string;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
}): React.ReactNode {
  const isFastMode = useAppState(s => s.fastMode);
  const providerSelection = useAppState(s => s.provider);
  const setAppState = useSetAppState();
  const model = args === 'default' ? null : args;
  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      if (model && !isModelAllowed(model)) {
        onDone(`Model '${model}' is not available. Your organization restricts model selection.`, {
          display: 'system'
        });
        return;
      }

      // @[MODEL LAUNCH]: Update check for 1M access.
      if (model && ismodelO1mUnavailable(model)) {
        onDone(`The selected 1M-context model is not available for your account. Choose another model with /model.`, {
          display: 'system'
        });
        return;
      }
      if (model && ismodelS1mUnavailable(model)) {
        onDone(`The selected 1M-context model is not available for your account. Choose another model with /model.`, {
          display: 'system'
        });
        return;
      }

      const currentProvider = providerSelection?.active ?? getActiveProviderSettings(getInitialSettings()).active ?? 'ollama';

      // Skip validation for default model
      if (!model) {
        setModel(null, currentProvider);
        return;
      }

      const providerValidation = validateProviderModelPair(currentProvider, model);
      if (providerValidation.valid === false) {
        onDone(`Invalid model for current provider:\n  Selected provider: ${currentProvider}\n  Selected model: ${model}\n  Valid models for ${currentProvider}: ${providerValidation.validModels.join(', ') || '(no models discovered)'}\n  Suggested action: Run /model and choose a model from ${currentProvider}${providerValidation.suggestedModel ? `, or run: ur config set model ${providerValidation.suggestedModel}` : ''}\n  Error: ${providerValidation.error}`, {
          display: 'system'
        });
        return;
      }
      const saved = setProviderModel(currentProvider, model);
      if (!saved.ok) {
        onDone(saved.message, {
          display: 'system'
        });
        return;
      }
      setModel(model, currentProvider);
      return;
    }
    function setModel(modelValue: string | null, provider?: ProviderId): void {
      setAppState(prev => ({
        ...prev,
        mainLoopModel: modelValue,
        mainLoopModelForSession: null,
        ...(provider
          ? {
              provider: {
                ...(prev.provider ?? {}),
                active: provider,
                model: modelValue ?? undefined,
              },
            }
          : {}),
      }));
      if (modelValue === null) {
        updateSettingsForSource('localSettings', {
          model: undefined,
          provider: {
            model: undefined,
          },
        } as never);
      }
      let message = `Set model to ${chalk.bold(renderModelLabel(modelValue))}`;
      let wasFastModeToggledOn = undefined;
      if (isFastModeEnabled()) {
        clearFastModeCooldown();
        if (!isFastModeSupportedByModel(modelValue) && isFastMode) {
          setAppState(prev_0 => ({
            ...prev_0,
            fastMode: false
          }));
          wasFastModeToggledOn = false;
          // Do not update fast mode in settings since this is an automatic downgrade
        } else if (isFastModeSupportedByModel(modelValue) && isFastMode) {
          message += ` · Fast mode ON`;
          wasFastModeToggledOn = true;
        }
      }
      if (isBilledAsExtraUsage(modelValue, wasFastModeToggledOn === true, ismodelO1mMergeEnabled())) {
        message += ` · Billed as extra usage`;
      }
      if (wasFastModeToggledOn === false) {
        // Fast mode was toggled off, show suffix after extra usage billing
        message += ` · Fast mode OFF`;
      }
      onDone(message);
    }
    void handleModelChange();
  }, [model, onDone, providerSelection?.active, setAppState]);
  return null;
}
function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(model.toLowerCase().trim());
}
function ismodelO1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  return !checkmodelO1mAccess() && !ismodelO1mMergeEnabled() && m.includes('modelo') && m.includes('[1m]');
}
function ismodelS1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  return !checkmodelS1mAccess() && m.includes('models') && m.includes('[1m]');
}
function ShowModelAndClose(t0) {
  const {
    onDone
  } = t0;
  const mainLoopModel = useAppState(_temp7);
  const mainLoopModelForSession = useAppState(_temp8);
  const effortValue = useAppState(_temp9);
  const displayModel = renderModelLabel(mainLoopModel);
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : "";
  if (mainLoopModelForSession) {
    onDone(`Current model: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (session override from plan mode)\nBase model: ${displayModel}${effortInfo}`);
  } else {
    onDone(`Current model: ${displayModel}${effortInfo}`);
  }
  return null;
}
function _temp9(s_1) {
  return s_1.effortValue;
}
function _temp8(s_0) {
  return s_0.mainLoopModelForSession;
}
function _temp7(s) {
  return s.mainLoopModel;
}
export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';
  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return <ShowModelAndClose onDone={onDone} />;
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Run /model to open the model selection menu, or /model [modelName] to set the model.', {
      display: 'system'
    });
    return;
  }
  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return <SetModelAndClose args={args} onDone={onDone} />;
  }
  return <ModelPickerWrapper onDone={onDone} />;
};
function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(model ?? getDefaultMainLoopModelSetting());
  return model === null ? `${rendered} (default)` : rendered;
}
