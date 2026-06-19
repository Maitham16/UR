import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../services/urAiLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isURAISubscriber } from '../../utils/auth.js'

export const call: LocalCommandCall = async () => {
  if (isURAISubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your UR usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your UR usage'
    }

    if (process.env.USER_TYPE === 'ant') {
      value += `\n\n[ANT-ONLY] Showing cost anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}
