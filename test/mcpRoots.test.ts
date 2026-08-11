import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAdditionalDirectoriesForAgentMd,
  getOriginalCwd,
  setAdditionalDirectoriesForAgentMd,
  setOriginalCwd,
} from '../src/bootstrap/state.js'
import {
  listMcpRoots,
  notifyMcpRootsListChanged,
  registerMcpRootsClient,
  resetMcpRootsClientsForTest,
} from '../src/services/mcp/mcpRoots.js'

describe('MCP roots compatibility', () => {
  let originalCwd: string
  let originalAdditionalDirectories: string[]

  beforeEach(() => {
    originalCwd = getOriginalCwd()
    originalAdditionalDirectories = getAdditionalDirectoriesForAgentMd()
    resetMcpRootsClientsForTest()
  })

  afterEach(() => {
    setOriginalCwd(originalCwd)
    setAdditionalDirectoriesForAgentMd(originalAdditionalDirectories)
    resetMcpRootsClientsForTest()
  })

  test('lists the project and additional directories as encoded file URLs', () => {
    setOriginalCwd('/tmp/UR project')
    setAdditionalDirectoriesForAgentMd(['/tmp/reference files', '/tmp/UR project'])
    expect(listMcpRoots()).toEqual([
      { uri: 'file:///tmp/UR%20project', name: '/tmp/UR project' },
      { uri: 'file:///tmp/reference%20files', name: '/tmp/reference files' },
    ])
  })

  test('notifies active clients and unregisters closed clients', async () => {
    let first = 0
    let second = 0
    const unregister = registerMcpRootsClient({
      sendRootsListChanged: async () => {
        first++
      },
    })
    registerMcpRootsClient({
      sendRootsListChanged: async () => {
        second++
        throw new Error('disconnected')
      },
    })

    expect(await notifyMcpRootsListChanged()).toEqual({ notified: 1, failed: 1 })
    unregister()
    expect(await notifyMcpRootsListChanged()).toEqual({ notified: 0, failed: 1 })
    expect(first).toBe(1)
    expect(second).toBe(2)
  })
})
