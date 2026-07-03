import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'
import { buildControlResponse, buildUrArgs, NdjsonBuffer, runUrTurn } from './urProcess.js'
import type { ControlRequestEnvelope, PermissionDecision, StdoutMessage } from './types.js'

describe('NdjsonBuffer', () => {
  test('parses a single complete line', () => {
    const buffer = new NdjsonBuffer()
    const messages = buffer.push('{"type":"system","subtype":"init","session_id":"abc"}\n')
    expect(messages).toEqual([{ type: 'system', subtype: 'init', session_id: 'abc' }])
  })

  test('parses multiple lines delivered in one chunk', () => {
    const buffer = new NdjsonBuffer()
    const messages = buffer.push('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n')
    expect(messages.map(m => m.type)).toEqual(['a', 'b', 'c'])
  })

  test('buffers a partial line split across two chunks', () => {
    const buffer = new NdjsonBuffer()
    expect(buffer.push('{"type":"assis')).toEqual([])
    const messages = buffer.push('tant","message":{"content":[]}}\n')
    expect(messages).toEqual([{ type: 'assistant', message: { content: [] } }])
  })

  test('buffers a line split across three chunks', () => {
    const buffer = new NdjsonBuffer()
    expect(buffer.push('{"typ')).toEqual([])
    expect(buffer.push('e":"result",')).toEqual([])
    const messages = buffer.push('"is_error":false}\n')
    expect(messages).toEqual([{ type: 'result', is_error: false }])
  })

  test('handles a chunk containing a partial line followed by complete lines', () => {
    const buffer = new NdjsonBuffer()
    buffer.push('{"type":"one"}\n{"type":"tw')
    const messages = buffer.push('o"}\n{"type":"three"}\n')
    expect(messages.map(m => m.type)).toEqual(['two', 'three'])
  })

  test('drops a malformed line without throwing', () => {
    const buffer = new NdjsonBuffer()
    const messages = buffer.push('not json\n{"type":"ok"}\n')
    expect(messages).toEqual([{ type: 'ok' }])
  })

  test('ignores blank lines', () => {
    const buffer = new NdjsonBuffer()
    const messages = buffer.push('\n\n{"type":"ok"}\n\n')
    expect(messages).toEqual([{ type: 'ok' }])
  })

  test('flush emits a trailing line with no newline', () => {
    const buffer = new NdjsonBuffer()
    expect(buffer.push('{"type":"partial"}')).toEqual([])
    expect(buffer.flush()).toEqual([{ type: 'partial' }])
  })

  test('flush is empty when nothing is buffered', () => {
    const buffer = new NdjsonBuffer()
    buffer.push('{"type":"a"}\n')
    expect(buffer.flush()).toEqual([])
  })
})

describe('buildUrArgs', () => {
  test('includes -p, --output-format stream-json, --verbose, --permission-prompt-tool stdio', () => {
    const args = buildUrArgs({ prompt: 'hello' })
    expect(args).toContain('-p')
    const outputFormatIndex = args.indexOf('--output-format')
    expect(outputFormatIndex).toBeGreaterThanOrEqual(0)
    expect(args[outputFormatIndex + 1]).toBe('stream-json')
    expect(args).toContain('--verbose')
    const permissionIndex = args.indexOf('--permission-prompt-tool')
    expect(permissionIndex).toBeGreaterThanOrEqual(0)
    expect(args[permissionIndex + 1]).toBe('stdio')
  })

  test('appends the prompt as the final positional argument, unquoted', () => {
    const args = buildUrArgs({ prompt: 'fix the "bug" in main.ts' })
    expect(args.at(-1)).toBe('fix the "bug" in main.ts')
  })

  test('adds --resume only when a cliSessionId is known', () => {
    const withoutResume = buildUrArgs({ prompt: 'hi' })
    expect(withoutResume).not.toContain('--resume')

    const withResume = buildUrArgs({ prompt: 'hi', resumeSessionId: 'session-123' })
    const resumeIndex = withResume.indexOf('--resume')
    expect(resumeIndex).toBeGreaterThanOrEqual(0)
    expect(withResume[resumeIndex + 1]).toBe('session-123')
  })

  test('adds --model only when provided', () => {
    const args = buildUrArgs({ prompt: 'hi', model: 'qwen3-coder:480b-cloud' })
    const modelIndex = args.indexOf('--model')
    expect(modelIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelIndex + 1]).toBe('qwen3-coder:480b-cloud')
  })
})

describe('buildControlResponse', () => {
  test('nests request_id and subtype inside `response`, matching structuredIO.ts::processLine', () => {
    const envelope = buildControlResponse('req-1', { behavior: 'allow', updatedInput: { command: 'ls' } }) as {
      type: string
      response: { request_id: string; subtype: string; response: PermissionDecision }
    }
    expect(envelope.type).toBe('control_response')
    expect(envelope.response.request_id).toBe('req-1')
    expect(envelope.response.subtype).toBe('success')
    expect(envelope.response.response).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
  })

  test('deny decision round-trips the message field', () => {
    const envelope = buildControlResponse('req-2', { behavior: 'deny', message: 'no' }) as {
      response: { response: PermissionDecision }
    }
    expect(envelope.response.response).toEqual({ behavior: 'deny', message: 'no' })
  })
})

// ---------------------------------------------------------------------------
// Fake child process for orchestration tests — no real `ur` binary needed.
// ---------------------------------------------------------------------------

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { writes: [] as string[], write: (data: string) => { this.stdin.writes.push(data) } }
  killed = false
  killSignal: string | undefined

  kill(signal?: string) {
    this.killed = true
    this.killSignal = signal
    return true
  }

  emitStdout(line: string) {
    this.stdout.emit('data', Buffer.from(line))
  }

  emitStderr(text: string) {
    this.stderr.emit('data', Buffer.from(text))
  }

  exit(code: number | null) {
    this.emit('exit', code)
  }
}

function spawnRecorder() {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = []
  let lastChild: FakeChildProcess | undefined
  const spawn = (command: string, args: string[], options: unknown) => {
    calls.push({ command, args, options })
    const child = new FakeChildProcess()
    lastChild = child
    return child as unknown as ReturnType<typeof import('node:child_process').spawn>
  }
  return { spawn, calls, getChild: () => lastChild! }
}

describe('runUrTurn spawn options', () => {
  test('never sets shell: true', () => {
    const { spawn, calls, getChild } = spawnRecorder()
    runUrTurn({ cwd: '/work', prompt: 'hi' }, noopHandlers(), { spawn })
    expect(calls).toHaveLength(1)
    const options = calls[0]!.options as { shell?: boolean }
    expect(options.shell).not.toBe(true)
    expect(options.shell).toBe(false)
    getChild().exit(0)
  })

  test('spawns `ur` with cwd from the request', () => {
    const { spawn, calls } = spawnRecorder()
    runUrTurn({ cwd: '/some/workspace', prompt: 'hi' }, noopHandlers(), { spawn })
    expect(calls[0]!.command).toBe('ur')
    expect((calls[0]!.options as { cwd: string }).cwd).toBe('/some/workspace')
  })
})

describe('runUrTurn message + result handling', () => {
  test('forwards parsed messages to onMessage', () => {
    const { spawn, getChild } = spawnRecorder()
    const messages: StdoutMessage[] = []
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onMessage: m => messages.push(m) }, { spawn })
    getChild().emitStdout('{"type":"system","subtype":"init","session_id":"s1"}\n')
    getChild().emitStdout('{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n')
    getChild().emitStdout('{"type":"result","is_error":false,"session_id":"s1"}\n')
    getChild().exit(0)
    expect(messages.map(m => m.type)).toEqual(['system', 'assistant', 'result'])
  })

  test('ok result: onExit reports ok true once a non-error result line arrives', () => {
    const { spawn, getChild } = spawnRecorder()
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    getChild().emitStdout('{"type":"result","is_error":false}\n')
    getChild().exit(0)
    expect(result?.ok).toBe(true)
    expect(result?.sawResult).toBe(true)
    expect(result?.canceled).toBe(false)
  })

  test('never reports ok when no result line was seen, even with exit code 0', () => {
    const { spawn, getChild } = spawnRecorder()
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    getChild().exit(0)
    expect(result?.ok).toBe(false)
    expect(result?.sawResult).toBe(false)
    expect(result?.error).toBeTruthy()
  })

  test('surfaces stderr as the error when the process exits non-zero with no result', () => {
    const { spawn, getChild } = spawnRecorder()
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    getChild().emitStderr('Error: When using --print, --output-format=stream-json requires --verbose\n')
    getChild().exit(1)
    expect(result?.ok).toBe(false)
    expect(result?.error).toContain('requires --verbose')
  })

  test('is_error result never gets reported as ok, even with exit code 0', () => {
    const { spawn, getChild } = spawnRecorder()
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    getChild().emitStdout('{"type":"result","is_error":true,"subtype":"error_during_execution"}\n')
    getChild().exit(0)
    expect(result?.ok).toBe(false)
    expect(result?.sawResult).toBe(true)
  })

  test('spawn failure (ENOENT-style) never fabricates a result', () => {
    const spawn = () => {
      throw new Error('spawn ur ENOENT')
    }
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    expect(result?.ok).toBe(false)
    expect(result?.sawResult).toBe(false)
    expect(result?.error).toContain('ur')
  })
})

describe('runUrTurn cancellation', () => {
  test('cancel() kills the child and onExit reports canceled true', () => {
    const { spawn, getChild } = spawnRecorder()
    let result: Parameters<Parameters<typeof runUrTurn>[1]['onExit']>[0] | undefined
    const handle = runUrTurn({ cwd: '/work', prompt: 'hi' }, { ...noopHandlers(), onExit: r => { result = r } }, { spawn })
    handle.cancel()
    expect(getChild().killed).toBe(true)
    getChild().exit(null)
    expect(result?.canceled).toBe(true)
    expect(result?.ok).toBe(false)
  })
})

describe('runUrTurn control_request handling', () => {
  test('routes a can_use_tool control_request to onControlRequest and writes control_response to stdin', async () => {
    const { spawn, getChild } = spawnRecorder()
    let received: ControlRequestEnvelope | undefined
    const handlers = {
      ...noopHandlers(),
      onControlRequest: async (request: ControlRequestEnvelope): Promise<PermissionDecision> => {
        received = request
        return { behavior: 'allow', updatedInput: { command: 'ls' } }
      },
    }
    runUrTurn({ cwd: '/work', prompt: 'hi' }, handlers, { spawn })
    getChild().emitStdout(
      '{"type":"control_request","request_id":"req-9","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"},"tool_use_id":"tu-1"}}\n',
    )
    await flushMicrotasks()
    expect(received?.request_id).toBe('req-9')
    expect(received?.request.tool_name).toBe('Bash')
    expect(getChild().stdin.writes).toHaveLength(1)
    const written = JSON.parse(getChild().stdin.writes[0]!.trim())
    expect(written.type).toBe('control_response')
    expect(written.response.request_id).toBe('req-9')
    expect(written.response.subtype).toBe('success')
    expect(written.response.response).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    getChild().exit(0)
  })

  test('writes a deny control_response when the caller denies', async () => {
    const { spawn, getChild } = spawnRecorder()
    const handlers = {
      ...noopHandlers(),
      onControlRequest: async (): Promise<PermissionDecision> => ({ behavior: 'deny', message: 'User denied' }),
    }
    runUrTurn({ cwd: '/work', prompt: 'hi' }, handlers, { spawn })
    getChild().emitStdout(
      '{"type":"control_request","request_id":"req-2","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{}}}\n',
    )
    await flushMicrotasks()
    const written = JSON.parse(getChild().stdin.writes[0]!.trim())
    expect(written.response.response).toEqual({ behavior: 'deny', message: 'User denied' })
    getChild().exit(0)
  })

  test('a handler that throws still resolves the child with a deny, never leaves it hanging', async () => {
    const { spawn, getChild } = spawnRecorder()
    const handlers = {
      ...noopHandlers(),
      onControlRequest: async (): Promise<PermissionDecision> => {
        throw new Error('UI crashed')
      },
    }
    runUrTurn({ cwd: '/work', prompt: 'hi' }, handlers, { spawn })
    getChild().emitStdout('{"type":"control_request","request_id":"req-3","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{}}}\n')
    await flushMicrotasks()
    const written = JSON.parse(getChild().stdin.writes[0]!.trim())
    expect(written.response.response.behavior).toBe('deny')
    getChild().exit(0)
  })

  test('non-can_use_tool control_request subtypes are still forwarded via onMessage but do not invoke onControlRequest', async () => {
    const { spawn, getChild } = spawnRecorder()
    let controlRequestCalls = 0
    const messages: StdoutMessage[] = []
    const handlers = {
      onMessage: (m: StdoutMessage) => messages.push(m),
      onControlRequest: async (): Promise<PermissionDecision> => {
        controlRequestCalls++
        return { behavior: 'deny', message: 'unused' }
      },
      onExit: () => {},
    }
    runUrTurn({ cwd: '/work', prompt: 'hi' }, handlers, { spawn })
    getChild().emitStdout('{"type":"control_request","request_id":"req-4","request":{"subtype":"hook_callback"}}\n')
    await flushMicrotasks()
    expect(controlRequestCalls).toBe(0)
    expect(messages).toHaveLength(1)
    getChild().exit(0)
  })
})

function noopHandlers() {
  return {
    onMessage: () => {},
    onControlRequest: async (): Promise<PermissionDecision> => ({ behavior: 'deny', message: 'unused in this test' }),
    onExit: () => {},
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
