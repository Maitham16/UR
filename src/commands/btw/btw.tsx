import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useInterval } from 'usehooks-ts'
import type { CommandResultDisplay } from '../../commands.js'
import { Markdown } from '../../components/Markdown.js'
import { SpinnerGlyph } from '../../components/Spinner/SpinnerGlyph.js'
import { DOWN_ARROW, UP_ARROW } from '../../constants/figures.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { useModalOrTerminalSize } from '../../context/modalContext.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import ScrollBox, {
  type ScrollBoxHandle,
} from '../../ink/components/ScrollBox.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { getSessionId } from '../../bootstrap/state.js'
import { createAbortController } from '../../utils/abortController.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { errorMessage } from '../../utils/errors.js'
import {
  type CacheSafeParams,
  getLastCacheSafeParams,
} from '../../utils/forkedAgent.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { runSideQuestion } from '../../utils/sideQuestion.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import {
  appendSideChatExchange,
  assertSideChatExchangeCapacity,
  closeSideChat,
  createSideChat,
  getSideChat,
  listSideChats,
  renameSideChat,
  type SideChat,
} from '../../services/sideChats/sideChatStore.js'

type BtwComponentProps = {
  chatId: string
  question: string
  context: ProcessUserInputContext
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

const CHROME_ROWS = 5
const OUTER_CHROME_ROWS = 6
const SCROLL_LINES = 3

function BtwSideQuestion({
  chatId,
  question,
  context,
  onDone,
}: BtwComponentProps): React.ReactNode {
  const [response, setResponse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const scrollRef = useRef<ScrollBoxHandle>(null)
  const startedRef = useRef(false)
  const { rows } = useModalOrTerminalSize(useTerminalSize())

  useInterval(() => setFrame(value => value + 1), response || error ? null : 80)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const abortController = createAbortController()
    void (async () => {
      try {
        const existing = getSideChat(chatId)
        assertSideChatExchangeCapacity(chatId)
        const history = existing.turns.map(turn => ({
          role: turn.role,
          content: turn.content,
        }))
        const cacheSafeParams = await buildCacheSafeParams(context)
        const result = await runSideQuestion({
          question,
          cacheSafeParams,
          history,
          abortController,
        })
        if (abortController.signal.aborted) return
        if (!result.response) {
          setError('No response received')
          return
        }
        appendSideChatExchange(chatId, question, result.response, {
          usage: result.usage,
        })
        setResponse(result.response)
      } catch (caught) {
        if (!abortController.signal.aborted) {
          setError(errorMessage(caught) || 'Failed to get response')
        }
      }
    })()
    return () => abortController.abort()
  }, [chatId, context, question])

  const handleKeyDown = (event: {
    key: string
    ctrl: boolean
    preventDefault(): void
  }) => {
    if (
      event.key === 'escape' ||
      event.key === 'return' ||
      event.key === ' ' ||
      (event.ctrl && (event.key === 'c' || event.key === 'd'))
    ) {
      event.preventDefault()
      onDone(undefined, { display: 'skip' })
      return
    }
    if (event.key === 'up' || (event.ctrl && event.key === 'p')) {
      event.preventDefault()
      scrollRef.current?.scrollBy(-SCROLL_LINES)
    }
    if (event.key === 'down' || (event.ctrl && event.key === 'n')) {
      event.preventDefault()
      scrollRef.current?.scrollBy(SCROLL_LINES)
    }
  }

  const maxContentHeight = Math.max(
    5,
    rows - CHROME_ROWS - OUTER_CHROME_ROWS,
  )
  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
      marginTop={1}
      tabIndex={0}
      autoFocus
      onKeyDown={handleKeyDown}
    >
      <Box>
        <Text color="warning" bold>
          /btw{' '}
        </Text>
        <Text dimColor>{question}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2} maxHeight={maxContentHeight}>
        <ScrollBox ref={scrollRef} flexDirection="column" flexGrow={1}>
          {error ? (
            <Text color="error">{error}</Text>
          ) : response ? (
            <Markdown>{response}</Markdown>
          ) : (
            <Box>
              <SpinnerGlyph frame={frame} messageColor="warning" />
              <Text color="warning">Answering…</Text>
            </Box>
          )}
        </ScrollBox>
      </Box>
      {(response || error) && (
        <Box marginTop={1}>
          <Text dimColor>
            Saved as {chatId.slice(0, 8)} · {UP_ARROW}/{DOWN_ARROW} to scroll ·
            Space, Enter, or Escape to dismiss
          </Text>
        </Box>
      )}
    </Box>
  )
}

function stripInProgressAssistantMessage(messages: Message[]): Message[] {
  const last = messages.at(-1)
  if (last?.type === 'assistant' && last.message.stop_reason === null) {
    return messages.slice(0, -1)
  }
  return messages
}

async function buildCacheSafeParams(
  context: ProcessUserInputContext,
): Promise<CacheSafeParams> {
  const forkContextMessages = getMessagesAfterCompactBoundary(
    stripInProgressAssistantMessage(context.messages),
  )
  const saved = getLastCacheSafeParams()
  if (saved) {
    return {
      systemPrompt: saved.systemPrompt,
      userContext: saved.userContext,
      systemContext: saved.systemContext,
      toolUseContext: context,
      forkContextMessages,
    }
  }
  const [rawSystemPrompt, userContext, systemContext] = await Promise.all([
    getSystemPrompt(
      context.options.tools,
      context.options.mainLoopModel,
      [],
      context.options.mcpClients,
    ),
    getUserContext(),
    getSystemContext(),
  ])
  return {
    systemPrompt: asSystemPrompt(rawSystemPrompt),
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  }
}

function usage(): string {
  return [
    'Usage:',
    '  /btw <question>',
    '  /btw continue <chat-id> <question>',
    '  /btw list',
    '  /btw show <chat-id>',
    '  /btw rename <chat-id> <title>',
    '  /btw close <chat-id>',
  ].join('\n')
}

function formatSideChat(chat: SideChat): string {
  const lines = [
    `${chat.title} (${chat.id})`,
    `Status: ${chat.status} · Turns: ${chat.turnCount}`,
    '',
  ]
  let bytes = Buffer.byteLength(lines.join('\n'))
  for (const turn of chat.turns) {
    const line = `${turn.role === 'user' ? 'You' : 'Assistant'}: ${turn.content}`
    if (bytes + Buffer.byteLength(line) > 64 * 1024) {
      lines.push('… transcript truncated')
      break
    }
    lines.push(line, '')
    bytes += Buffer.byteLength(`${line}\n`)
  }
  return lines.join('\n').trim()
}

/**
 * Everything after the first `count` whitespace-delimited words, preserved
 * exactly. Used for the free-text tail of `continue <id> …` and `rename <id> …`
 * so punctuation and spacing survive. Safe because the words being skipped are
 * subcommand names and chat ids, which never contain quotes or spaces.
 */
function dropLeadingWords(raw: string, count: number): string {
  let rest = raw
  for (let index = 0; index < count; index++) {
    rest = rest.replace(/^\s*\S+/, '')
  }
  return rest.trim()
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ProcessUserInputContext,
  args: string,
): Promise<React.ReactNode> {
  const raw = (args ?? '').trim()
  const tokens = parseArguments(raw)
  if (tokens.length === 0) {
    onDone(usage(), { display: 'system' })
    return null
  }

  try {
    const action = tokens[0]!.toLowerCase()
    if (action === 'list') {
      const chats = listSideChats()
      onDone(
        chats.length
          ? chats
              .map(
                chat =>
                  `${chat.id}  ${chat.status.padEnd(6)}  ${chat.turnCount} turns  ${chat.title}`,
              )
              .join('\n')
          : 'No side chats yet.',
        { display: 'system' },
      )
      return null
    }
    if (action === 'show') {
      if (!tokens[1]) throw new Error(usage())
      onDone(formatSideChat(getSideChat(tokens[1])), { display: 'system' })
      return null
    }
    if (action === 'rename') {
      if (!tokens[1] || tokens.length < 3) throw new Error(usage())
      const chat = renameSideChat(tokens[1], dropLeadingWords(raw, 2))
      onDone(`Renamed side chat ${chat.id} to “${chat.title}”.`, {
        display: 'system',
      })
      return null
    }
    if (action === 'close') {
      if (!tokens[1]) throw new Error(usage())
      const chat = closeSideChat(tokens[1])
      onDone(`Closed side chat ${chat.id}.`, { display: 'system' })
      return null
    }

    let chatId: string
    let question: string
    if (action === 'continue') {
      if (!tokens[1] || tokens.length < 3) throw new Error(usage())
      const chat = getSideChat(tokens[1])
      if (chat.status !== 'open') throw new Error('Side chat is closed')
      chatId = chat.id
      question = dropLeadingWords(raw, 2)
    } else {
      // Tokenizing and rejoining a free-text question is lossy even when no
      // token is dropped: it collapses runs of whitespace and respaces
      // punctuation. Only the subcommand needs tokens; the question is the
      // user's text, verbatim.
      question = raw
      const parentMessageId = context.messages.at(-1)?.uuid
      const chat = createSideChat({
        title: question,
        parentSessionId: getSessionId(),
        parentMessageId,
      })
      chatId = chat.id
    }

    saveGlobalConfig(current => ({
      ...current,
      btwUseCount: current.btwUseCount + 1,
    }))
    return (
      <BtwSideQuestion
        chatId={chatId}
        question={question}
        context={context}
        onDone={onDone}
      />
    )
  } catch (caught) {
    onDone(errorMessage(caught) || 'Side-chat command failed', {
      display: 'system',
    })
    return null
  }
}
