import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getBuiltinSuite, listBuiltinSuiteIds } from '../src/services/agents/benchmarkSuites.js'
import { prepareEvalVerification } from '../src/services/agents/evalIntegrity.js'
import { runEvalTestCommand, validateEvalSuite } from '../src/services/agents/evals.js'
import solutions from './fixtures/evalSolutions.json'

const full = process.env.UR_REQUIRE_FULL_BENCHMARK_FIXTURES === '1'
for (const id of listBuiltinSuiteIds()) {
  const suite = getBuiltinSuite(id)!
  test(`${id}: canonical suite validates and every task has independent behavioral checks`, () => {
    expect(validateEvalSuite(suite).errors).toEqual([])
    for (const c of suite.cases) {
      expect(Object.keys(c.setup?.files ?? {}).length).toBeGreaterThan(0)
      expect(Object.keys(c.expect.testFiles ?? {}).length).toBeGreaterThan(0)
      expect(c.expect.testCommand).toContain('UR_EVAL_VERIFY_DIR')
    }
  })
  const needsExternal = ['docker-repair', 'py-package-repair', 'ts-migrate'].includes(id)
  for (const c of suite.cases) {
    ;(needsExternal && !full ? test.skip : test)(`${id}/${c.id}: rejects broken baseline and accepts known repair`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'ur-builtin-verification-'))
      const verifier = prepareEvalVerification(c.expect.testFiles)
      const put = (name: string, content: string | null) => {
        const path = join(cwd, name)
        if (content === null) { rmSync(path, { force: true }); return }
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content)
      }
      try {
        for (const [name, content] of Object.entries(c.setup!.files)) put(name, content)
        const before = await runEvalTestCommand(cwd, c.expect.testCommand!, verifier.directory)
        expect(before.testPassed).toBe(false)
        for (const [name, content] of Object.entries(solutions[c.id as keyof typeof solutions])) put(name, content)
        const after = await runEvalTestCommand(cwd, c.expect.testCommand!, verifier.directory)
        if (!after.testPassed) throw new Error(`${c.id}: ${after.testStdout}\n${after.testStderr}`)
        expect(after.testPassed).toBe(true)
      } finally { verifier.cleanup(); rmSync(cwd, { recursive: true, force: true }) }
    }, 600000)
  }
}
