import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  BrowserContext,
  ElectronApplication,
  Page,
} from 'playwright-core'
import { isSecretLikeSubprocessEnvName } from '../../utils/subprocessEnv.js'
import {
  desktopQaRecordingPrivacyError,
  type DesktopQaFixture,
} from './desktopQaSchema.js'

export type DesktopQaDiagnostic = {
  at: string
  level: 'debug' | 'info' | 'warning' | 'error'
  source: 'renderer' | 'main' | 'runner'
  text: string
}

export interface DesktopQaDriverSession {
  click(selector: string, timeoutMs: number): Promise<void>
  fill(selector: string, value: string, timeoutMs: number): Promise<void>
  press(
    selector: string | undefined,
    key: string,
    timeoutMs: number,
  ): Promise<void>
  select(selector: string, value: string, timeoutMs: number): Promise<void>
  check(selector: string, checked: boolean, timeoutMs: number): Promise<void>
  waitFor(
    selector: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<void>
  assertText(
    selector: string,
    expected: string,
    exact: boolean,
    timeoutMs: number,
  ): Promise<void>
  assertVisible(
    selector: string,
    visible: boolean,
    timeoutMs: number,
  ): Promise<void>
  screenshot(
    path: string,
    options: {
      fullPage: boolean
      timeoutMs: number
      redactSelectors: string[]
    },
  ): Promise<void>
  diagnostics(): DesktopQaDiagnostic[]
  close(): Promise<void>
}

export interface DesktopQaDriver {
  readonly name: 'electron'
  launch(
    fixture: DesktopQaFixture,
    options: { cwd: string; runDir: string },
  ): Promise<DesktopQaDriverSession>
}

const EXTRA_PRIVATE_ENV_NAMES = new Set([
  'SSH_AUTH_SOCK',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'DOCKER_AUTH_CONFIG',
  'KUBECONFIG',
])

/**
 * Desktop fixtures execute application code, so they receive only ordinary
 * process configuration by default. A fixture can deliberately inject a
 * credential under launch.env, but ambient provider/GitHub/agent credentials
 * never cross this boundary accidentally.
 */
export function buildDesktopQaEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  explicit: Record<string, string> = {},
): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (
      typeof value !== 'string' ||
      isSecretLikeSubprocessEnvName(name) ||
      EXTRA_PRIVATE_ENV_NAMES.has(name)
    ) {
      continue
    }
    safe[name] = value
  }
  return { ...safe, ...explicit }
}

function pathFrom(base: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  return isAbsolute(value) ? value : resolve(base, value)
}

function boundedDiagnosticText(value: string): string {
  return value.replace(/\u0000/gu, '').slice(0, 4_096)
}

class ElectronDesktopQaSession implements DesktopQaDriverSession {
  private readonly entries: DesktopQaDiagnostic[] = []
  private closed = false

  constructor(
    private readonly app: ElectronApplication,
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly tracePath: string | null,
  ) {
    const registerPage = (window: Page): void => {
      window.on('console', message => {
        this.addDiagnostic(
          message.type() === 'error'
            ? 'error'
            : message.type() === 'warning'
              ? 'warning'
              : 'info',
          'renderer',
          message.text(),
        )
      })
      window.on('pageerror', error => {
        this.addDiagnostic('error', 'renderer', error.message)
      })
    }
    registerPage(page)
    app.on('window', window => {
      if (window !== page) registerPage(window)
    })
    app.on('console', message => {
      this.addDiagnostic(
        message.type() === 'error'
          ? 'error'
          : message.type() === 'warning'
            ? 'warning'
            : 'info',
        'main',
        message.text(),
      )
    })
  }

  private addDiagnostic(
    level: DesktopQaDiagnostic['level'],
    source: DesktopQaDiagnostic['source'],
    text: string,
  ): void {
    if (this.entries.length >= 250) return
    this.entries.push({
      at: new Date().toISOString(),
      level,
      source,
      text: boundedDiagnosticText(text),
    })
  }

  click(selector: string, timeoutMs: number): Promise<void> {
    return this.page.locator(selector).click({ timeout: timeoutMs })
  }

  fill(selector: string, value: string, timeoutMs: number): Promise<void> {
    return this.page.locator(selector).fill(value, { timeout: timeoutMs })
  }

  async press(
    selector: string | undefined,
    key: string,
    timeoutMs: number,
  ): Promise<void> {
    if (selector) {
      await this.page.locator(selector).press(key, { timeout: timeoutMs })
    } else {
      await this.page.keyboard.press(key)
    }
  }

  async select(
    selector: string,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.page
      .locator(selector)
      .selectOption({ value }, { timeout: timeoutMs })
  }

  async check(
    selector: string,
    checked: boolean,
    timeoutMs: number,
  ): Promise<void> {
    const locator = this.page.locator(selector)
    if (checked) await locator.check({ timeout: timeoutMs })
    else await locator.uncheck({ timeout: timeoutMs })
  }

  waitFor(
    selector: string,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<void> {
    return this.page.locator(selector).waitFor({ state, timeout: timeoutMs })
  }

  async assertText(
    selector: string,
    expected: string,
    exact: boolean,
    timeoutMs: number,
  ): Promise<void> {
    const locator = this.page.locator(selector)
    const deadline = Date.now() + timeoutMs
    let actual = ''
    let lastError: unknown
    while (Date.now() <= deadline) {
      try {
        actual = (await locator.textContent({ timeout: Math.min(1_000, timeoutMs) })) ?? ''
        if (exact ? actual === expected : actual.includes(expected)) return
      } catch (error) {
        lastError = error
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
    }
    if (lastError && !actual) throw lastError
    throw new Error(
      `Expected ${selector} text to ${exact ? 'equal' : 'contain'} ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }

  assertVisible(
    selector: string,
    visible: boolean,
    timeoutMs: number,
  ): Promise<void> {
    return this.page
      .locator(selector)
      .waitFor({ state: visible ? 'visible' : 'hidden', timeout: timeoutMs })
  }

  async screenshot(
    path: string,
    options: {
      fullPage: boolean
      timeoutMs: number
      redactSelectors: string[]
    },
  ): Promise<void> {
    await this.page.screenshot({
      path,
      fullPage: options.fullPage,
      timeout: options.timeoutMs,
      animations: 'disabled',
      mask: options.redactSelectors.map(selector => this.page.locator(selector)),
      maskColor: '#000000',
    })
  }

  diagnostics(): DesktopQaDiagnostic[] {
    return this.entries.map(entry => ({ ...entry }))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.tracePath) {
      try {
        await this.context.tracing.stop({ path: this.tracePath })
      } catch (error) {
        this.addDiagnostic(
          'warning',
          'runner',
          `Unable to finalize trace: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    try {
      await this.app.close()
    } catch (error) {
      this.addDiagnostic(
        'warning',
        'runner',
        `Unable to close Electron cleanly: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

export const electronDesktopQaDriver: DesktopQaDriver = {
  name: 'electron',

  async launch(
    fixture: DesktopQaFixture,
    options: { cwd: string; runDir: string },
  ): Promise<DesktopQaDriverSession> {
    const privacyError = desktopQaRecordingPrivacyError(fixture.recording)
    if (privacyError) throw new Error(privacyError)
    const { _electron } = await import('playwright-core')
    const videoDir = join(options.runDir, 'video')
    mkdirSync(options.runDir, { recursive: true, mode: 0o700 })
    if (fixture.recording.video) {
      mkdirSync(videoDir, { recursive: true, mode: 0o700 })
    }
    const launchCwd =
      pathFrom(options.cwd, fixture.launch.cwd) ?? options.cwd
    const app = await _electron.launch({
      executablePath: pathFrom(options.cwd, fixture.launch.executablePath),
      args: fixture.launch.args,
      cwd: launchCwd,
      env: buildDesktopQaEnvironment(process.env, fixture.launch.env),
      timeout: fixture.launch.timeoutMs,
      artifactsDir: options.runDir,
      acceptDownloads: false,
      ...(fixture.recording.video
        ? { recordVideo: { dir: videoDir } }
        : {}),
    })
    try {
      const page = await app.firstWindow({
        timeout: fixture.launch.timeoutMs,
      })
      page.setDefaultTimeout(Math.min(fixture.timeoutMs, 120_000))
      const context = page.context()
      const tracePath = fixture.recording.trace
        ? join(options.runDir, 'trace.zip')
        : null
      if (tracePath) {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: false,
          title: fixture.name,
        })
      }
      return new ElectronDesktopQaSession(app, page, context, tracePath)
    } catch (error) {
      await app.close().catch(() => undefined)
      throw error
    }
  },
}
