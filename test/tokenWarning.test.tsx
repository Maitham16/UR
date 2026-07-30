import { afterEach, beforeEach, expect, test } from 'bun:test'
import * as React from 'react'
import { TokenWarning } from '../src/components/TokenWarning.js'
import { getAutoCompactThreshold } from '../src/services/compact/autoCompact.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
} from '../src/utils/config.js'
import { renderToString } from '../src/utils/staticRender.js'
import stripAnsi from 'strip-ansi'

const MODEL = 'claude-sonnet-4-6'
let originalAutoCompactEnabled: boolean
let originalAutoThreshold: number | undefined

beforeEach(() => {
  const config = getGlobalConfig()
  originalAutoCompactEnabled = config.autoCompactEnabled
  originalAutoThreshold = config.compactionAutoThreshold
  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: true,
    compactionAutoThreshold: undefined,
  }))
})

afterEach(() => {
  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: originalAutoCompactEnabled,
    compactionAutoThreshold: originalAutoThreshold,
  }))
})

test('shows auto-compact progress before the warning band', async () => {
  const rendered = stripAnsi(
    await renderToString(
      <TokenWarning tokenUsage={1_000} model={MODEL} />,
      80,
    ),
  )

  expect(rendered).toContain('≈')
  expect(rendered).toContain('% until auto-compact')
})

test('uses a warning stage before the final error stage', async () => {
  const threshold = getAutoCompactThreshold(MODEL)
  const warningOnly = stripAnsi(
    await renderToString(
      <TokenWarning tokenUsage={threshold - 10_000} model={MODEL} />,
      80,
    ),
  )
  const finalBand = stripAnsi(
    await renderToString(
      <TokenWarning tokenUsage={threshold - 1_000} model={MODEL} />,
      80,
    ),
  )

  expect(warningOnly).toContain('% until auto-compact')
  expect(finalBand).toContain('% until auto-compact')
  expect(warningOnly).not.toBe(finalBand)
})

test('does not claim an auto-compact countdown when it is disabled', async () => {
  saveGlobalConfig(current => ({
    ...current,
    autoCompactEnabled: false,
  }))

  const rendered = stripAnsi(
    await renderToString(
      <TokenWarning tokenUsage={1_000} model={MODEL} />,
      80,
    ),
  )

  expect(rendered).not.toContain('until auto-compact')
})
