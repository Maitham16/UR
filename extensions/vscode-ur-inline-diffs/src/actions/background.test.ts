import { describe, expect, test } from 'bun:test'
import {
  buildBackgroundCancelArgs,
  buildBackgroundRunArgs,
  parseBackgroundListJson,
} from './background.js'

describe('parseBackgroundListJson', () => {
  test('parses a well-formed task list', () => {
    const raw = JSON.stringify({
      tasks: [
        { id: 'bg-1', task: 'refactor auth module', status: 'running', logFile: '/tmp/bg-1.log' },
        { id: 'bg-2', task: 'add tests', status: 'completed', logFile: '/tmp/bg-2.log' },
      ],
    })
    const tasks = parseBackgroundListJson(raw)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toEqual({ id: 'bg-1', task: 'refactor auth module', status: 'running', logFile: '/tmp/bg-1.log' })
  })

  test('empty task list parses to an empty array', () => {
    expect(parseBackgroundListJson(JSON.stringify({ tasks: [] }))).toEqual([])
  })

  test('malformed JSON returns an empty array, never throws', () => {
    expect(() => parseBackgroundListJson('not json')).not.toThrow()
    expect(parseBackgroundListJson('not json')).toEqual([])
  })

  test('missing tasks field returns an empty array', () => {
    expect(parseBackgroundListJson('{}')).toEqual([])
  })

  test('entries missing required fields are skipped, not fabricated', () => {
    const raw = JSON.stringify({ tasks: [{ id: 'bg-1' }, { id: 'bg-2', task: 'ok', status: 'queued', logFile: '' }] })
    const tasks = parseBackgroundListJson(raw)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe('bg-2')
  })

  test('entries with unrecognized status are skipped instead of fabricated', () => {
    const raw = JSON.stringify({ tasks: [{ id: 'bg-1', task: 'x', status: 'zzz', logFile: '' }] })
    expect(parseBackgroundListJson(raw)).toEqual([])
  })
})

describe('background task argv builders', () => {
  test('keeps the task as one argv value and applies explicit isolation flags', () => {
    expect(buildBackgroundRunArgs('  fix auth; echo unsafe  ', {
      worktree: true,
      offline: true,
    })).toEqual([
      'bg',
      'run',
      'fix auth; echo unsafe',
      '--worktree',
      '--offline',
      '--json',
    ])
  })

  test('rejects empty, oversized, and NUL-bearing tasks and ids', () => {
    expect(() => buildBackgroundRunArgs(' ', { worktree: true, offline: false })).toThrow()
    expect(() => buildBackgroundRunArgs('x'.repeat(64_001), { worktree: true, offline: false })).toThrow()
    expect(() => buildBackgroundRunArgs('bad\0task', { worktree: true, offline: false })).toThrow()
    expect(() => buildBackgroundCancelArgs('')).toThrow()
    expect(() => buildBackgroundCancelArgs('bad\0id')).toThrow()
  })

  test('builds a shell-free cancellation argv', () => {
    expect(buildBackgroundCancelArgs('bg_123')).toEqual(['bg', 'kill', 'bg_123'])
  })
})
