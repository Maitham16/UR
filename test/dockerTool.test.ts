import { describe, expect, test } from 'bun:test'
import { DockerTool } from '../src/tools/DockerTool/DockerTool.js'

describe('DockerTool', () => {
  test('classifies read-only and destructive actions', () => {
    expect(DockerTool.isReadOnly({ action: 'ps' } as never)).toBe(true)
    expect(DockerTool.isReadOnly({ action: 'logs' } as never)).toBe(true)
    expect(DockerTool.isReadOnly({ action: 'run' } as never)).toBe(false)
    expect(DockerTool.isDestructive?.({ action: 'run' } as never)).toBe(true)
    expect(DockerTool.isDestructive?.({ action: 'build' } as never)).toBe(true)
  })

  test('input schema requires action', () => {
    const result = DockerTool.inputSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
