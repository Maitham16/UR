import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { ENTITIES, addEntity, graphSummary, isEntity, listEntity } from '../../ur/researchGraph.js'
export const call: LocalCommandCall = async (args: string) => {
  const toks = (args ?? '').trim().split(/\s+/).filter(Boolean)
  if (!toks.length) {
    try {
      const s = graphSummary(getCwd())
      return { type: 'text', value: 'research graph:\n' + Object.entries(s).map(([k, v]) => `  ${k}: ${v}`).join('\n') }
    } catch (error) {
      return {
        type: 'text',
        value: `Could not read research graph: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
  }
  const entity = toks[0]!
  if (!isEntity(entity)) {
    return {
      type: 'text',
      value: `unknown entity "${entity}"\nentities: ${ENTITIES.join(', ')}`,
      exitCode: 2,
    }
  }
  const rest = toks.slice(1).join(' ').trim()
  if (!rest) {
    try {
      const items = listEntity(getCwd(), entity)
      return { type: 'text', value: items.length ? items.map((i) => `- ${i.text}`).join('\n') : `no ${entity} yet` }
    } catch (error) {
      return {
        type: 'text',
        value: `Could not read ${entity}: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      }
    }
  }
  try {
    addEntity(getCwd(), entity, rest)
    return { type: 'text', value: `added to ${entity}: ${rest}` }
  } catch (error) {
    return {
      type: 'text',
      value: `Could not add to ${entity}: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
}
