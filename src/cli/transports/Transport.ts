import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

/** Common contract for the WebSocket, SSE, and hybrid remote transports. */
export interface Transport {
  connect(): Promise<void>
  write(message: StdoutMessage): Promise<void>
  close(): void
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
}
