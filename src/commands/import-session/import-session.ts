import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { importSessionFile } from '../../utils/sessionImport.js'

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args).filter(token => !token.startsWith('--'))
  const path = tokens[0]
  if (!path) {
    return {
      type: 'text',
      value:
        'Usage: /import-session <path-to-transcript.jsonl>\n' +
        'The file must be a session .jsonl copied from another machine ' +
        '(found under the projects directory of that install).',
      exitCode: 2,
    }
  }
  try {
    const result = importSessionFile(path)
    return {
      type: 'text',
      value:
        `Imported ${result.messageCount} entries as session ${result.sessionId}\n` +
        `Stored at: ${result.path}\n` +
        `Resume it with: ur -r ${result.sessionId}`,
    }
  } catch (error) {
    return {
      type: 'text',
      value: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    }
  }
}
