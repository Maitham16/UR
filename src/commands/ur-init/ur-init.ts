import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { formatUrAssetsResult, scaffoldUrAssets } from '../../utils/urAssets.js'

export const call: LocalCommandCall = async () => {
  const result = scaffoldUrAssets(getCwd())
  return { type: 'text', value: formatUrAssetsResult(result) }
}
