import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('a completed background drain failure is surfaced and its batch can be retried', async () => {
  // sessionStorage is part of the production command/task ESM graph. Exercise
  // it in its own runtime so unrelated test files cannot change cycle
  // initialization order while this durability scenario is running.
  const child = Bun.spawn(
    [
      process.execPath,
      'test',
      join(import.meta.dir, 'fixtures', 'sessionStorageFlushScenario.ts'),
    ],
    {
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        TEST_ENABLE_SESSION_PERSISTENCE: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ])

  if (exitCode !== 0) {
    throw new Error(`isolated session-storage scenario failed:\n${stderr}`)
  }
  expect(stderr).toContain('1 pass')
  expect(exitCode).toBe(0)
})
