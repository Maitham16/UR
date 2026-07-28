import {
  formatMemoryIntegrity,
  quarantineMemoryStore,
  recordManifest,
  verifyMemoryStore,
} from '../../memdir/memoryIntegrity.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { getTeamMemPath } from '../../memdir/teamMemPaths.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'

function resolveStores(selector: string | undefined): string[] {
  // Both stores by default: verifying only one would leave the other silently
  // unchecked, which is the state this command exists to end.
  if (!selector || selector === 'all') {
    return [safe(getAutoMemPath), safe(getTeamMemPath)].filter(Boolean) as string[]
  }
  if (selector === 'auto') return [safe(getAutoMemPath)].filter(Boolean) as string[]
  if (selector === 'team') return [safe(getTeamMemPath)].filter(Boolean) as string[]
  return [selector]
}

function safe(get: () => string): string | null {
  try {
    return get()
  } catch {
    return null
  }
}

export const call: LocalCommandCall = async args => {
  const tokens = parseArguments(args ?? '')
  const json = tokens.includes('--json')
  const action = tokens.find(t => !t.startsWith('--')) ?? 'verify'
  const storeIndex = tokens.indexOf('--store')
  const stores = resolveStores(storeIndex >= 0 ? tokens[storeIndex + 1] : undefined)

  if (stores.length === 0) {
    return { type: 'text', value: 'No memory store paths could be resolved.' }
  }

  if (action === 'record') {
    const recorded = stores.map(dir => ({ dir, files: Object.keys(recordManifest(dir).files).length }))
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ recorded }, null, 2)
        : recorded
            .map(r => `Recorded ${r.files} file(s) as the baseline for ${r.dir}`)
            .join('\n'),
    }
  }

  if (action === 'quarantine') {
    const results = stores.map(dir => ({ dir, ...quarantineMemoryStore(dir) }))
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ results }, null, 2)
        : results
            .map(r =>
              r.quarantined.length === 0
                ? `${r.dir}: nothing to quarantine`
                : `${r.dir}: quarantined ${r.quarantined.length} file(s) to ${r.quarantineDir}`,
            )
            .join('\n'),
    }
  }

  const reports = stores.map(dir => verifyMemoryStore(dir))
  // Exit non-zero on evidence of tampering, not on absence of evidence. An
  // empty or unbaselined store is not "valid" — zero files checked proves
  // nothing — but failing the command for it would fire on every fresh
  // install and train the user to ignore the exit code.
  const tampered = reports.some(
    report =>
      report.counts.modified > 0 ||
      report.counts.missing > 0 ||
      report.counts.untracked > 0 ||
      // A forged manifest updates the digests to match the files it altered,
      // so every count reads zero — the signature is the only thing that
      // catches it, and it is the most serious finding of all.
      report.signature === 'invalid' ||
      // Signed but uncheckable is not a pass either: nothing can be vouched
      // for without the key.
      report.signature === 'unverifiable',
  )
  if (tampered) process.exitCode = 1
  return {
    type: 'text',
    value: json
      ? JSON.stringify({ stores: reports }, null, 2)
      : reports.map(report => formatMemoryIntegrity(report, false)).join('\n\n'),
  }
}
