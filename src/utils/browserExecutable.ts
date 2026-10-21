import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Shared by interactive Browser and fixture QA; neither downloads software silently. */
export function findBrowserExecutable(chromium: { executablePath(): string }): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (configured) {
    if (!existsSync(configured)) throw new Error(`Configured browser executable does not exist: ${configured}`)
    return configured
  }
  const candidates = [
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ...(process.platform === 'win32' ? [
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ] : []),
  ]
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const binary of ['google-chrome', 'chromium', 'chromium-browser', 'msedge']) candidates.push(join(directory, binary))
  }
  return candidates.find(candidate => candidate && existsSync(candidate))
}
