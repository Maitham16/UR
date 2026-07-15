import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  appendProjectMemory,
  architectureSummaryPath,
  compressProjectMemory,
  compressedContextPath,
  contextStatus,
  quarantineInvalidTaskMemory,
  rollbackTaskMemory,
  TASK_MEMORY_KINDS,
  type TaskMemoryKind,
  projectManifestPath,
  writeProjectContextManifest,
  verifyTaskMemory,
} from '../../services/context/projectContextManifest.js'

const MEMORY_KINDS: TaskMemoryKind[] = [...TASK_MEMORY_KINDS]

function usage(): string {
  return [
    'Usage:',
    '  ur context-pack scan [--json]',
    '  ur context-pack remember --type architecture --text "Use repository-pattern for data access"',
    '  ur context-pack remember --preference "Prefer bun test over jest"',
    '  ur context-pack remember --accepted "Use p-map for concurrency" --rationale "Avoids Promise.all OOM"',
    '  ur context-pack remember --rejected "Switch to esbuild" --alternative-to "Keep bun bundle"',
    '  ur context-pack remember --attempt "Tried Deno runtime" --status superseded',
    '  ur context-pack compress [--json]',
    '  ur context-pack memory verify [--json]',
    '  ur context-pack memory quarantine [--json]',
    '  ur context-pack memory rollback --to <entry-id> [--json]',
    '  ur context-pack status',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const flagsWithValue = new Set([
    '--type',
    '--text',
    ...MEMORY_KINDS.map(k => `--${k}`),
    '--status',
    '--rationale',
    '--alternative-to',
    '--supersedes',
    '--scope',
    '--source',
    '--to',
  ])
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function rememberInput(
  tokens: string[],
): {
  kind: TaskMemoryKind
  text: string
  status?: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  rationale?: string
  alternativeTo?: string
  supersedesId?: string
  scope?: 'project' | 'team' | 'personal'
  source?: string
} | null {
  for (const kind of MEMORY_KINDS) {
    const value = option(tokens, `--${kind}`)
    if (value) {
      const meta = collectMeta(tokens)
      return { kind, text: value, ...meta }
    }
  }
  const kind = option(tokens, '--type') as TaskMemoryKind | undefined
  const text = option(tokens, '--text')
  if (!kind || !text || !MEMORY_KINDS.includes(kind)) return null
  const meta = collectMeta(tokens)
  return { kind, text, ...meta }
}

function collectMeta(tokens: string[]): {
  status?: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  rationale?: string
  alternativeTo?: string
  supersedesId?: string
  scope?: 'project' | 'team' | 'personal'
  source?: string
} {
  const status = option(tokens, '--status') as
    | 'proposed'
    | 'accepted'
    | 'rejected'
    | 'superseded'
    | undefined
  return {
    status,
    rationale: option(tokens, '--rationale'),
    alternativeTo: option(tokens, '--alternative-to'),
    supersedesId: option(tokens, '--supersedes'),
    scope: option(tokens, '--scope') as 'project' | 'team' | 'personal' | undefined,
    source: option(tokens, '--source'),
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const action = positionals(tokens)[0] ?? 'scan'
  const subaction = positionals(tokens)[1]
  const cwd = getCwd()

  if (action === 'scan') {
    const manifest = writeProjectContextManifest(cwd)
    const result = {
      manifest: projectManifestPath(cwd),
      architecture: architectureSummaryPath(cwd),
      project: manifest.project.name,
      commands: manifest.commands,
      manifests: manifest.manifests,
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(result, null, 2)
        : [
            `Wrote ${result.manifest}`,
            `Wrote ${result.architecture}`,
            `Project: ${result.project}`,
            `Commands: ${Object.values(result.commands).flat().length}`,
          ].join('\n'),
    }
  }

  if (action === 'remember') {
    const input = rememberInput(tokens)
    if (!input) return { type: 'text', value: usage() }
    const { kind, text, ...meta } = input
    const entry = appendProjectMemory(cwd, kind, text, meta)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(entry, null, 2)
        : `Recorded ${entry.kind}: ${entry.text}`,
    }
  }

  if (action === 'compress') {
    const body = compressProjectMemory(cwd)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ path: compressedContextPath(cwd), bytes: body.length }, null, 2)
        : `Wrote ${compressedContextPath(cwd)}`,
    }
  }

  if (action === 'status') {
    return { type: 'text', value: contextStatus(cwd) }
  }

  if (action === 'memory' && subaction === 'verify') {
    const verification = verifyTaskMemory(cwd)
    const report = {
      valid: verification.valid,
      path: verification.path,
      entryCount: verification.entries.length,
      legacyEntries: verification.legacyEntries,
      verifiedEntries: verification.verifiedEntries,
      headDigest: verification.headDigest,
      fileDigest: verification.fileDigest,
      issues: verification.issues,
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(report, null, 2)
        : [
            `Task memory: ${verification.valid ? 'valid' : 'invalid'}`,
            `Entries: ${verification.entries.length} (${verification.verifiedEntries} integrity-protected, ${verification.legacyEntries} legacy)`,
            `Head: sha256:${verification.headDigest}`,
            ...verification.issues.map(
              issue =>
                `${issue.severity.toUpperCase()} ${issue.code}${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`,
            ),
            `VERDICT: ${verification.valid ? 'PASS' : 'FAIL'}`,
          ].join('\n'),
    }
  }

  if (action === 'memory' && subaction === 'quarantine') {
    try {
      const result = quarantineInvalidTaskMemory(cwd)
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : result.changed
            ? `Quarantined invalid task memory to ${result.quarantinePath}. Retained ${result.retainedEntries} entries and removed ${result.removedLines} invalid lines.`
            : `Task memory is valid; no quarantine was needed (${result.retainedEntries} entries).`,
      }
    } catch (error) {
      return {
        type: 'text',
        value: `Task memory quarantine failed: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  if (action === 'memory' && subaction === 'rollback') {
    const targetId = option(tokens, '--to')
    if (!targetId) return { type: 'text', value: usage() }
    try {
      const result = rollbackTaskMemory(cwd, targetId)
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : `Rolled task memory back to ${targetId}. Retained ${result.retainedEntries} entries, removed ${result.removedEntries}, and preserved the original at ${result.backupPath}.`,
      }
    } catch (error) {
      return {
        type: 'text',
        value: `Task memory rollback failed: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  return { type: 'text', value: usage() }
}
