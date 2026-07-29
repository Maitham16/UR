import { describe, expect, test } from 'bun:test'
import type { SDKControlResponse } from '../src/entrypoints/sdk/controlTypes.js'
import { RemoteSessionManager } from '../src/remote/RemoteSessionManager.js'

describe('RemoteSessionManager permission response delivery', () => {
  test('keeps a pending request until the WebSocket accepts responsibility', () => {
    const sent: SDKControlResponse[] = []
    let acceptResponse = false
    const manager = new RemoteSessionManager(
      {
        sessionId: 'session-123',
        orgUuid: 'org-456',
        getAccessToken: () => 'access-token',
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
      },
    )

    ;(manager as any).websocket = {
      sendControlResponse: (response: SDKControlResponse) => {
        sent.push(response)
        return acceptResponse
      },
    }
    ;(manager as any).handleMessage({
      type: 'control_request',
      request_id: 'request-123',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tool-123',
      },
    })

    expect(
      manager.respondToPermissionRequest('request-123', {
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
      }),
    ).toBe(false)
    expect(
      (manager as any).pendingPermissionRequests.has('request-123'),
    ).toBe(true)

    acceptResponse = true
    expect(
      manager.respondToPermissionRequest('request-123', {
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
      }),
    ).toBe(true)
    expect(
      (manager as any).pendingPermissionRequests.has('request-123'),
    ).toBe(false)
    expect(sent.at(-1)?.response).toEqual({
      subtype: 'success',
      request_id: 'request-123',
      response: {
        behavior: 'allow',
        updatedInput: { command: 'pwd' },
      },
    })
  })

  test('reuses its WebSocket client when connect is called repeatedly', () => {
    const manager = new RemoteSessionManager(
      {
        sessionId: 'session-123',
        orgUuid: 'org-456',
        getAccessToken: () => 'access-token',
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
      },
    )
    let connectCalls = 0
    const websocket = {
      connect: () => {
        connectCalls++
      },
    }
    ;(manager as any).websocket = websocket

    manager.connect()
    manager.connect()

    expect(connectCalls).toBe(2)
    expect((manager as any).websocket).toBe(websocket)
  })

  test('handles cancellation frames using the schema-defined message type', () => {
    const cancelled: Array<[string, string | undefined]> = []
    const manager = new RemoteSessionManager(
      {
        sessionId: 'session-123',
        orgUuid: 'org-456',
        getAccessToken: () => 'access-token',
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
        onPermissionCancelled: (requestId, toolUseId) => {
          cancelled.push([requestId, toolUseId])
        },
      },
    )
    ;(manager as any).pendingPermissionRequests.set('request-123', {
      subtype: 'can_use_tool',
      tool_use_id: 'tool-123',
    })

    ;(manager as any).handleMessage({
      type: 'control_cancel_request',
      request_id: 'request-123',
    })

    expect(cancelled).toEqual([['request-123', 'tool-123']])
    expect(
      (manager as any).pendingPermissionRequests.has('request-123'),
    ).toBe(false)
  })

  test('reports malformed control requests without throwing through the socket callback', () => {
    const errors: Error[] = []
    const responses: SDKControlResponse[] = []
    const manager = new RemoteSessionManager(
      {
        sessionId: 'session-123',
        orgUuid: 'org-456',
        getAccessToken: () => 'access-token',
      },
      {
        onMessage: () => {},
        onPermissionRequest: () => {},
        onError: error => errors.push(error),
      },
    )
    ;(manager as any).websocket = {
      sendControlResponse: (response: SDKControlResponse) => {
        responses.push(response)
        return true
      },
    }

    expect(() =>
      (manager as any).handleMessage({
        type: 'control_request',
        request_id: 'request-bad',
      }),
    ).not.toThrow()

    expect(errors[0]?.message).toContain('missing a request subtype')
    expect(responses[0]?.response).toEqual({
      subtype: 'error',
      request_id: 'request-bad',
      error: 'Invalid control request: missing request subtype',
    })
  })
})
