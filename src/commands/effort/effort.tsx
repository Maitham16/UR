import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride, getEffortValueDescription, getSupportedEffortLevelLabelsForModel, getSupportedEffortLevelsForModel, isEffortLevel, modelSupportsEffort, resolveAppliedEffort, resolveProviderEffortLevel, toPersistableEffort } from '../../utils/effort.js';
import { ensureProviderReasoningCapabilitiesForModel, type ProviderId } from '../../services/providers/providerRegistry.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { getRuntimeProvider } from '../../utils/model/providers.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
const COMMON_HELP_ARGS = ['help', '-h', '--help'];
type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value: EffortValue | undefined;
  };
};
function setEffortValue(effortValue: EffortValue, model?: string, provider: ProviderId = getRuntimeProvider()): EffortCommandResult {
  if (model && !modelSupportsEffort(model, provider)) {
    return {
      message: `Not applied: ${model} on ${provider} does not advertise graded reasoning-effort levels.`
    };
  }
  if (
    model &&
    effortValue === 'ultra' &&
    !getSupportedEffortLevelsForModel(model, provider).includes('ultra')
  ) {
    return {
      message: `Not applied: ${model} on ${provider} does not advertise a beyond-high reasoning-effort ceiling for Ultra.`
    };
  }
  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`
      };
    }
  }
  logEvent('tengu_effort_command', {
    effort: effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.UR_CODE_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: UR_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: {
          value: effortValue
        }
      };
    }
    return {
      message: `UR_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: {
        value: effortValue
      }
    };
  }
  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  const appliedLevel =
    model && typeof effortValue === 'string'
      ? resolveProviderEffortLevel(model, effortValue, provider)
      : effortValue;
  if (typeof effortValue === 'string' && appliedLevel !== effortValue) {
    return {
      message: `Requested ${effortValue}${suffix}; applied ${appliedLevel} for ${model} on ${provider}: ${getEffortValueDescription(appliedLevel!)}`,
      effortUpdate: {
        value: effortValue
      }
    };
  }
  return {
    message: `Set effort level to ${effortValue}${suffix} for ${model ?? 'the active model'} on ${provider}: ${description}`,
    effortUpdate: {
      value: effortValue
    }
  };
}
export function showCurrentEffort(appStateEffort: EffortValue | undefined, model: string, provider: ProviderId = getRuntimeProvider()): EffortCommandResult {
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : envOverride ?? appStateEffort;
  if (effectiveValue === undefined) {
    if (!modelSupportsEffort(model, provider)) {
      return {
        message: `Effort: unavailable — ${model} on ${provider} does not advertise graded reasoning-effort levels.`
      };
    }
    const applied = resolveAppliedEffort(model, appStateEffort, provider);
    if (applied === undefined) {
      return {
        message: `Effort: auto for ${model} on ${provider}; UR sends no explicit effort and the provider chooses its default. Available levels: ${getSupportedEffortLevelLabelsForModel(model, provider).join(', ')}`
      };
    }
    const level = getDisplayedEffortLevel(model, appStateEffort, provider);
    return {
      message: `Effort: auto; applied ${level} for ${model} on ${provider}. Available levels: ${getSupportedEffortLevelLabelsForModel(model, provider).join(', ')}`
    };
  }
  if (!modelSupportsEffort(model, provider)) {
    return {
      message: `Effort: unavailable — ${model} on ${provider} does not advertise graded reasoning-effort levels.`
    };
  }
  if (
    effectiveValue === 'ultra' &&
    !getSupportedEffortLevelsForModel(model, provider).includes('ultra')
  ) {
    return {
      message: `Requested effort: ultra; not applied — ${model} on ${provider} does not advertise a beyond-high ceiling. Available levels: ${getSupportedEffortLevelLabelsForModel(model, provider).join(', ')}`
    };
  }
  const appliedLevel = getDisplayedEffortLevel(model, appStateEffort, provider);
  if (typeof effectiveValue === 'string' && appliedLevel !== effectiveValue) {
    return {
      message: `Requested effort: ${effectiveValue}; applied effort for ${model} on ${provider}: ${appliedLevel} (${getEffortValueDescription(appliedLevel)}). Available levels: ${getSupportedEffortLevelLabelsForModel(model, provider).join(', ')}`
    };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort: ${effectiveValue}; applied ${appliedLevel} for ${model} on ${provider} (${description}). Available levels: ${getSupportedEffortLevelLabelsForModel(model, provider).join(', ')}`
  };
}
function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`
    };
  }
  logEvent('tengu_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.UR_CODE_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but UR_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: {
        value: undefined
      }
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: {
      value: undefined
    }
  };
}
export function executeEffort(args: string, model?: string, provider: ProviderId = getRuntimeProvider()): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }
  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: minimal, low, medium, high, xhigh, max, ultra, auto`
    };
  }
  return setEffortValue(normalized, model, provider);
}
function ShowCurrentEffort(t0) {
  const {
    onDone
  } = t0;
  const effortValue = useAppState(_temp);
  const model = useMainLoopModel();
  const provider = getRuntimeProvider();
  const {
    message
  } = showCurrentEffort(effortValue, model, provider);
  onDone(message);
  return null;
}
function _temp(s) {
  return s.effortValue;
}
function ApplyEffortAndClose(t0) {
  const $ = _c(6);
  const {
    result,
    onDone
  } = t0;
  const setAppState = useSetAppState();
  const {
    effortUpdate,
    message
  } = result;
  let t1;
  let t2;
  if ($[0] !== effortUpdate || $[1] !== message || $[2] !== onDone || $[3] !== setAppState) {
    t1 = () => {
      if (effortUpdate) {
        setAppState(prev => ({
          ...prev,
          effortValue: effortUpdate.value
        }));
      }
      onDone(message);
    };
    t2 = [setAppState, effortUpdate, message, onDone];
    $[0] = effortUpdate;
    $[1] = message;
    $[2] = onDone;
    $[3] = setAppState;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  React.useEffect(t1, t2);
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Usage: /effort [minimal|low|medium|high|xhigh|max|ultra|auto]\n\nUR reads the selected model\'s exact provider-advertised levels. `max` means that model\'s established ceiling, so it resolves to max, xhigh, or high as appropriate. `ultra` is UR\'s visible beyond-high ceiling selector: it appears only when the model advertises ultra, max, xhigh, or an explicit equivalent, and UR sends that exact provider value. High-only and boolean-thinking models never receive Ultra.\n\nEffort levels:\n- minimal: Lowest latency and cost\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended reasoning above high\n- max: The selected model\'s established maximum level\n- ultra: Provider-advertised beyond-high ceiling (shown with its native mapping)\n- auto: Use the model/provider default');
    return;
  }
  const model = getMainLoopModel();
  const runtimeProvider = getRuntimeProvider();
  if (
    !getSupportedEffortLevelsForModel(model, runtimeProvider).length ||
    (args.toLowerCase() === 'ultra' &&
      !getSupportedEffortLevelsForModel(model, runtimeProvider).includes('ultra'))
  ) {
    await ensureProviderReasoningCapabilitiesForModel(runtimeProvider, model).catch(() => undefined);
  }
  if (!args || args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />;
  }
  const result = executeEffort(args, model, runtimeProvider);
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
}
