import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call as cite } from '../src/commands/cite/cite.ts'
import { call as graph } from '../src/commands/graph/graph.ts'
import { call as index } from '../src/commands/index/index.impl.ts'
import { call as paper } from '../src/commands/paper/paper.ts'
import { call as remember } from '../src/commands/remember/remember.ts'
import { call as research } from '../src/commands/research/research.ts'
import { runWithCwdOverride } from '../src/utils/cwd.ts'

test('project-backed research commands never report failed persistence as success', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'ur-research-command-failure-'))
  writeFileSync(join(workspace, '.ur'), 'blocks project storage\n')
  try {
    for (const [command, args] of [
      [remember, 'keep this'],
      [research, 'research note'],
      [paper, 'paper title'],
      [cite, 'citation'],
      [graph, 'papers graph paper'],
      [index, ''],
    ] as const) {
      const result = await runWithCwdOverride(workspace, () =>
        command(args, {} as never),
      )
      expect(result.exitCode).toBe(1)
      expect((result as { value: string }).value.toLowerCase()).toMatch(
        /failed|could not|not written/,
      )
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
