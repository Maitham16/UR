import * as React from 'react'
import { Text, useInput } from '../ink.js'
import { getAnthropicFastMode } from '../services/providers/anthropicCapabilities.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export function ModelSpeedControl({ provider, model, value, onChange, isActive = true }: {
  provider?: string; model?: string; value: 'standard' | 'fast'
  onChange: (value: 'standard' | 'fast') => void; isActive?: boolean
}): React.ReactNode {
  const supported = provider === 'anthropic-api' && Boolean(model && getAnthropicFastMode(model))
  const disabled = isEnvTruthy(process.env.UR_CODE_DISABLE_FAST_MODE)
  useInput((input, key, event) => {
    if (input.toLowerCase() !== 's' || key.ctrl || key.meta) return
    onChange(value === 'fast' ? 'standard' : 'fast')
    event.stopImmediatePropagation()
  }, { isActive: isActive && supported && !disabled })
  if (!supported) return null
  if (disabled) return <Text dimColor>Speed: STANDARD · fast mode disabled by environment</Text>
  return <Text dimColor>Speed: {value === 'fast' ? 'FAST (premium pricing)' : 'STANDARD'} · s to change · applied on confirmation</Text>
}
