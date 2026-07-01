import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendCommandLog,
  commandLogDir,
  commandLogPath,
  readCommandLog,
} from '../src/services/agents/commandLog.js'
import { readRunActions } from '../src/services/agents/runArtifacts.js'

function withTempDir(fn: (dir: string) => void): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'ur-command-log-'))
  try {
    fn(tempDir)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('command log', () => {
  test('appendCommandLog creates the log directory and writes JSONL', () => {
    withTempDir(tempDir => {
      const runId = 'run-123'
      const entry = appendCommandLog(tempDir, runId, {
        command: 'git status',
        exitCode: 0,
        stdout: 'clean',
        stderr: '',
        reason: 'Check repo status',
        nextAction: 'proceed',
        durationMs: 42,
        toolUseId: 'tu-1',
      })

      expect(entry.command).toBe('git status')
      expect(entry.exitCode).toBe(0)
      expect(entry.at).toMatch(/^\d{4}-/)
      expect(commandLogDir(tempDir, runId)).toBe(join(tempDir, '.ur', 'runs', runId))
      expect(commandLogPath(tempDir, runId)).toBe(
        join(tempDir, '.ur', 'runs', runId, 'commands.jsonl'),
      )
    })
  })

  test('readCommandLog returns parsed entries', () => {
    withTempDir(tempDir => {
      const runId = 'run-456'
      appendCommandLog(tempDir, runId, {
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'failed',
        reason: 'Run tests',
      })
      appendCommandLog(tempDir, runId, {
        command: 'npm install',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      })

      const logs = readCommandLog(tempDir, runId)
      expect(logs.length).toBe(2)
      expect(logs[0].command).toBe('npm test')
      expect(logs[0].exitCode).toBe(1)
      expect(logs[1].command).toBe('npm install')
      expect(logs[1].exitCode).toBe(0)
    })
  })

  test('readCommandLog tolerates malformed lines', () => {
    withTempDir(tempDir => {
      const runId = 'run-789'
      mkdirSync(commandLogDir(tempDir, runId), { recursive: true })
      const path = commandLogPath(tempDir, runId)
      const bad = '{ not json }'
      const good = JSON.stringify({
        at: new Date().toISOString(),
        command: 'ls',
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
      writeFileSync(path, `${bad}\n${good}\n`, { flag: 'a' })

      const logs = readCommandLog(tempDir, runId)
      expect(logs.length).toBe(1)
      expect(logs[0].command).toBe('ls')
    })
  })

  test('readCommandLog returns empty array for missing file', () => {
    withTempDir(tempDir => {
      const logs = readCommandLog(tempDir, 'no-such-run')
      expect(logs).toEqual([])
    })
  })

  test('appendCommandLog fills audit defaults and mirrors to actions.json', () => {
    withTempDir(tempDir => {
      const runId = 'run-actions'
      appendCommandLog(tempDir, runId, {
        command: 'false',
        exitCode: 1,
        stdout: '',
        stderr: 'nope',
      })

      const logs = readCommandLog(tempDir, runId)
      expect(logs[0].reason).toBe('unspecified command reason')
      expect(logs[0].nextAction).toContain('inspect failure output')

      const actions = readRunActions(tempDir, runId)
      expect(actions.length).toBe(1)
      expect(actions[0].kind).toBe('command')
      expect(actions[0].status).toBe('failed')
      expect(actions[0].command).toBe('false')
      expect(actions[0].exitCode).toBe(1)
      expect(actions[0].stderr).toBe('nope')
      expect(actions[0].reason).toBe('unspecified command reason')
      expect(actions[0].nextAction).toContain('inspect failure output')
    })
  })
})
