// @ts-nocheck
import { randomUUID } from 'crypto'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5
const PING_INTERVAL_MS = 30000
const MAX_QUEUED_CONTROL_RESPONSES = 100
export const MAX_QUEUED_CONTROL_RESPONSE_BYTES = 8 * 1024 * 1024

export function buildSessionsWebSocketUrl(
  baseUrl: string,
  sessionId: string,
  orgUuid: string,
): string {
  const url = new URL(baseUrl)
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(
      `[SessionsWebSocket] Unsupported API URL protocol: ${url.protocol}`,
    )
  }

  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}/v1/sessions/ws/${encodeURIComponent(sessionId)}/subscribe`
  url.search = ''
  url.hash = ''
  url.searchParams.set('organization_uuid', orgUuid)
  return url.toString()
}

/**
 * Maximum retries for 4001 (session not found). During compaction the
 * server may briefly consider the session stale; a short retry window
 * lets the client recover without giving up permanently.
 */
const MAX_SESSION_NOT_FOUND_RETRIES = 3

/**
 * WebSocket close codes that indicate a permanent server-side rejection.
 * The client stops reconnecting immediately.
 * Note: 4001 (session not found) is handled separately with limited
 * retries since it can be transient during compaction.
 */
const PERMANENT_CLOSE_CODES = new Set([
  4003, // unauthorized
])

type WebSocketState = 'connecting' | 'connected' | 'closed'

type SessionsMessage =
  | SDKMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest

function isSessionsMessage(value: unknown): value is SessionsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }
  // Accept any message with a string `type` field. Downstream handlers
  // (sdkMessageAdapter, RemoteSessionManager) decide what to do with
  // unknown types. A hardcoded allowlist here would silently drop new
  // message types the backend starts sending before the client is updated.
  return typeof value.type === 'string'
}

export type SessionsWebSocketCallbacks = {
  onMessage: (message: SessionsMessage) => void
  onClose?: () => void
  onError?: (error: Error) => void
  onConnected?: () => void
  /** Fired when a transient close is detected and a reconnect is scheduled.
   *  onClose fires only for permanent close (server ended / attempts exhausted). */
  onReconnecting?: () => void
}

export type SessionsWebSocketOptions = {
  /** Test hook for deterministic reconnect scheduling. */
  scheduleReconnect?: (
    callback: () => void,
    delayMs: number,
  ) => NodeJS.Timeout
  /** Paired with scheduleReconnect when a scheduled retry is cancelled. */
  clearReconnect?: (timer: NodeJS.Timeout) => void
}

// Common interface between globalThis.WebSocket and ws.WebSocket
type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void // Bun & ws both support this
}

/**
 * WebSocket client for connecting to CCR sessions via /v1/sessions/ws/{id}/subscribe
 *
 * Protocol:
 * 1. Connect to the configured CCR sessions WebSocket endpoint
 * 2. Send auth message: { type: 'auth', credential: { type: 'oauth', token: '...' } }
 * 3. Receive SDKMessage stream from the session
 */
export class SessionsWebSocket {
  private ws: WebSocketLike | null = null
  private state: WebSocketState = 'closed'
  private reconnectAttempts = 0
  private sessionNotFoundRetries = 0
  private pingInterval: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private queuedControlResponses = new Map<
    string,
    { payload: string; bytes: number }
  >()
  private queuedControlResponseBytes = 0

  constructor(
    private readonly sessionId: string,
    private readonly orgUuid: string,
    private readonly getAccessToken: () => string,
    private readonly callbacks: SessionsWebSocketCallbacks,
    private readonly options: SessionsWebSocketOptions = {},
  ) {}

  /**
   * Connect to the sessions WebSocket endpoint
   */
  async connect(): Promise<void> {
    if (this.state !== 'closed') {
      logForDebugging(
        `[SessionsWebSocket] Already ${this.state}, skipping duplicate connect`,
      )
      return
    }

    this.state = 'connecting'

    try {
      await this.openConnection()
    } catch (error) {
      const connectionError =
        error instanceof Error ? error : new Error(errorMessage(error))
      logError(
        new Error(
          `[SessionsWebSocket] Connection setup failed: ${connectionError.message}`,
        ),
      )
      this.callbacks.onError?.(connectionError)

      const failedSocket = this.ws
      this.handleClose(1006, failedSocket ?? undefined)
      try {
        failedSocket?.close()
      } catch {
        // The constructor or listener setup may have left a partial socket.
      }
    }
  }

  private async openConnection(): Promise<void> {
    const url = buildSessionsWebSocketUrl(
      getOauthConfig().BASE_API_URL,
      this.sessionId,
      this.orgUuid,
    )

    logForDebugging(`[SessionsWebSocket] Connecting to ${url}`)

    // Get fresh token for each connection attempt
    const accessToken = this.getAccessToken()
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'urhq-version': '2023-06-01',
    }

    if (typeof Bun !== 'undefined') {
      // Bun's WebSocket supports headers/proxy options but the DOM typings don't
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const ws = new globalThis.WebSocket(url, {
        headers,
        proxy: getWebSocketProxyUrl(url),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws

      ws.addEventListener('open', () => this.handleOpen(ws))

      ws.addEventListener('message', (event: MessageEvent) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data)
        this.handleMessage(data)
      })

      ws.addEventListener('error', () => {
        const err = new Error('[SessionsWebSocket] WebSocket error')
        logError(err)
        this.callbacks.onError?.(err)
      })

      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ws.addEventListener('close', (event: CloseEvent) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${event.code} reason=${event.reason}`,
        )
        this.handleClose(event.code, ws)
      })

      ws.addEventListener('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
    } else {
      const { default: WS } = await import('ws')
      if (this.state !== 'connecting') return

      const ws = new WS(url, {
        headers,
        agent: getWebSocketProxyAgent(url),
        ...getWebSocketTLSOptions(),
      })
      this.ws = ws

      ws.on('open', () => this.handleOpen(ws))

      ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      ws.on('error', (err: Error) => {
        logError(new Error(`[SessionsWebSocket] Error: ${err.message}`))
        this.callbacks.onError?.(err)
      })

      ws.on('close', (code: number, reason: Buffer) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${code} reason=${reason.toString()}`,
        )
        this.handleClose(code, ws)
      })

      ws.on('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
    }
  }

  private handleOpen(ws: WebSocketLike): void {
    if (this.ws !== ws || this.state !== 'connecting') {
      ws.close()
      return
    }

    logForDebugging(
      '[SessionsWebSocket] Connection opened, authenticated via headers',
    )
    this.state = 'connected'
    this.reconnectAttempts = 0
    this.startPingInterval()

    if (!this.flushQueuedControlResponses()) {
      const error = new Error(
        '[SessionsWebSocket] Failed to flush queued control responses',
      )
      logError(error)
      this.callbacks.onError?.(error)
      this.handleClose(1006, ws)
      try {
        ws.close()
      } catch {
        // handleClose already scheduled a retry.
      }
      return
    }

    this.callbacks.onConnected?.()
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: unknown = jsonParse(data)

      // Forward SDK messages to callback
      if (isSessionsMessage(message)) {
        // A successfully decoded session message proves that the subscription
        // is usable. Merely reaching WebSocket OPEN does not: the server can
        // accept the upgrade and immediately close it with 4001. Resetting the
        // budget in handleOpen therefore made repeated 4001 responses retry
        // forever instead of honoring MAX_SESSION_NOT_FOUND_RETRIES.
        this.sessionNotFoundRetries = 0
        this.callbacks.onMessage(message)
      } else {
        logForDebugging(
          `[SessionsWebSocket] Ignoring message type: ${typeof message === 'object' && message !== null && 'type' in message ? String(message.type) : 'unknown'}`,
        )
      }
    } catch (error) {
      logError(
        new Error(
          `[SessionsWebSocket] Failed to parse message: ${errorMessage(error)}`,
        ),
      )
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(
    closeCode: number,
    source?: WebSocketLike,
  ): void {
    if (source && this.ws !== source) {
      return
    }

    this.stopPingInterval()

    if (this.state === 'closed') {
      return
    }

    this.ws = null

    const previousState = this.state
    this.state = 'closed'

    // Permanent codes: stop reconnecting — server has definitively ended the session
    if (PERMANENT_CLOSE_CODES.has(closeCode)) {
      logForDebugging(
        `[SessionsWebSocket] Permanent close code ${closeCode}, not reconnecting`,
      )
      this.discardQueuedControlResponses('permanent close')
      this.callbacks.onClose?.()
      return
    }

    // 4001 (session not found) can be transient during compaction: the
    // server may briefly consider the session stale while the CLI worker
    // is busy with the compaction API call and not emitting events.
    if (closeCode === 4001) {
      this.sessionNotFoundRetries++
      if (this.sessionNotFoundRetries > MAX_SESSION_NOT_FOUND_RETRIES) {
        logForDebugging(
          `[SessionsWebSocket] 4001 retry budget exhausted (${MAX_SESSION_NOT_FOUND_RETRIES}), not reconnecting`,
        )
        this.discardQueuedControlResponses('session-not-found retry exhaustion')
        this.callbacks.onClose?.()
        return
      }
      this.scheduleReconnect(
        RECONNECT_DELAY_MS * this.sessionNotFoundRetries,
        `4001 attempt ${this.sessionNotFoundRetries}/${MAX_SESSION_NOT_FOUND_RETRIES}`,
      )
      return
    }

    // Retry both dropped established sockets and handshakes that closed before
    // reaching OPEN. The latter is the normal shape of ECONNREFUSED/DNS/TLS
    // failures and must not leave the initial connection permanently dead.
    if (
      (previousState === 'connecting' || previousState === 'connected') &&
      this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      this.reconnectAttempts++
      this.scheduleReconnect(
        RECONNECT_DELAY_MS,
        `attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
      )
    } else {
      logForDebugging('[SessionsWebSocket] Not reconnecting')
      this.discardQueuedControlResponses('reconnect retry exhaustion')
      this.callbacks.onClose?.()
    }
  }

  private scheduleReconnect(delay: number, label: string): void {
    if (this.reconnectTimer) {
      logForDebugging('[SessionsWebSocket] Reconnect already scheduled')
      return
    }
    logForDebugging(
      `[SessionsWebSocket] Scheduling reconnect (${label}) in ${delay}ms`,
    )
    const schedule = this.options.scheduleReconnect ?? setTimeout
    this.reconnectTimer = schedule(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
    this.callbacks.onReconnecting?.()
  }

  private startPingInterval(): void {
    this.stopPingInterval()

    this.pingInterval = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        try {
          this.ws.ping?.()
        } catch {
          // Ignore ping errors, close handler will deal with connection issues
        }
      }
    }, PING_INTERVAL_MS)
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private controlResponseKey(response: SDKControlResponse): string {
    if (typeof response.request_id === 'string') {
      return response.request_id
    }
    if (
      typeof response.response === 'object' &&
      response.response !== null &&
      'request_id' in response.response &&
      typeof response.response.request_id === 'string'
    ) {
      return response.response.request_id
    }
    return randomUUID()
  }

  private enqueueControlResponse(key: string, payload: string): boolean {
    const payloadBytes = Buffer.byteLength(payload, 'utf8')
    const previousBytes = this.queuedControlResponses.get(key)?.bytes ?? 0
    const nextTotalBytes =
      this.queuedControlResponseBytes - previousBytes + payloadBytes
    if (
      !this.queuedControlResponses.has(key) &&
      this.queuedControlResponses.size >= MAX_QUEUED_CONTROL_RESPONSES
    ) {
      logError(
        new Error(
          `[SessionsWebSocket] Control response queue is full (${MAX_QUEUED_CONTROL_RESPONSES})`,
        ),
      )
      return false
    }
    if (nextTotalBytes > MAX_QUEUED_CONTROL_RESPONSE_BYTES) {
      logError(
        new Error(
          `[SessionsWebSocket] Control response queue exceeds ${MAX_QUEUED_CONTROL_RESPONSE_BYTES} bytes`,
        ),
      )
      return false
    }

    this.queuedControlResponses.set(key, { payload, bytes: payloadBytes })
    this.queuedControlResponseBytes = nextTotalBytes
    logForDebugging(
      `[SessionsWebSocket] Queued control response for reconnect (${this.queuedControlResponses.size} pending, ${this.queuedControlResponseBytes} bytes)`,
    )
    return true
  }

  private discardQueuedControlResponses(reason: string): void {
    if (this.queuedControlResponses.size === 0) return
    logForDebugging(
      `[SessionsWebSocket] Discarding ${this.queuedControlResponses.size} queued control response(s): ${reason}`,
    )
    this.queuedControlResponses.clear()
    this.queuedControlResponseBytes = 0
  }

  private flushQueuedControlResponses(): boolean {
    if (!this.ws || this.state !== 'connected') return false

    for (const [key, queued] of this.queuedControlResponses) {
      try {
        this.ws.send(queued.payload)
        this.queuedControlResponses.delete(key)
        this.queuedControlResponseBytes -= queued.bytes
      } catch (error) {
        logError(
          new Error(
            `[SessionsWebSocket] Queued control response send failed: ${errorMessage(error)}`,
          ),
        )
        return false
      }
    }
    this.queuedControlResponseBytes = 0
    return true
  }

  /**
   * Send a control response back to the session
   */
  sendControlResponse(response: SDKControlResponse): boolean {
    const payload = jsonStringify(response)
    const key = this.controlResponseKey(response)

    if (this.ws && this.state === 'connected') {
      try {
        logForDebugging('[SessionsWebSocket] Sending control response')
        this.ws.send(payload)
        return true
      } catch (error) {
        logError(
          new Error(
            `[SessionsWebSocket] Control response send failed: ${errorMessage(error)}`,
          ),
        )
        if (!this.enqueueControlResponse(key, payload)) return false

        const failedSocket = this.ws
        this.handleClose(1006, failedSocket)
        try {
          failedSocket.close()
        } catch {
          // handleClose already scheduled a retry.
        }
        return true
      }
    }

    if (this.state === 'connecting' || this.reconnectTimer) {
      return this.enqueueControlResponse(key, payload)
    }

    logError(
      new Error(
        '[SessionsWebSocket] Cannot send control response: connection is closed',
      ),
    )
    return false
  }

  /**
   * Send a control request to the session (e.g., interrupt)
   */
  sendControlRequest(request: SDKControlRequestInner): void {
    if (!this.ws || this.state !== 'connected') {
      logError(new Error('[SessionsWebSocket] Cannot send: not connected'))
      return
    }

    const controlRequest: SDKControlRequest = {
      type: 'control_request',
      request_id: randomUUID(),
      request,
    }

    logForDebugging(
      `[SessionsWebSocket] Sending control request: ${request.subtype}`,
    )
    this.ws.send(jsonStringify(controlRequest))
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected'
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    logForDebugging('[SessionsWebSocket] Closing connection')
    this.reconnectAttempts = 0
    this.sessionNotFoundRetries = 0
    this.closeConnection(true)
  }

  private closeConnection(discardQueuedResponses: boolean): void {
    this.state = 'closed'
    this.stopPingInterval()

    if (this.reconnectTimer) {
      const clear = this.options.clearReconnect ?? clearTimeout
      clear(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      // Null out event handlers to prevent race conditions during reconnect.
      // Under Bun (native WebSocket), onX handlers are the clean way to detach.
      // Under Node (ws package), the listeners were attached with .on() in connect(),
      // but since we're about to close and null out this.ws, no cleanup is needed.
      try {
        this.ws.close()
      } catch (error) {
        logError(
          new Error(
            `[SessionsWebSocket] Failed to close WebSocket: ${errorMessage(error)}`,
          ),
        )
      }
      this.ws = null
    }

    if (discardQueuedResponses) {
      this.discardQueuedControlResponses('explicit close')
    }
  }

  /**
   * Force reconnect - closes existing connection and establishes a new one.
   * Useful when the subscription becomes stale (e.g., after container shutdown).
   */
  reconnect(): void {
    logForDebugging('[SessionsWebSocket] Force reconnecting')
    this.reconnectAttempts = 0
    this.sessionNotFoundRetries = 0
    this.closeConnection(false)
    // Small delay before reconnecting (stored in reconnectTimer so it can be cancelled)
    const schedule = this.options.scheduleReconnect ?? setTimeout
    this.reconnectTimer = schedule(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 500)
  }
}
