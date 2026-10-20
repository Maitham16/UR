import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('partial platform signing secrets fail before any signing command or artifact mutation', () => {
  const script = join(import.meta.dir, '..', 'scripts/native-sign.mjs')
  for (const [target, environment, message] of [
    ['darwin-arm64', { APPLE_SIGNING_IDENTITY: 'fixture' }, 'APPLE_CERTIFICATE_P12_BASE64 is missing'],
    ['win32-x64', { WINDOWS_CERTIFICATE_PASSWORD: 'fixture' }, 'WINDOWS_CERTIFICATE_PFX_BASE64 is missing'],
  ] as const) {
    const result = spawnSync('node', [script, '--target', target], {
      encoding: 'utf8', env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir(), ...environment,
      },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stdout).not.toContain('"codeSigned":true')
  }
})
