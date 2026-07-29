import { expect, test } from 'bun:test'
import * as React from 'react'
import {
  AgentProgressLine,
  getAgentProgressStatus,
} from '../src/components/AgentProgressLine.js'
import {
  compactApiError,
  formatApiRetryStatus,
  SystemAPIErrorMessage,
} from '../src/components/messages/SystemAPIErrorMessage.js'
import { PromptInputFooterSuggestions } from '../src/components/PromptInput/PromptInputFooterSuggestions.js'
import { stringWidth } from '../src/ink/stringWidth.js'
import { renderToString } from '../src/utils/staticRender.js'
import stripAnsi from 'strip-ansi'

test('failed agents are never presented as done or backgrounded', async () => {
  expect(
    getAgentProgressStatus({
      isResolved: true,
      isError: true,
      isBackgrounded: false,
    }),
  ).toBe('Failed')

  const rendered = await renderToString(
    <AgentProgressLine
      agentType="worker"
      description="Audit implementation"
      toolUseCount={3}
      tokens={1200}
      isLast
      isResolved
      isError
      isAsync
    />,
    60,
  )

  expect(rendered).toContain('Failed')
  expect(rendered).not.toContain('Done')
  expect(rendered).not.toContain('Running in the background')
})

test('agent progress stays bounded on narrow terminals', async () => {
  const rendered = await renderToString(
    <AgentProgressLine
      agentType="worker"
      description="A very long activity description for a narrow terminal"
      toolUseCount={42}
      tokens={987654}
      isLast
      isResolved={false}
      isError={false}
      lastToolInfo="Reading a deeply nested source file with a very long path"
    />,
    28,
  )

  expect(rendered.split('\n')).toHaveLength(2)
  expect(rendered).not.toContain('deeply nested source file')
})

test('early API retries render concise live status instead of disappearing', async () => {
  const error = {
    message: 'Service temporarily unavailable',
    status: 503,
  }
  const rendered = await renderToString(
    <SystemAPIErrorMessage
      message={{
        retryAttempt: 1,
        maxRetries: 3,
        retryInMs: 2000,
        error,
      } as never}
      verbose={false}
    />,
    80,
  )

  expect(rendered).toContain('API retry 1/3 in 2s')
  expect(rendered).toContain('Service temporarily unavailable')
})

test('retry labels handle final and persistent attempts honestly', () => {
  expect(formatApiRetryStatus(2, 3, 2500, 0)).toBe('API retry 2/3 in 3s')
  expect(formatApiRetryStatus(4, 3, 2500, 3000)).toBe(
    'API retry 4 starting',
  )
  expect(
    compactApiError({
      message: 'x'.repeat(200),
      status: 500,
    } as never),
  ).toEndWith('…')
})

test('prompt suggestions remain single-line and bounded in narrow terminals', async () => {
  const suggestions = [
    {
      id: 'file-deep',
      displayText: 'src/components/a/deeply/nested/PromptInput.tsx',
      description: 'TypeScript source file',
    },
    {
      id: 'command-long',
      displayText: '/a-very-long-command',
      tag: 'command',
      description: 'A long command description',
    },
  ]

  for (const columns of [4, 8, 12]) {
    const rendered = await renderToString(
      <PromptInputFooterSuggestions
        suggestions={suggestions}
        selectedSuggestion={0}
      />,
      columns,
    )
    const lines = rendered.split('\n').filter(Boolean)

    expect(lines.length).toBeGreaterThan(0)
    expect(
      lines.every(line => stringWidth(stripAnsi(line)) <= columns),
    ).toBe(true)
  }
})
