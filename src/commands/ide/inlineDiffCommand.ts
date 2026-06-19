import {
  addIdeDiffComment,
  createIdeDiffBundle,
  deleteIdeDiffBundle,
  formatIdeDiffBundle,
  formatIdeDiffList,
  formatIdeDiffSchema,
  getIdeDiffBundle,
  listIdeDiffBundles,
  setIdeDiffStatus,
} from '../../services/agents/ideDiffs.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set(['--title', '--base', '--feedback', '--file', '--line'])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (withValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur ide diff capture [--title "..."] [--base main] [--staged] [--json]',
    '  ur ide diff list [--json]',
    '  ur ide diff show <id> [--json]',
    '  ur ide diff comment <id> --feedback "..." [--file path] [--line N]',
    '  ur ide diff approve|reject <id>',
    '  ur ide diff delete <id>',
    '  ur ide diff schema',
  ].join('\n')
}

export async function runIdeDiffCommand(args: string, cwd = getCwd()): Promise<string> {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  if (positional[0] === 'diff' || positional[0] === 'diffs') positional.shift()
  const action = positional[0] ?? 'list'
  const id = positional[1]

  if (action === 'schema' || action === 'protocol') {
    return formatIdeDiffSchema()
  }

  if (action === 'list') {
    return formatIdeDiffList(listIdeDiffBundles(cwd), json)
  }

  if (action === 'capture' || action === 'add') {
    const result = await createIdeDiffBundle(cwd, {
      title: option(tokens, '--title'),
      baseRef: option(tokens, '--base'),
      staged: tokens.includes('--staged'),
    })
    if (result.error) return `Failed to capture IDE diff: ${result.error}`
    if (!result.bundle) return 'No diff to capture.'
    return json
      ? JSON.stringify({ bundle: result.bundle, command: result.command }, null, 2)
      : `Captured IDE diff ${result.bundle.id} (${result.bundle.files.length} file(s)).`
  }

  if (!id) return usage()

  if (action === 'show') {
    const bundle = getIdeDiffBundle(cwd, id)
    return bundle ? formatIdeDiffBundle(cwd, bundle, json) : `IDE diff not found: ${id}`
  }

  if (action === 'comment' || action === 'feedback') {
    const feedback = option(tokens, '--feedback')
    if (!feedback) return 'Provide --feedback "...".'
    const lineRaw = option(tokens, '--line')
    const line = lineRaw && Number.isFinite(Number(lineRaw)) ? Number(lineRaw) : undefined
    const bundle = addIdeDiffComment(cwd, id, {
      text: feedback,
      file: option(tokens, '--file'),
      line,
    })
    return bundle ? `Added IDE diff comment to ${id}.` : `IDE diff not found: ${id}`
  }

  if (action === 'approve' || action === 'reject') {
    const bundle = setIdeDiffStatus(cwd, id, action === 'approve' ? 'approved' : 'rejected')
    return bundle ? `${action === 'approve' ? 'Approved' : 'Rejected'} IDE diff ${id}.` : `IDE diff not found: ${id}`
  }

  if (action === 'delete' || action === 'remove') {
    return deleteIdeDiffBundle(cwd, id) ? `Deleted IDE diff ${id}.` : `IDE diff not found: ${id}`
  }

  return usage()
}
