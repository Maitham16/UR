// @ts-nocheck
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlPermissionRequest,
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import {
  type RemoteMessageContent,
  sendEventToRemoteSession,
} from '../utils/teleport/api.js'
import {
  SessionsWebSocket,
  type SessionsWebSocketCallbacks,
} from './SessionsWebSocket.js'

/**
 * Type guard to check if a message is an SDKMessage (not a control message)
 */
function isSDKMessage(
  message:
    | SDKMessage
    | SDKControlRequest
    | SDKControlResponse
    | SDKControlCancelRequest,
): message is SDKMessage {
  return (
    message.type !== 'control_request' &&
    message.type !== 'control_response' &&
    message.type !== 'control_cancel_request'
  )
}

/**
 * Simple permission response for remote sessions.
 * This is a simplified version of PermissionResult for CCR communication.
 */
export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      message: string
    }

export type RemoteSessionConfig = {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  /** True if session was created with an initial prompt that's being processed */
  hasInitialPrompt?: boolean
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated. Used by `ur assistant`.
   */
  viewerOnly?: boolean
}

export type RemoteSessionCallbacks = {
  /** Called when an SDKMessage is received from the session */
  onMessage: (message: SDKMessage) => void
  /** Called when a permission request is received from CCR */
  onPermissionRequest: (
    request: SDKControlPermissionRequest,
    requestId: string,
  ) => void
  /** Called when the server cancels a pending permission request */
  onPermissionCancelled?: (
    requestId: string,
    toolUseId: string | undefined,
  ) => void
  /** Called when connection is established */
  onConnected?: () => void
  /** Called when connection is lost and cannot be restored */
  onDisconnected?: () => void
  /** Called on transient WS drop while reconnect backoff is in progress */
  onReconnecting?: () => void
  /** Called on error */
  onError?: (error: Error) => void
}

/**
 * Manages a remote CCR session.
 *
 * Coordinates:
 * - WebSocket subscription for receiving messages from CCR
 * - HTTP POST for sending user messages to CCR
 * - Permission request/response flow
 */
export class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null
  private pendingPermissionRequests: Map<string, SDKControlPermissionRequest> =
    new Map()

  constructor(
    private readonly config: RemoteSessionConfig,
    private readonly callbacks: RemoteSessionCallbacks,
  ) {}

  /**
   * Connect to the remote session via WebSocket
   */
  connect(): void {
    logForDebugging(
      `[RemoteSessionManager] Connecting to session ${this.config.sessionId}`,
    )

    // Reuse the existing client. SessionsWebSocket.connect() is idempotent
    // while connecting/connected and can start a fresh attempt after a
    // permanent close. Replacing it here leaked the old socket and allowed
    // duplicate message/permission callbacks when connect() was called twice.
    if (this.websocket) {
      void this.websocket.connect()
      return
    }

    const wsCallbacks: SessionsWebSocketCallbacks = {
      onMessage: message => this.handleMessage(message),
      onConnected: () => {
        logForDebugging('[RemoteSessionManager] Connected')
        this.callbacks.onConnected?.()
      },
      onClose: () => {
        logForDebugging('[RemoteSessionManager] Disconnected')
        this.callbacks.onDisconnected?.()
      },
      onReconnecting: () => {
        logForDebugging('[RemoteSessionManager] Reconnecting')
        this.callbacks.onReconnecting?.()
      },
      onError: error => {
        logError(error)
        this.callbacks.onError?.(error)
      },
    }

    this.websocket = new SessionsWebSocket(
      this.config.sessionId,
      this.config.orgUuid,
      this.config.getAccessToken,
      wsCallbacks,
    )

    void this.websocket.connect()
  }

  /**
   * Handle messages from WebSocket
   */
  private handleMessage(
    message:
      | SDKMessage
      | SDKControlRequest
      | SDKControlResponse
      | SDKControlCancelRequest,
  ): void {
    // Handle control requests (permission prompts from CCR)
    if (message.type === 'control_request') {
      this.handleControlRequest(message)
      return
    }

    // Handle control cancel requests (server cancelling a pending permission prompt)
    if (message.type === 'control_cancel_request') {
      const { request_id } = message
      if (typeof request_id !== 'string' || request_id.length === 0) {
        this.reportInvalidControlMessage(
          'control_cancel_request is missing a request_id',
        )
        return
      }
      const pendingRequest = this.pendingPermissionRequests.get(request_id)
      logForDebugging(
        `[RemoteSessionManager] Permission request cancelled: ${request_id}`,
      )
      this.pendingPermissionRequests.delete(request_id)
      this.callbacks.onPermissionCancelled?.(
        request_id,
        pendingRequest?.tool_use_id,
      )
      return
    }

    // Handle control responses (acknowledgments)
    if (message.type === 'control_response') {
      logForDebugging('[RemoteSessionManager] Received control response')
      return
    }

    // Forward SDK messages to callback (type guard ensures proper narrowing)
    if (isSDKMessage(message)) {
      this.callbacks.onMessage(message)
    }
  }

  /**
   * Handle control requests from CCR (e.g., permission requests)
   */
  private handleControlRequest(request: SDKControlRequest): void {
    const { request_id, request: inner } = request

    if (typeof request_id !== 'string' || request_id.length === 0) {
      this.reportInvalidControlMessage(
        'control_request is missing a request_id',
      )
      return
    }
    if (
      typeof inner !== 'object' ||
      inner === null ||
      typeof inner.subtype !== 'string'
    ) {
      this.reportInvalidControlMessage(
        `control_request ${request_id} is missing a request subtype`,
      )
      this.websocket?.sendControlResponse({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id,
          error: 'Invalid control request: missing request subtype',
        },
      })
      return
    }

    if (inner.subtype === 'can_use_tool') {
      logForDebugging(
        `[RemoteSessionManager] Permission request for tool: ${inner.tool_name}`,
      )
      this.pendingPermissionRequests.set(request_id, inner)
      this.callbacks.onPermissionRequest(inner, request_id)
    } else {
      // Send an error response for unrecognized subtypes so the server
      // doesn't hang waiting for a reply that never comes.
      logForDebugging(
        `[RemoteSessionManager] Unsupported control request subtype: ${inner.subtype}`,
      )
      const response: SDKControlResponse = {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id,
          error: `Unsupported control request subtype: ${inner.subtype}`,
        },
      }
      this.websocket?.sendControlResponse(response)
    }
  }

  private reportInvalidControlMessage(detail: string): void {
    const error = new Error(`[RemoteSessionManager] Invalid ${detail}`)
    logError(error)
    this.callbacks.onError?.(error)
  }

  /**
   * Send a user message to the remote session via HTTP POST
   */
  async sendMessage(
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ): Promise<boolean> {
    logForDebugging(
      `[RemoteSessionManager] Sending message to session ${this.config.sessionId}`,
    )

    const success = await sendEventToRemoteSession(
      this.config.sessionId,
      content,
      opts,
    )

    if (!success) {
      logError(
        new Error(
          `[RemoteSessionManager] Failed to send message to session ${this.config.sessionId}`,
        ),
      )
    }

    return success
  }

  /**
   * Respond to a permission request from CCR
   */
  respondToPermissionRequest(
    requestId: string,
    result: RemotePermissionResponse,
  ): boolean {
    const pendingRequest = this.pendingPermissionRequests.get(requestId)
    if (!pendingRequest) {
      logError(
        new Error(
          `[RemoteSessionManager] No pending permission request with ID: ${requestId}`,
        ),
      )
      return false
    }

    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: result.behavior,
          ...(result.behavior === 'allow'
            ? { updatedInput: result.updatedInput }
            : { message: result.message }),
        },
      },
    }

    logForDebugging(
      `[RemoteSessionManager] Sending permission response: ${result.behavior}`,
    )

    const accepted = this.websocket?.sendControlResponse(response) ?? false
    if (accepted) {
      // The WebSocket now owns the response: it was sent immediately or
      // durably queued for the active reconnect attempt.
      this.pendingPermissionRequests.delete(requestId)
    } else {
      logError(
        new Error(
          `[RemoteSessionManager] Permission response was not accepted for delivery: ${requestId}`,
        ),
      )
    }
    return accepted
  }

  /**
   * Check if connected to the remote session
   */
  isConnected(): boolean {
    return this.websocket?.isConnected() ?? false
  }

  /**
   * Send an interrupt signal to cancel the current request on the remote session
   */
  cancelSession(): void {
    logForDebugging('[RemoteSessionManager] Sending interrupt signal')
    this.websocket?.sendControlRequest({ subtype: 'interrupt' })
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.config.sessionId
  }

  /**
   * Disconnect from the remote session
   */
  disconnect(): void {
    logForDebugging('[RemoteSessionManager] Disconnecting')
    this.websocket?.close()
    this.websocket = null
    this.pendingPermissionRequests.clear()
  }

  /**
   * Force reconnect the WebSocket.
   * Useful when the subscription becomes stale after container shutdown.
   */
  reconnect(): void {
    logForDebugging('[RemoteSessionManager] Reconnecting WebSocket')
    this.websocket?.reconnect()
  }
}

/**
 * Create a remote session config from OAuth tokens
 */
export function createRemoteSessionConfig(
  sessionId: string,
  getAccessToken: () => string,
  orgUuid: string,
  hasInitialPrompt = false,
  viewerOnly = false,
): RemoteSessionConfig {
  return {
    sessionId,
    getAccessToken,
    orgUuid,
    hasInitialPrompt,
    viewerOnly,
  }
}
