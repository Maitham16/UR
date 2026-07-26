import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import {
  loadDesktopQaFixture,
  runDesktopQaFixture,
} from '../../services/qa/desktopQa.js'
import { desktopQaFixtureJsonSchema } from '../../services/qa/desktopQaSchema.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const FLAGS_WITH_VALUES = new Set(['--fixture', '--run-id'])

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (FLAGS_WITH_VALUES.has(token)) {
      index++
      continue
    }
    if (!token.startsWith('--')) values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur desktop-qa run <fixture.json> [--json] [--keep] [--run-id ID] [--allow-external]',
    '  ur desktop-qa validate <fixture.json> [--json]',
    '  ur desktop-qa list [--json]',
    '  ur desktop-qa init [fixture.json] [--force] [--allow-external]',
    '  ur desktop-qa schema [--json]',
    '  ur desktop-qa doctor [--json]',
  ].join('\n')
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  )
}

function existingAncestor(path: string): string {
  let current = path
  for (;;) {
    if (existsSync(current)) return realpathSync(current)
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

function initTargetAllowed(
  cwd: string,
  path: string,
  allowExternal: boolean,
): boolean {
  if (allowExternal) return true
  const workspace = realpathSync(cwd)
  return (
    pathIsWithin(workspace, resolve(path)) &&
    pathIsWithin(workspace, existingAncestor(dirname(path)))
  )
}

const EXAMPLE_FIXTURE = {
  version: 1,
  name: 'Desktop smoke test',
  driver: 'electron',
  launch: {
    executablePath: './path/to/your/electron-app',
    args: [],
  },
  ready: {
    selector: '[data-testid="app-ready"]',
    timeoutMs: 30_000,
  },
  steps: [
    {
      action: 'assertVisible',
      selector: '[data-testid="app-ready"]',
    },
    {
      action: 'screenshot',
      name: 'ready',
    },
  ],
  recording: {
    video: false,
    trace: false,
    screenshots: true,
    screenshotOnFailure: true,
    redactSelectors: ['input[type="password"]', '[data-sensitive]'],
  },
  timeoutMs: 120_000,
}

export type DesktopQaCommandDependencies = {
  runFixture?: typeof runDesktopQaFixture
  loadFixture?: typeof loadDesktopQaFixture
  driverAvailable?: () => Promise<boolean>
  setExitCode?: (code: number) => void
}

export async function runDesktopQaCommand(
  args: string,
  cwd: string,
  dependencies: DesktopQaCommandDependencies = {},
): Promise<LocalCommandResult> {
  const runFixture = dependencies.runFixture ?? runDesktopQaFixture
  const loadFixture = dependencies.loadFixture ?? loadDesktopQaFixture
  const failCi = (): void => {
    if (dependencies.setExitCode) dependencies.setExitCode(1)
    else process.exitCode = 1
  }
  const tokens = parseArguments(args ?? '')
  const positional = positionals(tokens)
  const action = positional[0] ?? 'list'
  const json = tokens.includes('--json')

  if (action === 'run') {
    const fixturePath = option(tokens, '--fixture') ?? positional[1]
    if (!fixturePath) {
      failCi()
      return { type: 'text', value: usage() }
    }
    try {
      const result = await runFixture(cwd, resolve(cwd, fixturePath), {
        keepRunDirectory: tokens.includes('--keep'),
        runId: option(tokens, '--run-id'),
        allowOutsideWorkspace: tokens.includes('--allow-external'),
      })
      if (result.report.status === 'failed') failCi()
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : `Desktop QA ${result.report.status}: ${result.report.fixture.name} (${result.report.steps.filter(step => step.status === 'passed').length}/${result.report.fixture.steps} steps). Evidence: ur artifacts show ${result.artifact.id}${result.runDirectory ? ` · raw run: ${result.runDirectory}` : ''}`,
      }
    } catch (error) {
      failCi()
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            )
          : `Desktop QA could not run: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  if (action === 'validate') {
    const fixturePath = option(tokens, '--fixture') ?? positional[1]
    if (!fixturePath) {
      failCi()
      return { type: 'text', value: usage() }
    }
    try {
      const fixture = loadFixture(resolve(cwd, fixturePath))
      return {
        type: 'text',
        value: json
          ? JSON.stringify({ valid: true, fixture }, null, 2)
          : `Valid desktop QA v${fixture.version} fixture: ${fixture.name} (${fixture.steps.length} steps).`,
      }
    } catch (error) {
      failCi()
      return {
        type: 'text',
        value: json
          ? JSON.stringify(
              {
                valid: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            )
          : error instanceof Error
            ? error.message
            : String(error),
      }
    }
  }

  if (action === 'init') {
    const path = resolve(
      cwd,
      positional[1] ?? '.ur/desktop-qa/fixtures/smoke.json',
    )
    if (
      !initTargetAllowed(cwd, path, tokens.includes('--allow-external'))
    ) {
      failCi()
      return {
        type: 'text',
        value:
          'Refusing to initialize a fixture outside the workspace; use --allow-external with an explicit path.',
      }
    }
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      failCi()
      return {
        type: 'text',
        value: `Refusing to replace a symlinked fixture: ${path}`,
      }
    }
    if (existsSync(path) && !tokens.includes('--force')) {
      failCi()
      return {
        type: 'text',
        value: `Fixture already exists: ${path} (use --force to replace it).`,
      }
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(EXAMPLE_FIXTURE, null, 2)}\n`, {
      mode: 0o600,
    })
    return { type: 'text', value: `Created desktop QA fixture: ${path}` }
  }

  if (action === 'list' || action === 'ls') {
    const directory = join(cwd, '.ur', 'desktop-qa', 'fixtures')
    const fixtures = existsSync(directory)
      ? readdirSync(directory)
          .filter(name => name.endsWith('.json'))
          .sort()
          .map(name => {
            try {
              const fixture = loadFixture(join(directory, name))
              return {
                file: name,
                valid: true,
                name: fixture.name,
                steps: fixture.steps.length,
              }
            } catch (error) {
              return {
                file: name,
                valid: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          })
      : []
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ fixtures }, null, 2)
        : fixtures.length
          ? fixtures
              .map(fixture =>
                fixture.valid
                  ? `${fixture.file}  ${fixture.steps} steps  ${fixture.name}`
                  : `${fixture.file}  invalid  ${fixture.error}`,
              )
              .join('\n')
          : 'No desktop QA fixtures. Create one with: ur desktop-qa init',
    }
  }

  if (action === 'schema') {
    return {
      type: 'text',
      value: JSON.stringify(desktopQaFixtureJsonSchema(), null, 2),
    }
  }

  if (action === 'doctor') {
    let available = false
    let detail = ''
    try {
      available = dependencies.driverAvailable
        ? await dependencies.driverAvailable()
        : Boolean((await import('playwright-core'))._electron)
      detail = available
        ? 'Playwright Electron driver is available. Supply launch.executablePath unless Electron is installed for this project.'
        : 'playwright-core loaded without an Electron driver.'
    } catch (error) {
      detail = `playwright-core could not load: ${error instanceof Error ? error.message : String(error)}`
    }
    if (!available) failCi()
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ available, detail }, null, 2)
        : `${available ? 'ready' : 'not ready'} — ${detail}`,
    }
  }

  failCi()
  return { type: 'text', value: usage() }
}

export const call: LocalCommandCall = args =>
  runDesktopQaCommand(args, getCwd())
