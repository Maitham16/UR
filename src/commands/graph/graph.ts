import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { ENTITIES, addEntity, graphSummary, isEntity, listEntity } from '../../ur/researchGraph.js'
export const call: LocalCommandCall = async (args: string) => {
  const toks = (args ?? '').trim().split(/\s+/).filter(Boolean)
  if (!toks.length) {
    const s = graphSummary(getCwd())
    return { type: 'text', value: 'research graph:\n' + Object.entries(s).map(([k, v]) => `  ${k}: ${v}`).join('\n') }
  }
  const entity = toks[0]!
  if (!isEntity(entity)) return { type: 'text', value: `unknown entity "${entity}"\nentities: ${ENTITIES.join(', ')}` }
  const rest = toks.slice(1).join(' ').trim()
  if (!rest) {
    const items = listEntity(getCwd(), entity)
    return { type: 'text', value: items.length ? items.map((i) => `- ${i.text}`).join('\n') : `no ${entity} yet` }
  }
  addEntity(getCwd(), entity, rest)
  return { type: 'text', value: `added to ${entity}: ${rest}` }
}
