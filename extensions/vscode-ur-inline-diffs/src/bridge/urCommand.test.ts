import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { resolveUrCommand } from './urCommand.js'

function exists(paths: string[]): (path: string) => boolean {
  const set = new Set(paths)
  return path => set.has(path)
}

describe('resolveUrCommand', () => {
  test('workspace-local dist/cli.js is preferred over global ur when Bun is available', () => {
    const cwd = '/workspace/ur'
    const resolved = resolveUrCommand({
      cwd,
      pathExists: exists([join(cwd, 'dist', 'cli.js')]),
      bunAvailable: () => true,
    })

    expect(resolved.command).toBe('bun')
    expect(resolved.args).toEqual([join(cwd, 'dist', 'cli.js')])
    expect(resolved.source).toBe('workspace-dist')
    expect(resolved.display).toBe(`bun ${join(cwd, 'dist', 'cli.js')}`)
  })

  test('explicit ur.executablePath overrides workspace auto-detection', () => {
    const cwd = '/workspace/ur'
    const resolved = resolveUrCommand({
      cwd,
      config: { executablePath: '/opt/ur/bin/ur', executableArgs: ['--wrapper-mode'] },
      pathExists: exists([join(cwd, 'dist', 'cli.js'), join(cwd, 'bin', 'ur.js')]),
      bunAvailable: () => true,
    })

    expect(resolved.command).toBe('/opt/ur/bin/ur')
    expect(resolved.args).toEqual(['--wrapper-mode'])
    expect(resolved.source).toBe('configured')
  })

  test('workspace-local bin/ur.js is used when dist exists but Bun is unavailable', () => {
    const cwd = '/workspace/ur'
    const resolved = resolveUrCommand({
      cwd,
      pathExists: exists([join(cwd, 'dist', 'cli.js'), join(cwd, 'bin', 'ur.js')]),
      bunAvailable: () => false,
    })

    expect(resolved.command).toBe('node')
    expect(resolved.args).toEqual([join(cwd, 'bin', 'ur.js')])
    expect(resolved.source).toBe('workspace-launcher')
  })

  test('fallback command is ur when no local checkout exists', () => {
    const resolved = resolveUrCommand({
      cwd: '/workspace/project',
      pathExists: () => false,
      bunAvailable: () => true,
    })

    expect(resolved.command).toBe('ur')
    expect(resolved.args).toEqual([])
    expect(resolved.source).toBe('path')
  })
})
