#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateShellSafetyPolicy } from '../src/services/safety/projectSafety.ts'
import { safetyMatrixCases } from './safety-matrix-cases.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(root, 'diagnostics', 'safety-matrix', 'latest.json')

function optionsForCase(testCase) {
  return {
    autonomousMode: testCase.mode === 'autonomous-safe',
    unsafeMode: testCase.mode === 'explicit-unsafe',
    dangerouslyDisableSandbox: testCase.mode === 'explicit-unsafe',
    sandboxAvailable: testCase.sandboxAvailable,
  }
}

function executionDecision(evaluation) {
  if (
    evaluation.audit.mode === 'autonomous-safe' &&
    evaluation.audit.sandboxRequired &&
    evaluation.audit.sandboxAvailable === false &&
    !evaluation.audit.unsafeBypassUsed
  ) {
    return 'deny'
  }
  return evaluation.behavior
}

export function buildSafetyMatrix(cwd = root) {
  const cases = safetyMatrixCases.map(testCase => {
    const evaluation = evaluateShellSafetyPolicy(
      testCase.command,
      cwd,
      optionsForCase(testCase),
    )
    return {
      id: testCase.id,
      command: testCase.command,
      category: evaluation.audit.commandCategory,
      mode: evaluation.audit.mode,
      expectedDecision: testCase.expectedDecision,
      actualDecision: executionDecision(evaluation),
      policyDecision: evaluation.behavior,
      sandboxRequired: evaluation.audit.sandboxRequired,
      sandboxAvailable: evaluation.audit.sandboxAvailable,
      unsafeBypassUsed: evaluation.audit.unsafeBypassUsed,
      permissions: evaluation.permissions,
      reason: evaluation.audit.reason,
      testFile: testCase.testFile,
      testName: testCase.testName,
    }
  })

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/generate-safety-matrix.mjs',
    caseCount: cases.length,
    cases,
  }
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const matrix = buildSafetyMatrix()
  const serialized = `${JSON.stringify(matrix, null, 2)}\n`

  if (check) {
    let existing = ''
    try {
      existing = readFileSync(outputPath, 'utf8')
    } catch {
      console.error(`Safety matrix missing: ${outputPath}`)
      process.exit(1)
    }
    if (existing !== serialized) {
      console.error(`Safety matrix is stale. Regenerate with: bun run safety:matrix`)
      process.exit(1)
    }
    console.log(`Safety matrix is fresh: ${outputPath}`)
    return
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, serialized)
  console.log(`Wrote safety matrix: ${outputPath}`)
  const failed = matrix.cases.filter(item => item.expectedDecision !== item.actualDecision)
  console.log(`Safety matrix: ${matrix.cases.length - failed.length}/${matrix.cases.length} decisions matched`)
  if (failed.length > 0) {
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
