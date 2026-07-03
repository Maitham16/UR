import { describe, expect, test } from 'bun:test'
import { parseBackgroundListJson } from './background.js'

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

  test('unrecognized status falls back to queued rather than an invented value', () => {
    const raw = JSON.stringify({ tasks: [{ id: 'bg-1', task: 'x', status: 'zzz', logFile: '' }] })
    expect(parseBackgroundListJson(raw)[0]?.status).toBe('queued')
  })
})
