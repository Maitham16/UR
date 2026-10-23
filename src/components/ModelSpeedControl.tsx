import * as React from 'react'
import { Text, useInput } from '../ink.js'
import { getModelPerformanceOptions, isAcceleratedPerformanceMode, performanceModeLabel, type ModelPerformanceMode } from '../services/providers/modelPerformance.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export function ModelSpeedControl({ provider, model, value, onChange, isActive = true }: {
  provider?: string; model?: string; value: ModelPerformanceMode
  onChange: (value: ModelPerformanceMode) => void; isActive?: boolean
}): React.ReactNode {
  const options = provider && model ? getModelPerformanceOptions(provider, model) : []
  const disabled = isEnvTruthy(process.env.UR_CODE_DISABLE_FAST_MODE)
  const selectable = options.filter(option => !disabled || !isAcceleratedPerformanceMode(option.value))
  const displayed = disabled && isAcceleratedPerformanceMode(value) ? options.find(option => option.value === 'standard')?.value ?? 'auto' : value
  useInput((input, key, event) => {
    if (input.toLowerCase() !== 's' || key.ctrl || key.meta) return
    const next = selectable[(selectable.findIndex(option => option.value === displayed) + 1) % selectable.length]
    if (next) onChange(next.value)
    event.stopImmediatePropagation()
  }, { isActive: isActive && selectable.length > 1 })
  if (!options.length) return <Text dimColor>Speed: managed by provider/runtime</Text>
  return <Text dimColor>Speed: {performanceModeLabel(displayed)} · {selectable.length > 1 ? 's to change · applied on confirmation' : 'fast mode disabled by environment'}</Text>
}
