import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import { sanitizeExcludedCommandPatterns } from '../../utils/sandbox/excludedCommands.js'
import {
  BINARY_HIJACK_VARS,
  bashPermissionRule,
  matchWildcardPattern,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
} from './bashPermissions.js'

type SandboxInput = {
  command?: string
  dangerouslyDisableSandbox?: boolean
}

function hasUnescapedBacktick(command: string): boolean {
  for (let index = 0; index < command.length; index++) {
    if (command[index] !== '`') continue
    let precedingBackslashes = 0
    for (
      let backslashIndex = index - 1;
      backslashIndex >= 0 && command[backslashIndex] === '\\';
      backslashIndex--
    ) {
      precedingBackslashes++
    }
    if (precedingBackslashes % 2 === 0) return true
  }
  return false
}

// NOTE: excludedCommands is a user-facing convenience feature, not a permission
// grant. Permission prompts remain the primary security control, but exclusions
// still fail safe because they deliberately weaken OS isolation.
function containsExcludedCommand(command: string): boolean {
  let disabledCommands: {
    commands: string[]
    substrings: string[]
  } = { commands: [], substrings: [] }

  // Load dynamic exclusions (only for ants). They follow the same all-segment
  // rule as user settings below.
  if (process.env.USER_TYPE === 'ant') {
    disabledCommands = getFeatureValue_CACHED_MAY_BE_STALE<{
      commands: string[]
      substrings: string[]
    }>('tengu_sandbox_disabled_commands', { commands: [], substrings: [] })
    disabledCommands = {
      commands: sanitizeExcludedCommandPatterns(disabledCommands.commands),
      substrings: sanitizeExcludedCommandPatterns(disabledCommands.substrings),
    }
  }

  // Check user-configured excluded commands from settings
  const settings = getSettings_DEPRECATED()
  const userExcludedCommands = sanitizeExcludedCommandPatterns(
    settings.sandbox?.excludedCommands ?? [],
  )

  if (
    userExcludedCommands.length === 0 &&
    disabledCommands.commands.length === 0 &&
    disabledCommands.substrings.length === 0
  ) {
    return false
  }

  // Exclusions weaken isolation, so do not apply them to syntax that this
  // legacy synchronous splitter cannot fully enumerate. In particular,
  // command/process substitutions execute nested commands that must not hide
  // behind an excluded outer prefix.
  const parseResult = tryParseShellCommand(command, key => `$${key}`)
  if (
    !parseResult.success ||
    command.includes('$(') ||
    command.includes('<(') ||
    command.includes('>(') ||
    hasUnescapedBacktick(command)
  ) {
    return false
  }

  // Split compound commands (e.g. "docker ps && curl evil.com") into individual
  // executable subcommands. A shell call is excluded only when EVERY segment
  // matches: one allowed segment must never pull unrelated work out of the
  // sandbox with it.
  let subcommands: string[]
  try {
    subcommands = splitCommand_DEPRECATED(command)
      .map(subcommand => subcommand.trim())
      .filter(Boolean)
  } catch {
    // Matching is a sandbox-weakening exception, so parse failures fail safe.
    return false
  }
  if (subcommands.length === 0) return false

  return subcommands.every(subcommand => {
    const trimmed = subcommand
    if (
      disabledCommands.substrings.some(substring =>
        trimmed.includes(substring),
      )
    ) {
      return true
    }
    const baseCommand = trimmed.split(/\s+/, 1)[0]
    if (
      baseCommand &&
      disabledCommands.commands.includes(baseCommand)
    ) {
      return true
    }

    // Also try matching with env var prefixes and wrapper commands stripped, so
    // that `FOO=bar bazel ...` and `timeout 30 bazel ...` match `bazel:*`. Not a
    // permission boundary (see NOTE at top). A separate
    // `export FOO=bar && bazel ...` segment remains sandboxed unless the export
    // segment is independently excluded. BINARY_HIJACK_VARS is retained as a
    // same-segment heuristic.
    //
    // We iteratively apply both stripping operations until no new candidates are
    // produced (fixed-point), matching the approach in filterRulesByContentsMatchingInput.
    // This handles interleaved patterns like `timeout 300 FOO=bar bazel run`
    // where single-pass composition would fail.
    const candidates = [trimmed]
    const seen = new Set(candidates)
    let startIdx = 0
    while (startIdx < candidates.length) {
      const endIdx = candidates.length
      for (let i = startIdx; i < endIdx; i++) {
        const cmd = candidates[i]!
        const envStripped = stripAllLeadingEnvVars(cmd, BINARY_HIJACK_VARS)
        if (!seen.has(envStripped)) {
          candidates.push(envStripped)
          seen.add(envStripped)
        }
        const wrapperStripped = stripSafeWrappers(cmd)
        if (!seen.has(wrapperStripped)) {
          candidates.push(wrapperStripped)
          seen.add(wrapperStripped)
        }
      }
      startIdx = endIdx
    }

    for (const pattern of userExcludedCommands) {
      const rule = bashPermissionRule(pattern)
      for (const cand of candidates) {
        switch (rule.type) {
          case 'prefix':
            if (cand === rule.prefix || cand.startsWith(rule.prefix + ' ')) {
              return true
            }
            break
          case 'exact':
            if (cand === rule.command) {
              return true
            }
            break
          case 'wildcard':
            if (matchWildcardPattern(rule.pattern, cand)) {
              return true
            }
            break
        }
      }
    }
    return false
  })
}

export function shouldUseSandbox(input: Partial<SandboxInput>): boolean {
  if (!SandboxManager.isSandboxingEnabled()) {
    return false
  }

  // Don't sandbox if explicitly overridden AND unsandboxed commands are allowed by policy
  if (
    input.dangerouslyDisableSandbox &&
    SandboxManager.areUnsandboxedCommandsAllowed()
  ) {
    return false
  }

  if (!input.command) {
    return false
  }

  // Don't sandbox if the command contains user-configured excluded commands
  if (containsExcludedCommand(input.command)) {
    return false
  }

  return true
}
