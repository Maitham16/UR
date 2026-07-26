import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendSideChatExchange,
  appendSideChatTurn,
  assertSideChatExchangeCapacity,
  closeSideChat,
  createSideChat,
  getSideChat,
  listSideChats,
  renameSideChat,
} from '../src/services/sideChats/sideChatStore.js'
import { buildSideQuestionPrompt } from '../src/utils/sideQuestion.js'

describe('durable side chats', () => {
  test('persists continuations, metadata, and closed state', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-side-chats-'))
    try {
      const created = createSideChat({
        title: 'Cache question',
        parentSessionId: 'session-1',
        parentMessageId: 'message-1',
        root,
      })
      appendSideChatTurn(created.id, 'user', 'How does it work?', { root })
      appendSideChatTurn(created.id, 'assistant', 'It uses a bounded cache.', {
        root,
      })
      const renamed = renameSideChat(created.id, 'Cache details', root)
      expect(renamed.turnCount).toBe(2)
      expect(listSideChats({ root })[0]!.title).toBe('Cache details')
      expect(getSideChat(created.id, root).turns[1]!.role).toBe('assistant')

      closeSideChat(created.id, root)
      expect(() =>
        appendSideChatTurn(created.id, 'user', 'one more', { root }),
      ).toThrow('closed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('detects transcript tampering and supplies bounded history to the fork', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-side-chat-integrity-'))
    try {
      const chat = createSideChat({
        title: 'Integrity',
        parentSessionId: 'session-2',
        root,
      })
      appendSideChatTurn(chat.id, 'user', 'original', { root })
      const path = join(root, `${chat.id}.json`)
      writeFileSync(path, readFileSync(path, 'utf8').replace('original', 'changed'))
      expect(() => getSideChat(chat.id, root)).toThrow('integrity')

      const prompt = buildSideQuestionPrompt('next', [
        { role: 'user', content: 'previous' },
        { role: 'assistant', content: 'answer' },
      ])
      expect(prompt).toContain('User: previous')
      expect(prompt).toContain('Assistant: answer')
      expect(prompt).toContain('CURRENT SIDE-CHAT QUESTION:\nnext')

      const bounded = buildSideQuestionPrompt(
        'latest?',
        Array.from({ length: 20 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `turn-${index}-${'x'.repeat(3_000)}`,
        })),
      )
      expect(bounded).toContain('turn-19-')
      expect(bounded).not.toContain('turn-0-')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('persists complete exchanges atomically and reserves two turns', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-side-chat-exchange-'))
    try {
      const chat = createSideChat({
        title: 'Atomic exchange',
        parentSessionId: 'session-3',
        root,
      })
      for (let index = 0; index < 198; index++) {
        appendSideChatTurn(
          chat.id,
          index % 2 === 0 ? 'user' : 'assistant',
          `turn-${index}`,
          { root },
        )
      }
      assertSideChatExchangeCapacity(chat.id, root)
      const full = appendSideChatExchange(chat.id, 'last question', 'last answer', {
        root,
      })
      expect(full.turnCount).toBe(200)
      expect(full.turns.slice(-2).map(turn => turn.role)).toEqual([
        'user',
        'assistant',
      ])
      expect(() => assertSideChatExchangeCapacity(chat.id, root)).toThrow(
        'two free turns',
      )
      expect(getSideChat(chat.id, root).turnCount).toBe(200)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
