import type { LocalCommandCall } from '../../types/command.js'
import {
  addFeedback,
  captureDiff,
  captureTestRun,
  deleteArtifact,
  formatArtifact,
  formatArtifactList,
  getArtifact,
  listArtifacts,
  readArtifactBody,
  recordArtifact,
  setStatus,
  type ArtifactKind,
} from '../../services/agents/artifacts.js'
import { appendBackgroundFeedback } from '../../services/agents/backgroundRunner.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const KINDS = new Set<ArtifactKind>(['plan', 'diff', 'test-run', 'screenshot', 'browser-recording', 'note'])

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const withValue = new Set(['--kind', '--title', '--body', '--file', '--summary', '--feedback', '--command', '--task'])
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
    '  ur artifacts list [--json]',
    '  ur artifacts show <id> [--json]',
    '  ur artifacts add --kind plan --title "..." [--body "..."] [--file path] [--summary "..."]',
    '  ur artifacts capture-diff [--title "..."]',
    '  ur artifacts capture-tests --command "bun test"',
    '  ur artifacts approve <id>',
    '  ur artifacts reject <id> --feedback "..."',
    '  ur artifacts feedback|comment <id> --feedback "..." [--task bg_id]',
    '  ur artifacts delete <id>',
  ].join('\n')
}

function backgroundTaskIdFromTrace(trace?: string): string | undefined {
  return trace?.startsWith('bg:') ? trace.slice('bg:'.length) : undefined
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const action = positional[0] ?? 'list'
  const id = positional[1]

  if (action === 'list') {
    return { type: 'text', value: formatArtifactList(listArtifacts(cwd), json) }
  }

  if (action === 'add') {
    const kind = (option(tokens, '--kind') ?? 'note') as ArtifactKind
    const title = option(tokens, '--title')
    if (!title || !KINDS.has(kind)) return { type: 'text', value: usage() }
    const artifact = recordArtifact(cwd, {
      kind,
      title,
      body: option(tokens, '--body'),
      file: option(tokens, '--file'),
      summary: option(tokens, '--summary'),
      links: option(tokens, '--task')
        ? { trace: `bg:${option(tokens, '--task')}` }
        : undefined,
    })
    return {
      type: 'text',
      value: json ? JSON.stringify(artifact, null, 2) : `Recorded artifact ${artifact.id} [${artifact.kind}].`,
    }
  }

  if (action === 'capture-diff') {
    const artifact = await captureDiff(cwd, option(tokens, '--title') ?? 'Working tree diff')
    return {
      type: 'text',
      value: artifact
        ? json
          ? JSON.stringify(artifact, null, 2)
          : `Captured diff as artifact ${artifact.id} (${artifact.summary}).`
        : 'No working-tree changes to capture.',
    }
  }

  if (action === 'capture-tests') {
    const command = option(tokens, '--command') ?? 'bun test'
    const artifact = await captureTestRun(cwd, command)
    return {
      type: 'text',
      value: json ? JSON.stringify(artifact, null, 2) : `Captured test run as artifact ${artifact.id} (${artifact.summary}).`,
    }
  }

  if (!id) return { type: 'text', value: usage() }

  if (action === 'show') {
    const artifact = getArtifact(cwd, id)
    if (!artifact) return { type: 'text', value: `Artifact not found: ${id}` }
    return { type: 'text', value: formatArtifact(artifact, readArtifactBody(cwd, id), json) }
  }

  if (action === 'approve') {
    const artifact = setStatus(cwd, id, 'approved')
    return { type: 'text', value: artifact ? `Approved artifact ${id}.` : `Artifact not found: ${id}` }
  }

  if (action === 'reject') {
    const feedback = option(tokens, '--feedback')
    if (feedback) addFeedback(cwd, id, feedback)
    const artifact = setStatus(cwd, id, 'rejected')
    return { type: 'text', value: artifact ? `Rejected artifact ${id}.` : `Artifact not found: ${id}` }
  }

  if (action === 'feedback' || action === 'comment') {
    const feedback = option(tokens, '--feedback')
    if (!feedback) return { type: 'text', value: 'Provide --feedback "...".' }
    const artifact = addFeedback(cwd, id, feedback)
    if (!artifact) return { type: 'text', value: `Artifact not found: ${id}` }
    const taskId = option(tokens, '--task') ?? backgroundTaskIdFromTrace(artifact.links?.trace)
    const task = taskId
      ? appendBackgroundFeedback(cwd, taskId, feedback, { artifactId: id })
      : null
    return {
      type: 'text',
      value: task
        ? `Added feedback to artifact ${id} and queued it for background task ${taskId}.`
        : `Added feedback to artifact ${id}.`,
    }
  }

  if (action === 'delete' || action === 'remove') {
    return { type: 'text', value: deleteArtifact(cwd, id) ? `Deleted artifact ${id}.` : `Artifact not found: ${id}` }
  }

  return { type: 'text', value: usage() }
}
