import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toOllamaChatRequest } from '../src/services/api/ollama.js'
import { createAssistantMessage, createUserMessage, normalizeMessagesForAPI } from '../src/utils/messages.js'

const capabilities = new Set(['tools', 'thinking'])

test('Ollama history retains exact reasoning separately from text and tool calls', () => {
  const request = toOllamaChatRequest({
    model: 'reasoning-history-fixture',
    messages: [
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'first thought\n  ' },
        { type: 'thinking', thinking: 'exact indentation', signature: 'not-an-ollama-field' },
        { type: 'redacted_thinking', data: 'opaque-not-plaintext' },
        { type: 'text', text: 'Checking two facts.' },
        { type: 'tool_use', id: 'read-one', name: 'Read', input: { file_path: '/fixture.txt' } },
        { type: 'tool_use', id: 'bash-two', name: 'Bash', input: { command: 'pwd' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'read-one', content: 'file result' },
        { type: 'tool_result', tool_use_id: 'bash-two', content: '/fixture' },
      ] },
    ],
  } as never, false, capabilities)

  expect(request.messages).toEqual([
    {
      role: 'assistant',
      content: 'Checking two facts.',
      thinking: 'first thought\n  exact indentation',
      tool_calls: [
        { function: { name: 'Read', arguments: { file_path: '/fixture.txt' } } },
        { function: { name: 'Bash', arguments: { command: 'pwd' } } },
      ],
    },
    { role: 'tool', content: 'file result', tool_name: 'Read' },
    { role: 'tool', content: '/fixture', tool_name: 'Bash' },
  ])
  expect(JSON.stringify(request)).not.toContain('opaque-not-plaintext')
  expect(JSON.stringify(request)).not.toContain('not-an-ollama-field')
})

test('Ollama keeps a reasoning-only assistant message without manufacturing visible output', () => {
  const request = toOllamaChatRequest({
    model: 'reasoning-history-fixture',
    messages: [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'unfinished thought' }] },
      { role: 'user', content: 'Continue.' },
    ],
  } as never, false, capabilities)
  expect(request.messages).toEqual([
    { role: 'assistant', content: '', thinking: 'unfinished thought' },
    { role: 'user', content: 'Continue.' },
  ])
})

test('Ollama ignores empty and opaque-only reasoning while preserving normal text', () => {
  const request = toOllamaChatRequest({
    model: 'reasoning-history-fixture',
    messages: [
      { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
      { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'protected' }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Visible answer.' },
      ] },
    ],
  } as never, false, capabilities)
  expect(request.messages).toEqual([{ role: 'assistant', content: 'Visible answer.' }])
})

test('Ollama normalization retains a capped reasoning-only cutoff while default filtering is unchanged', () => {
  const thought = 'Unfinished reasoning\n  with exact indentation.'
  const prompt = createUserMessage({ content: 'Complete the task.' })
  const assistant = createAssistantMessage({ content: [
    { type: 'thinking', thinking: thought, signature: 'protected-signature' },
    { type: 'redacted_thinking', data: 'opaque-do-not-send' },
  ] })
  assistant.message.stop_reason = 'max_tokens'
  const continuation = createUserMessage({ content: 'Continue from the cutoff.', isMeta: true })
  const history = [prompt, assistant, continuation]
  expect(normalizeMessagesForAPI(history).some(message => message.type === 'assistant')).toBe(false)

  for (const messages of [history, [prompt, assistant]]) {
    const normalized = normalizeMessagesForAPI(messages, [], { preserveThinkingOnly: true })
    const request = toOllamaChatRequest({
      model: 'reasoning-history-fixture', messages: normalized.map(message => message.message),
    } as never, false, capabilities)
    expect(request.messages.find(message => message.role === 'assistant')).toEqual({
      role: 'assistant', content: '', thinking: thought,
    })
    expect(JSON.stringify(request)).not.toContain('opaque-do-not-send')
    expect(JSON.stringify(request)).not.toContain('protected-signature')
    expect(JSON.stringify(request)).not.toContain('[No message content]')
  }
  expect(assistant.message.content[0].thinking).toBe(thought)
})

test('preserved Ollama normalization never manufactures empty or opaque reasoning messages on the wire', () => {
  const normalized = normalizeMessagesForAPI([
    createAssistantMessage({ content: [{ type: 'thinking', thinking: '' }] }),
    createAssistantMessage({ content: [{ type: 'redacted_thinking', data: 'opaque' }] }),
    createUserMessage({ content: 'Continue.' }),
  ], [], { preserveThinkingOnly: true })
  const request = toOllamaChatRequest({
    model: 'reasoning-history-fixture', messages: normalized.map(message => message.message),
  } as never, false, capabilities)
  expect(request.messages).toEqual([{ role: 'user', content: 'Continue.' }])
})

for (const streaming of [false, true]) {
  test(`Ollama ${streaming ? 'streaming' : 'non-streaming'} reasoning survives API normalization and a real followup request`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ur-ollama-reasoning-'))
    const ollamaModule = fileURLToPath(new URL('../src/services/api/ollama.ts', import.meta.url))
    const messagesModule = fileURLToPath(new URL('../src/utils/messages.ts', import.meta.url))
    // Fetch is replaced only in this isolated child. The test exercises the
    // actual client/stream adapter and outbound JSON without contacting a model.
    const script = `
      import assert from 'node:assert/strict';
      import { createOllamaURHQClient } from ${JSON.stringify(ollamaModule)};
      import { createAssistantMessage, createUserMessage, normalizeMessagesForAPI } from ${JSON.stringify(messagesModule)};
      const streaming = ${JSON.stringify(streaming)};
      const thought = 'Plan the check.\\n  Preserve this exact reasoning.';
      const calls = [
        { function: { name: 'Read', arguments: { file_path: '/fixture.txt' } } },
        { function: { name: 'Bash', arguments: { command: 'pwd' } } },
      ];
      const requests = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'http://reasoning-history.invalid');
        if (url.pathname === '/api/show') return Response.json({ capabilities: ['tools', 'thinking'] });
        assert.equal(url.pathname, '/api/chat');
        const body = JSON.parse(init.body);
        requests.push(body);
        if (requests.length === 1 && streaming) {
          const chunks = [
            { message: { role: 'assistant', thinking: 'Plan the check.\\n  ' }, done: false },
            { message: { role: 'assistant', thinking: 'Preserve this exact reasoning.' }, done: false },
            { message: { role: 'assistant', content: 'Checking.' }, done: false },
            { message: { role: 'assistant', tool_calls: [calls[0]] }, done: false },
            { message: { role: 'assistant', tool_calls: [calls[1]] }, done: false },
            { message: { role: 'assistant', content: '' }, done: true, done_reason: 'tool_calls' },
          ];
          return new Response(chunks.map(chunk => JSON.stringify(chunk)).join('\\n') + '\\n');
        }
        return Response.json({
          model: 'reasoning-history-fixture', done: true, done_reason: 'stop',
          message: requests.length === 1
            ? { role: 'assistant', thinking: thought, content: 'Checking.', tool_calls: calls }
            : { role: 'assistant', content: 'Both checks passed.' },
        });
      };
      const client = createOllamaURHQClient({ baseUrlOverride: 'http://reasoning-history.invalid' });
      const tools = calls.map(call => ({
        name: call.function.name, description: 'Fixture tool',
        input_schema: { type: 'object', properties: {} },
      }));
      const prompt = createUserMessage({ content: 'Check both facts.' });
      const params = { model: 'reasoning-history-fixture', max_tokens: 256, tools, messages: normalizeMessagesForAPI([prompt]).map(message => message.message) };
      let content;
      if (streaming) {
        const { data } = await client.beta.messages.create({ ...params, stream: true }).withResponse();
        const blocks = new Map();
        const json = new Map();
        for await (const event of data) {
          if (event.type === 'content_block_start') blocks.set(event.index, structuredClone(event.content_block));
          if (event.type === 'content_block_delta') {
            const block = blocks.get(event.index);
            if (event.delta.type === 'thinking_delta') block.thinking += event.delta.thinking;
            if (event.delta.type === 'text_delta') block.text += event.delta.text;
            if (event.delta.type === 'input_json_delta') json.set(event.index, (json.get(event.index) ?? '') + event.delta.partial_json);
          }
        }
        content = [...blocks].map(([index, block]) => block.type === 'tool_use'
          ? { ...block, input: JSON.parse(json.get(index) || '{}') } : block);
      } else {
        content = (await client.beta.messages.create(params)).content;
      }
      const thoughtBlock = content.find(block => block.type === 'thinking');
      assert.equal(thoughtBlock.thinking, thought);
      const toolUses = content.filter(block => block.type === 'tool_use');
      assert.equal(toolUses.length, 2);
      const assistant = createAssistantMessage({ content });
      const toolResult = createUserMessage({ content: toolUses.map((block, index) => ({
        type: 'tool_result', tool_use_id: block.id, content: index === 0 ? 'file result' : '/fixture',
      })) });
      const normalized = normalizeMessagesForAPI([prompt, assistant, toolResult]);
      const result = await client.beta.messages.create({
        ...params, messages: normalized.map(message => message.message), stream: false,
      });
      assert.equal(requests.length, 2);
      const history = requests[1].messages;
      const carried = history.find(message => message.role === 'assistant');
      assert.equal(carried.thinking, thought);
      assert.equal(carried.content, 'Checking.');
      assert.deepEqual(carried.tool_calls, calls);
      assert.deepEqual(history.filter(message => message.role === 'tool'), [
        { role: 'tool', tool_name: 'Read', content: 'file result' },
        { role: 'tool', tool_name: 'Bash', content: '/fixture' },
      ]);
      assert.deepEqual(result.content, [{ type: 'text', text: 'Both checks passed.' }]);
      console.log(JSON.stringify({ passed: true, requests: requests.length, streaming }));
    `
    try {
      const result = spawnSync(process.execPath, ['--eval', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: directory,
          UR_CONFIG_DIR: join(directory, 'config'),
          XDG_CONFIG_HOME: join(directory, 'config'),
          XDG_CACHE_HOME: join(directory, 'cache'),
          NODE_ENV: 'test',
          USER_TYPE: 'external',
          DISABLE_TELEMETRY: '1',
          DISABLE_ERROR_REPORTING: '1',
        },
      })
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
      expect(JSON.parse(result.stdout.trim())).toEqual({ passed: true, requests: 2, streaming })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 120_000)
}
