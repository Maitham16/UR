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
})
