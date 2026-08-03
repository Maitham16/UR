// Git-related behaviors that depend on user settings.
//
// This lives outside git.ts because git.ts is in the vscode extension's
// dep graph and must stay free of settings.ts, which transitively pulls
// @opentelemetry/api + undici (forbidden in vscode). It's also a cycle:
// settings.ts → git/gitignore.ts → git.ts, so git.ts → settings.ts loops.
//
// If you're tempted to add `import settings` to git.ts — don't. Put it here.

import { getCwd } from './cwd.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { findGitRoot } from './git.js'
import { getInitialSettings } from './settings/settings.js'

export function shouldIncludeGitInstructions(): boolean {
  const envVal = process.env.UR_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(envVal)) return false
  if (isEnvDefinedFalsy(envVal)) return true
  if ((getInitialSettings().includeGitInstructions ?? true) === false) {
    return false
  }
  // Roughly 9KB of commit and pull-request guidance rode in the system prompt
  // on every turn regardless of whether the workspace was a repository at all.
  // Outside one there is nothing to commit and no PR to open, so the guidance
  // is unusable and only costs tokens. findGitRoot is synchronous and memoized
  // for exactly this hot path, so the check is effectively free.
  return findGitRoot(getCwd()) !== null
}
