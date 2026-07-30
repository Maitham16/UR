import { expect, test } from 'bun:test'
import { recoverExplicitChoiceToolUse } from '../src/services/tools/explicitChoiceRecovery.ts'
import { AskUserQuestionTool } from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx'
import type { AssistantMessage } from '../src/types/message.ts'
import {
  collectExplicitChoiceCandidates,
  parseExplicitChoicePrompt,
} from '../src/utils/explicitChoiceRecovery.ts'

const EXACT_REASONING_INPUT = {
  questions: [
    {
      question:
        'The requested game includes many detailed features (multiple enemy types, boss phases, upgrades, audio, UI, etc.). Implementing all of them in a single HTML file is a large effort. Would you prefer a full implementation covering every listed feature, or a core version with essential gameplay (player ship, basic enemies, simple upgrades) that can be expanded later?',
      header: 'Scope',
      options: [
        {
          label: 'Full implementation (all features)',
          description:
            'Attempt to include every enemy type, boss, upgrade system, audio, UI, and visual effects as described.',
        },
        {
          label: 'Core version (essential gameplay)',
          description:
            'Provide a functional game with player ship, basic enemies, and a simple upgrade system, leaving room for later expansion.',
        },
      ],
      multiSelect: false,
    },
  ],
}

const EXACT_REASONING =
  'Probably better to ask which scope the user wants. We should ask a question using AskUserQuestion tool.' +
  JSON.stringify(EXACT_REASONING_INPUT)

const EXACT_MENU =
  'Here’s a quick decision point to make sure we meet your expectations efficiently.  \n\n' +
  '**Which scope should we target?**  \n\n' +
  '- **Full implementation (all features)** – Attempt to include every enemy type, boss phases, upgrade system, audio, UI, and visual effects as described.  \n' +
  '- **Core version (essential gameplay)** – Provide a functional game with the player ship, basic enemies, and a simple upgrade system, leaving room for later expansion.  \n\n' +
  'Please select the option that best fits your needs.  '

function assistant(
  content: Array<Record<string, unknown>>,
  stopReason: 'end_turn' | 'tool_use' | null,
  uuid: string,
): AssistantMessage {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: 'openrouter-request',
      type: 'message',
      role: 'assistant',
      model: 'openai/gpt-oss-120b',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
      },
    },
  }
}

test('recovers canonical AskUserQuestion JSON at the end of explicit reasoning', () => {
  const candidates = collectExplicitChoiceCandidates({
    thinkingBlocks: [EXACT_REASONING],
    textBlocks: [],
  })

  expect(candidates).toEqual([
    {
      input: EXACT_REASONING_INPUT,
      source: 'thinking_json',
      remainingText: '',
    },
  ])
})

test('routes the exact OpenRouter reasoning failure into a real tool_use block', () => {
  const ids = ['tool-id', 'assistant-id']
  const result = recoverExplicitChoiceToolUse({
    assistantMessages: [
      assistant(
        [
          {
            type: 'thinking',
            thinking: EXACT_REASONING,
            signature: '',
          },
        ],
        null,
        'thinking-message',
      ),
      assistant([{ type: 'text', text: EXACT_MENU }], 'end_turn', 'text-message'),
    ],
    tools: [AskUserQuestionTool],
    isNonInteractiveSession: false,
    uuid: () => ids.shift()!,
  })

  expect(result?.source).toBe('thinking_json')
  expect(result?.toolUse.name).toBe('AskUserQuestion')
  expect(result?.toolUse.input).toEqual(EXACT_REASONING_INPUT)
  expect(result?.assistantMessage.uuid).toBe('assistant-id')
  expect(result?.assistantMessage.message?.stop_reason).toBe('tool_use')
  expect(result?.assistantMessage.message?.content).toEqual([result?.toolUse])
})

test('falls back to the exact explicit Markdown menu without inventing choice text', () => {
  const result = recoverExplicitChoiceToolUse({
    assistantMessages: [
      assistant([{ type: 'text', text: EXACT_MENU }], 'end_turn', 'menu-message'),
    ],
    tools: [AskUserQuestionTool],
    isNonInteractiveSession: false,
    uuid: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
  })

  expect(result?.source).toBe('markdown_menu')
  expect(result?.toolUse.input).toEqual({
    questions: [
      {
        question: 'Which scope should we target?',
        header: 'Scope',
        options: [
          {
            label: 'Full implementation (all features)',
            description:
              'Attempt to include every enemy type, boss phases, upgrade system, audio, UI, and visual effects as described.',
          },
          {
            label: 'Core version (essential gameplay)',
            description:
              'Provide a functional game with the player ship, basic enemies, and a simple upgrade system, leaving room for later expansion.',
          },
        ],
      },
    ],
  })
})

test('real Ask schema rejects an overlong reasoning label instead of truncating it', () => {
  const invalidInput = {
    questions: [
      {
        question: 'Which scope?',
        header: 'Scope',
        options: [
          { label: 'A'.repeat(81) },
          { label: 'Core version' },
        ],
      },
    ],
  }
  const result = recoverExplicitChoiceToolUse({
    assistantMessages: [
      assistant(
        [
          {
            type: 'thinking',
            thinking:
              'We need to use AskUserQuestion tool.' +
              JSON.stringify(invalidInput),
          },
        ],
        'end_turn',
        'invalid-message',
      ),
    ],
    tools: [AskUserQuestionTool],
    isNonInteractiveSession: false,
    uuid: () => 'unused',
  })

  expect(result).toBeNull()
})

test('reasoning recovery compacts only an overlong presentation header', () => {
  const input = structuredClone(EXACT_REASONING_INPUT)
  input.questions[0]!.header = 'Scope decision'
  const result = recoverExplicitChoiceToolUse({
    assistantMessages: [
      assistant(
        [
          {
            type: 'thinking',
            thinking:
              'We should use AskUserQuestion tool.' + JSON.stringify(input),
          },
        ],
        'end_turn',
        'overlong-header',
      ),
    ],
    tools: [AskUserQuestionTool],
    isNonInteractiveSession: false,
    uuid: (() => {
      let index = 0
      return () => `header-id-${++index}`
    })(),
  })

  expect(result?.toolUse.input).toEqual({
    ...input,
    questions: [
      {
        ...input.questions[0],
        header: 'Scope',
      },
    ],
  })
  expect(
    (
      result?.toolUse.input.questions as typeof input.questions
    )[0]?.options,
  ).toEqual(input.questions[0]?.options)
})

test('reasoning recovery rejects examples, non-final JSON, and ambiguous duplicates', () => {
  const serialized = JSON.stringify(EXACT_REASONING_INPUT)
  for (const thinkingBlocks of [
    [`For example, use AskUserQuestion tool:\n${serialized}`],
    [`We should use AskUserQuestion tool.\n${serialized}\nContinue reasoning.`],
    [EXACT_REASONING, EXACT_REASONING],
    [`The response data is:\n${serialized}`],
  ]) {
    expect(
      collectExplicitChoiceCandidates({
        thinkingBlocks,
        textBlocks: [],
      }),
    ).toEqual([])
  }
})

test('Markdown recovery rejects ordinary prose and incomplete or ambiguous menus', () => {
  const invalidMenus = [
    'Should I use TypeScript or JavaScript?',
    '**Which language?**\n- **TypeScript** – Static types.\n- **JavaScript** – No compile step.',
    '**Which language?**\n- **TypeScript** – Static types.\n- **JavaScript** – No compile step.\nPlease select the option.\nExtra prose.',
    '**Which language?**\n- **TypeScript** - Static types.\n- **JavaScript** - No compile step.\nPlease select the option.',
    '**Which language?**\n- **TypeScript** – Static types.\n- **JavaScript** – No compile step.\n**Which runtime?**\n- **Bun** – Fast.\n- **Node** – Broad support.\nPlease select the option.',
    '```json\n{"questions":[]}\n```',
  ]

  for (const text of invalidMenus) {
    expect(parseExplicitChoicePrompt(text)).toBeNull()
  }
})

test('tool recovery is disabled outside a completed interactive main-agent turn', () => {
  const completed = [
    assistant([{ type: 'text', text: EXACT_MENU }], 'end_turn', 'menu-message'),
  ]
  const incomplete = [
    assistant([{ type: 'text', text: EXACT_MENU }], null, 'menu-message'),
  ]
  const nativeToolUse = [
    assistant(
      [
        {
          type: 'tool_use',
          id: 'native-call',
          name: 'AskUserQuestion',
          input: EXACT_REASONING_INPUT,
        },
      ],
      'end_turn',
      'native-message',
    ),
  ]
  const disabledAskTool = {
    ...AskUserQuestionTool,
    isEnabled: () => false,
  }

  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: completed,
      tools: [AskUserQuestionTool],
      agentId: 'worker-1',
      isNonInteractiveSession: false,
      uuid: () => 'unused',
    }),
  ).toBeNull()
  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: completed,
      tools: [AskUserQuestionTool],
      isNonInteractiveSession: true,
      uuid: () => 'unused',
    }),
  ).toBeNull()
  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: incomplete,
      tools: [AskUserQuestionTool],
      isNonInteractiveSession: false,
      uuid: () => 'unused',
    }),
  ).toBeNull()
  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: completed,
      tools: [],
      isNonInteractiveSession: false,
      uuid: () => 'unused',
    }),
  ).toBeNull()
  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: completed,
      tools: [disabledAskTool],
      isNonInteractiveSession: false,
      uuid: () => 'unused',
    }),
  ).toBeNull()
  expect(
    recoverExplicitChoiceToolUse({
      assistantMessages: nativeToolUse,
      tools: [AskUserQuestionTool],
      isNonInteractiveSession: false,
      uuid: () => 'unused',
    }),
  ).toBeNull()
})
