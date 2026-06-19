export type CoordinateMode = 'pixels' | 'normalized'

export type CuSubGates = {
  pixelValidation: boolean
  clipboardPasteMultiline: boolean
  mouseAnimation: boolean
  hideBeforeAction: boolean
  autoTargetDisplay: boolean
  clipboardGuard: boolean
}

export type Logger = {
  silly(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export type ComputerUseHostAdapter = Record<string, any>
export type ComputerExecutor = Record<string, any>
export type DisplayGeometry = Record<string, any>
export type FrontmostApp = Record<string, any>
export type InstalledApp = Record<string, any>
export type ResolvePrepareCaptureResult = Record<string, any>
export type RunningApp = Record<string, any>
export type ScreenshotResult = Record<string, any>
export type ComputerUseSessionContext = Record<string, any>
export type CuCallToolResult = Record<string, any>
export type CuPermissionRequest = Record<string, any>
export type CuPermissionResponse = {
  granted: any[]
  denied: any[]
  flags: typeof DEFAULT_GRANT_FLAGS
}
export type ScreenshotDims = Record<string, any>
export type ComputerUseInputAPI = Record<string, any>
export type ComputerUseInput =
  | ({ isSupported: true } & ComputerUseInputAPI)
  | { isSupported: false }
export type ComputerUseAPI = Record<string, any>

export const DEFAULT_GRANT_FLAGS = {}
export const API_RESIZE_PARAMS = {}

export function targetImageSize(width: number, height: number): {
  width: number
  height: number
} {
  return { width, height }
}

export function bindSessionContext(): (
  name: string,
  args: unknown,
) => Promise<CuCallToolResult> {
  return async () => ({
    content: [
      {
        type: 'text',
        text: 'Computer use is not available in this package.',
      },
    ],
    telemetry: { error_kind: 'unavailable' },
  })
}

export function buildComputerUseTools(): Array<{ name: string }> {
  return []
}

export function createComputerUseMcpServer(): {
  setRequestHandler(schema: unknown, handler: unknown): void
  connect(transport: unknown): Promise<void>
} {
  return {
    setRequestHandler() {},
    async connect() {},
  }
}

export function getSentinelCategory(): null {
  return null
}
