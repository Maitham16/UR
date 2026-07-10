import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  generateRepoMap,
  generateWiki,
  installPostMergeHook,
  repoMapPath,
  wikiDir,
} from '../../services/agents/repoWiki.js'
import { getCwd } from '../../utils/cwd.js'

export const call: LocalCommandCall = async (args: string): Promise<LocalCommandResult> => {
  const cwd = getCwd()
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'status'
  const quiet = tokens.includes('--quiet')
  const json = tokens.includes('--json')

  if (action === 'generate') {
    const { pages, dir } = generateWiki(cwd)
    if (quiet) return { type: 'text', value: '' }
    return {
      type: 'text',
      value: `Wiki generated: ${pages.map(p => join(dir, p)).join(', ')}\nRepo map refreshed: ${repoMapPath(cwd)} (injected into the system prompt while fresh).\nKeep it fresh automatically: ur wiki install-hook`,
    }
  }

  if (action === 'map') {
    return { type: 'text', value: generateRepoMap(cwd) }
  }

  if (action === 'install-hook') {
    const hook = installPostMergeHook(cwd)
    return {
      type: 'text',
      value: hook
        ? `Installed post-merge refresh: ${hook}`
        : 'No .git/hooks directory found — run inside a git repository.',
    }
  }

  const mapExists = existsSync(repoMapPath(cwd))
  const wikiExists = existsSync(join(wikiDir(cwd), 'index.md'))
  const status = {
    wiki: wikiExists ? wikiDir(cwd) : null,
    repoMap: mapExists ? repoMapPath(cwd) : null,
    repoMapAgeHours: mapExists
      ? Math.round((Date.now() - statSync(repoMapPath(cwd)).mtimeMs) / 3600_000)
      : null,
  }
  if (json) return { type: 'text', value: JSON.stringify(status, null, 2) }
  return {
    type: 'text',
    value: [
      `Wiki: ${status.wiki ?? 'not generated (ur wiki generate)'}`,
      `Repo map: ${status.repoMap ? `${status.repoMap} (${status.repoMapAgeHours}h old; injected while <7 days)` : 'not generated'}`,
    ].join('\n'),
  }
}
