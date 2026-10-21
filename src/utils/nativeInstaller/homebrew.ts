import { realpathSync } from 'node:fs'
import { posix } from 'node:path'

export type HomebrewInstallation = {
  kind: 'formula' | 'cask'
  prefix: string
  name: string
  stableExecutable: string
}

// Match UR itself, rather than a Node/Bun runtime installed by Homebrew.
const names = '(ur|ur-agent|ur-nexus)'
const formulaPath = new RegExp(`^(.*)/(?:Cellar/${names}/[^/]+|opt/${names})/((?:libexec|bin)/ur)$`)
const caskPath = new RegExp(`^(.*)/Caskroom/${names}/[^/]+/(?:[^/]+/)*ur$`)

/** Parse only canonical absolute paths to a UR executable within a Brew keg. */
export function parseHomebrewExecutablePath(executable: string): HomebrewInstallation | null {
  if (!posix.isAbsolute(executable) || posix.normalize(executable) !== executable || /[\\\x00-\x1f\x7f]/.test(executable)) return null
  const formula = executable.match(formulaPath)
  if (formula) {
    const prefix = formula[1] || '/'
    const name = formula[2] ?? formula[3]!
    return { kind: 'formula', prefix, name, stableExecutable: posix.join(prefix, 'opt', name, formula[4]!) }
  }
  const cask = executable.match(caskPath)
  if (cask) {
    const prefix = cask[1] || '/'
    return { kind: 'cask', prefix, name: cask[2]!, stableExecutable: posix.join(prefix, 'bin', 'ur') }
  }
  return null
}

export function getHomebrewInstallation(executable = process.execPath): HomebrewInstallation | null {
  try {
    // Resolve bin/ur and opt symlinks. A misleading link to Homebrew's Node
    // runtime must not make an npm installation a Homebrew UR installation.
    return parseHomebrewExecutablePath(realpathSync(executable))
  } catch {
    // A running old keg can disappear during brew cleanup. Preserve its
    // package-manager ownership instead of starting a separate native install.
    return parseHomebrewExecutablePath(executable)
  }
}

export function getHomebrewUpgradeCommand(executable = process.execPath): string {
  const installation = getHomebrewInstallation(executable)
  return `brew upgrade ${installation?.kind === 'cask' ? '--cask ' : ''}${installation?.name ?? 'ur'}`
}

/** Persist a Brew-owned stable path only when it identifies this exact binary. */
export function getHomebrewStableExecutable(executable: string): string | null {
  const installation = getHomebrewInstallation(executable)
  if (!installation) return null
  try {
    return realpathSync(installation.stableExecutable) === realpathSync(executable)
      ? installation.stableExecutable
      : null
  } catch {
    return null
  }
}
