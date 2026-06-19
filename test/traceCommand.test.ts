import { describe, expect, test } from 'bun:test'
import trace from '../src/commands/trace'

async function loadCall() {
  if (trace.type !== 'local') throw new Error('expected local command')
  const mod = await trace.load()
  return mod.call
}

function ctx(messages: any[]): any {
  return { messages }
}

describe('/trace', () => {
  test('reports empty session', async () => {
    const call = await loadCall()
    const out = await call('', ctx([]))
    expect(out.type).toBe('text')
    if (out.type === 'text') expect(out.value).toContain('No messages')
  })

  test('shows last N messages with role and uuid prefix', async () => {
    const call = await loadCall()
    const messages = [
      { type: 'user', uuid: '11111111-2222-3333-4444-555555555555', message: { role: 'user', content: 'fix the bug' } },
      { type: 'assistant', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/x.ts' } }] } },
    ]
    const out = await call('', ctx(messages))
    if (out.type !== 'text') throw new Error('expected text')
    expect(out.value).toContain('Trace: last 2 of 2')
    expect(out.value).toContain('11111111')
    expect(out.value).toContain('aaaaaaaa')
    expect(out.value).toContain('text: fix the bug')
    expect(out.value).toContain('text: On it.')
    expect(out.value).toContain('tool_use: Edit(')
  })

  test('caps depth and parses argument', async () => {
    const call = await loadCall()
    const many = Array.from({ length: 12 }, (_, i) => ({
      type: 'user',
      uuid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      message: { role: 'user', content: `m${i}` },
    }))
    const out = await call('3', ctx(many))
    if (out.type !== 'text') throw new Error('expected text')
    expect(out.value).toContain('Trace: last 3 of 12')
    expect(out.value).not.toContain('m0')
    expect(out.value).toContain('m11')
  })

  test('extracts VERDICT line from assistant text', async () => {
    const call = await loadCall()
    const out = await call('', ctx([
      { type: 'assistant', uuid: 'cccccccc-1111-2222-3333-444444444444', message: { role: 'assistant', content: [{ type: 'text', text: 'I checked the build and tests.\n\nVERDICT: PASS' }] } },
    ]))
    if (out.type !== 'text') throw new Error('expected text')
    expect(out.value).toContain('verdict: PASS')
  })

  test('marks tool_result errors', async () => {
    const call = await loadCall()
    const out = await call('', ctx([
      { type: 'user', uuid: 'dddddddd-1111-2222-3333-444444444444', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'EACCES: permission denied' }] } },
    ]))
    if (out.type !== 'text') throw new Error('expected text')
    expect(out.value).toContain('tool_result ERROR (id=tu_1)')
    expect(out.value).toContain('permission denied')
  })
})
