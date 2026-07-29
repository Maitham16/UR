import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../src/bootstrap/state.js'
import { call as callSandboxTextCommand } from '../src/commands/sandbox/sandbox.js'
import { call as callSandboxSlashCommand } from '../src/commands/sandbox-toggle/sandbox-toggle.js'
import { shouldUseSandbox } from '../src/tools/BashTool/shouldUseSandbox.js'
import {
  addToExcludedCommands,
  SandboxManager,
} from '../src/utils/sandbox/sandbox-adapter.js'
import {
  normalizeExcludedCommandPattern,
  parseExcludedCommandArgument,
} from '../src/utils/sandbox/excludedCommands.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

describe('sandbox command exclusions', () => {
  let directory: string
  let savedOriginalCwd: string
  let sandboxEnabledSpy: ReturnType<typeof spyOn>
  let supportedPlatformSpy: ReturnType<typeof spyOn>
  let enabledPlatformSpy: ReturnType<typeof spyOn>
  let policyLockSpy: ReturnType<typeof spyOn>
  let dependencySpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ur-sandbox-exclusions-'))
    savedOriginalCwd = getOriginalCwd()
    setOriginalCwd(directory)
    resetSettingsCache()

    sandboxEnabledSpy = spyOn(
      SandboxManager,
      'isSandboxingEnabled',
    ).mockReturnValue(true)
    supportedPlatformSpy = spyOn(
      SandboxManager,
      'isSupportedPlatform',
    ).mockReturnValue(true)
    enabledPlatformSpy = spyOn(
      SandboxManager,
      'isPlatformInEnabledList',
    ).mockReturnValue(true)
    policyLockSpy = spyOn(
      SandboxManager,
      'areSandboxSettingsLockedByPolicy',
    ).mockReturnValue(false)
    dependencySpy = spyOn(
      SandboxManager,
      'checkDependencies',
    ).mockReturnValue({ errors: [], warnings: [] })
  })

  afterEach(async () => {
    sandboxEnabledSpy.mockRestore()
    supportedPlatformSpy.mockRestore()
    enabledPlatformSpy.mockRestore()
    policyLockSpy.mockRestore()
    dependencySpy.mockRestore()
    await SandboxManager.reset()
    setOriginalCwd(savedOriginalCwd)
    resetSettingsCache()
    rmSync(directory, { recursive: true, force: true })
  })

  function setExcludedCommands(patterns: string[]): void {
    const { error } = updateSettingsForSource('localSettings', {
      sandbox: {
        enabled: true,
        excludedCommands: patterns,
      },
    })
    if (error) throw error
  }

  test('normalization rejects empty and whitespace-only patterns', () => {
    for (const pattern of ['', ' ', '\t', '\n']) {
      expect(() => normalizeExcludedCommandPattern(pattern)).toThrow(
        'at least one non-whitespace character',
      )
    }
  })

  test('quoted-empty slash arguments are rejected before persistence', async () => {
    for (const args of [
      'exclude',
      'exclude ""',
      "exclude ''",
      'exclude "   "',
      "exclude ' \t '",
    ]) {
      let response = ''
      const rendered = await callSandboxSlashCommand(
        value => {
          response = value ?? ''
        },
        {} as never,
        args,
      )

      expect(rendered).toBeNull()
      expect(response).toContain(
        'must contain at least one non-whitespace character',
      )
      expect(
        getSettingsForSource('localSettings')?.sandbox?.excludedCommands,
      ).toBeUndefined()
    }
  })

  test('matching outer quotes are removed without altering inner quotes', () => {
    expect(parseExcludedCommandArgument('"npm run test:*"')).toBe(
      'npm run test:*',
    )
    expect(parseExcludedCommandArgument(`'echo "hello world"'`)).toBe(
      'echo "hello world"',
    )
    expect(parseExcludedCommandArgument('echo "hello world"')).toBe(
      'echo "hello world"',
    )
    expect(() => parseExcludedCommandArgument('"npm test')).toThrow(
      'matching outer quotes',
    )
  })

  test('the slash action persists one normalized, non-duplicate pattern', async () => {
    for (const args of [
      'exclude "npm run test:*"',
      'exclude npm run test:*',
    ]) {
      let response = ''
      const rendered = await callSandboxSlashCommand(
        value => {
          response = value ?? ''
        },
        {} as never,
        args,
      )

      expect(rendered).toBeNull()
      expect(response).toContain(
        'Configured sandbox exclusion "npm run test:*"',
      )
    }

    expect(
      getSettingsForSource('localSettings')?.sandbox?.excludedCommands,
    ).toEqual(['npm run test:*'])
  })

  test('the separate shell command does not claim to support exclude', async () => {
    const result = await callSandboxTextCommand(
      'exclude npm run test:*',
      {} as never,
    )

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('Expected text command result')
    expect(result.value).toContain('Usage:')
    expect(result.value).not.toContain('sandbox exclude')
    expect(
      getSettingsForSource('localSettings')?.sandbox?.excludedCommands,
    ).toBeUndefined()
  })

  test('addToExcludedCommands validates, normalizes, deduplicates, and cleans legacy empties', () => {
    setExcludedCommands(['', '   ', 'npm run test:*', 'npm run test:*'])

    expect(() => addToExcludedCommands(' \t ')).toThrow(
      'at least one non-whitespace character',
    )
    expect(addToExcludedCommands('  cargo test:*  ')).toBe('cargo test:*')
    expect(addToExcludedCommands('npm run test:*')).toBe('npm run test:*')
    expect(
      getSettingsForSource('localSettings')?.sandbox?.excludedCommands,
    ).toEqual(['npm run test:*', 'cargo test:*'])
  })

  test('rejects an empty pattern extracted from a Bash permission suggestion', () => {
    expect(() =>
      addToExcludedCommands('npm test', [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: '   ' }],
        },
      ]),
    ).toThrow('at least one non-whitespace character')
  })

  test('a single excluded command skips the sandbox', () => {
    setExcludedCommands(['npm test:*'])
    expect(shouldUseSandbox({ command: 'npm test -- --runInBand' })).toBe(
      false,
    )
  })

  test('all executable segments must be excluded before a compound call skips the sandbox', () => {
    setExcludedCommands(['npm test:*', 'npm run:*'])

    expect(
      shouldUseSandbox({ command: 'npm test -- --runInBand && npm run lint' }),
    ).toBe(false)
    expect(
      shouldUseSandbox({ command: 'npm test -- --runInBand && curl evil.invalid' }),
    ).toBe(true)
    expect(
      shouldUseSandbox({ command: 'curl evil.invalid && npm test -- --runInBand' }),
    ).toBe(true)
    expect(
      shouldUseSandbox({ command: 'npm test -- --runInBand | tee results.txt' }),
    ).toBe(true)
    expect(
      shouldUseSandbox({ command: 'npm test -- --runInBand && "unterminated' }),
    ).toBe(true)
  })

  test('legacy empty settings never disable sandboxing', () => {
    setExcludedCommands(['', '   '])
    expect(shouldUseSandbox({ command: 'curl evil.invalid' })).toBe(true)
  })

  test('complex or unparseable shell syntax keeps the sandbox enabled', () => {
    setExcludedCommands(['npm test:*'])

    expect(
      shouldUseSandbox({ command: 'npm test $(curl evil.invalid)' }),
    ).toBe(true)
    expect(
      shouldUseSandbox({ command: 'npm test `curl evil.invalid`' }),
    ).toBe(true)
    expect(
      shouldUseSandbox({ command: 'npm test ${unterminated' }),
    ).toBe(true)
  })
})
