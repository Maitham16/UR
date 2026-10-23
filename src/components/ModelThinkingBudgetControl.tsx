import * as React from 'react'
import { Text, useInput } from '../ink.js'
import type { ModelReasoningCapabilities } from '../services/providers/modelCatalog.js'
import type { ThinkingBudgetSelection } from '../services/providers/thinkingBudget.js'
import { providerSupportsThinkingBudget } from '../services/providers/thinkingBudget.js'

export function ModelThinkingBudgetControl({ provider, capabilities, value, onChange, isActive = true }: {
  provider: string; capabilities?: ModelReasoningCapabilities; value?: number; onChange: (value: ThinkingBudgetSelection) => void; isActive?: boolean
}): React.ReactNode {
  const supported = providerSupportsThinkingBudget(provider, capabilities)
  const range = supported ? capabilities?.thinkingBudget : undefined
  const choices: ThinkingBudgetSelection[] = range ? [...new Set<ThinkingBudgetSelection>(['default',
    ...(range.dynamic ? [-1] : []), ...(range.canDisable ? [0] : []), ...(range.min > 0 ? [range.min] : []), range.max])] : []
  useInput((input, key, event) => {
    if (input.toLowerCase() !== 'b' || key.ctrl || key.meta) return
    const current = value === undefined ? 'default' : value
    onChange(choices[(choices.indexOf(current) + 1) % choices.length]!)
    event.stopImmediatePropagation()
  }, { isActive: isActive && choices.length > 1 })
  if (!supported) return null
  const label = value === undefined ? 'DEFAULT' : value === -1 ? 'AUTO (dynamic)' : value === 0 ? 'OFF' : `${value} tokens`
  return <Text dimColor>Thinking budget: {label}{range ? ` · ${range.min}–${range.max} tokens · b cycles bounds/auto` : ''} · custom: /thinking budget N{value !== undefined && capabilities?.supportedEfforts?.length ? ' · effort inactive while this budget is applied' : ''}</Text>
}
