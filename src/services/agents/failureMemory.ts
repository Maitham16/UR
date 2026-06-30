/**
 * Failure memory system.
 *
 * Records failed commands, error traces, attempted fixes, and final resolutions
 * into the project's task memory so UR can learn from failed runs and avoid
 * repeating the same mistakes.
 */

import { appendProjectMemory, readProjectMemoryByKind, type TaskMemoryEntry } from '../context/projectContextManifest.js'

export type FailureRecord = {
  failedCommand: string
  errorTrace: string
  attemptedFix?: string
  finalResolution?: string
  at: string
}

export function recordFailure(
  cwd: string,
  record: Omit<FailureRecord, 'at'>,
): TaskMemoryEntry {
  const text = [
    `Failed command: ${record.failedCommand}`,
    `Error: ${record.errorTrace.slice(0, 2000)}`,
    record.attemptedFix ? `Attempted fix: ${record.attemptedFix}` : undefined,
    record.finalResolution ? `Resolution: ${record.finalResolution}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
  return appendProjectMemory(cwd, 'attempt', text, {
    status: record.finalResolution ? 'accepted' : 'rejected',
    source: 'failure-memory',
  })
}

export function recordResolution(
  cwd: string,
  failedCommand: string,
  resolution: string,
): TaskMemoryEntry {
  const text = [
    `Failed command: ${failedCommand}`,
    'Error: see previous failure memory for the original trace',
    `Resolution: ${resolution}`,
  ].join('\n')
  return appendProjectMemory(cwd, 'attempt', text, {
    status: 'accepted',
    source: 'failure-memory',
  })
}

export function findSimilarFailures(cwd: string, command: string, error: string): FailureRecord[] {
  const attempts = readProjectMemoryByKind(cwd, ['attempt'])
  const records: FailureRecord[] = []
  for (const entry of attempts) {
    const cmdMatch = entry.text.includes(`Failed command: ${command}`)
    const errMatch = error && entry.text.includes(error.slice(0, 200))
    if (cmdMatch || errMatch) {
      const lines = entry.text.split('\n')
      const failedCommand = lines.find(l => l.startsWith('Failed command: '))?.slice('Failed command: '.length) ?? ''
      const errorTrace = lines.find(l => l.startsWith('Error: '))?.slice('Error: '.length) ?? ''
      const attemptedFix = lines.find(l => l.startsWith('Attempted fix: '))?.slice('Attempted fix: '.length)
      const finalResolution = lines.find(l => l.startsWith('Resolution: '))?.slice('Resolution: '.length)
      records.push({ failedCommand, errorTrace, attemptedFix, finalResolution, at: entry.at })
    }
  }
  return records.slice(-5)
}

export function formatFailureHints(records: FailureRecord[]): string {
  if (records.length === 0) return ''
  const lines = ['', '## Previous similar failures', '']
  for (const record of records) {
    lines.push(`- **${record.failedCommand}** (${record.at})`)
    if (record.attemptedFix) lines.push(`  - attempted fix: ${record.attemptedFix}`)
    if (record.finalResolution) lines.push(`  - resolution: ${record.finalResolution}`)
  }
  return lines.join('\n')
}
