import { test } from 'bun:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  flushSessionStorage,
  recordContentReplacement,
  resetProjectForTesting,
  setSessionFileForTesting,
} from '../../src/utils/sessionStorage.ts'

test('session drain recovery scenario', async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ur-session-flush-'))
  const blockedParent = join(temporaryDirectory, 'not-a-directory')
  const sessionFile = join(blockedParent, 'session.jsonl')

  try {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    resetProjectForTesting()
    writeFileSync(blockedParent, 'blocks transcript directory creation')
    setSessionFileForTesting(sessionFile)

    await recordContentReplacement([])

    // Let the timer-started drain fail and settle before durability is checked.
    await new Promise(resolve => setTimeout(resolve, 250))

    await assert.rejects(flushSessionStorage(), Error)

    rmSync(blockedParent)
    mkdirSync(blockedParent)

    await flushSessionStorage()
    assert.match(
      readFileSync(sessionFile, 'utf8'),
      /"type":"content-replacement"/,
    )

    // A successful recovery clears both the retained failure and retry batch.
    await flushSessionStorage()
  } finally {
    resetProjectForTesting()
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
