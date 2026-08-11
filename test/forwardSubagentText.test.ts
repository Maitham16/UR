import { afterEach, describe, expect, it } from 'bun:test'
import { setIsInteractive } from '../src/bootstrap/state.js'
import {
  drainSdkEvents,
  enqueueForwardedSubagentMessage,
} from '../src/utils/sdkEventQueue.js'

afterEach(() => {
  drainSdkEvents()
  setIsInteractive(true)
})

describe('--forward-subagent-text stream events', () => {
  it('emits a standard assistant message keyed by the spawning tool use', () => {
    setIsInteractive(false)
    enqueueForwardedSubagentMessage(
      {
        id: 'msg_subagent',
        role: 'assistant',
        content: [{ type: 'text', text: 'nested result' }],
      },
      'toolu_parent_agent',
    )

    expect(drainSdkEvents()).toEqual([
      expect.objectContaining({
        type: 'assistant',
        parent_tool_use_id: 'toolu_parent_agent',
        message: expect.objectContaining({ id: 'msg_subagent' }),
        uuid: expect.any(String),
        session_id: expect.any(String),
      }),
    ])
  })

  it('does not emit in interactive mode or without a parent tool id', () => {
    enqueueForwardedSubagentMessage({ id: 'ignored' }, 'toolu_parent')
    setIsInteractive(false)
    enqueueForwardedSubagentMessage({ id: 'ignored' }, undefined)
    expect(drainSdkEvents()).toEqual([])
  })
})
