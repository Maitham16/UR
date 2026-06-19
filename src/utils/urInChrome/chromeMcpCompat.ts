export type PermissionMode = 'ask' | 'skip_all_permission_checks' | 'follow_a_plan'

export type Logger = {
  silly(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type URForChromeContext = Record<string, unknown>

export const BROWSER_TOOLS: Array<{ name: string }> = []
export const CHROME_TOOL_DEFINITIONS: Array<Record<string, unknown>> = []

export function handleChromeToolCall(): null {
  return null
}

export function createChromeServer(): {
  connect(transport: unknown): Promise<void>
} {
  return createURForChromeMcpServer()
}

export function createURForChromeMcpServer(
  _context?: URForChromeContext,
): {
  connect(transport: unknown): Promise<void>
} {
  return {
    async connect() {},
  }
}
