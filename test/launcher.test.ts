import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repo = join(import.meta.dir, '..')

describe('Node launcher', () => {
  test('forwards child output without synchronous writes to non-blocking fds', () => {
    const source = readFileSync(join(repo, 'bin', 'ur.js'), 'utf8')

    expect(source).not.toContain('writeSync(1')
    expect(source).not.toContain('writeSync(2')
    expect(source).toContain('forwardChildOutput')
    expect(source).toContain('EAGAIN')
    expect(source).toContain('EWOULDBLOCK')
  })

  test('does not throw with piped stdin and no stdin data for a positional-free command', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }
    const output = execFileSync('node', ['./bin/ur.js', '--version'], {
      cwd: repo,
      input: '',
      encoding: 'utf8',
    })

    expect(output.trim()).toBe(`${pkg.version} (UR-AGENT)`)
  })
})
