import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { collectReadiness, formatReadiness } from '../../services/readiness.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
export const call: LocalCommandCall = async args => {
  const json = parseArguments(args).includes('--json')
  const report = formatReadiness(await collectReadiness(getCwd()), json)
  // Slash-command results are rendered as Markdown. Preserve literal command
  // placeholders and filenames rather than interpreting them as HTML/markup.
  const fence = '`'.repeat(Math.max(3, ...(report.match(/`+/g) ?? []).map(run => run.length + 1)))
  return { type: 'text', value: `${fence}${json ? 'json' : 'text'}\n${report}\n${fence}` }
}
