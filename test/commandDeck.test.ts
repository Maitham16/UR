import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { deckColumnWidths } from '../src/components/commandDeck/CommandDeck.tsx'
import {
  METRIC_BAR_MIN_WIDTH,
  formatMetricValue,
  metricColor,
  metricLine,
  renderMetricBar,
} from '../src/components/commandDeck/metrics.ts'
import { deckWidthMode } from '../src/components/commandDeck/palette.ts'
import {
  DEFAULT_SECOND_ROW_ITEMS,
  DEFAULT_STATUS_ITEMS,
  layoutStatusRow,
  type StatusContext,
} from '../src/components/commandDeck/statusItems.ts'

const SIZES = [
  [80, 24],
  [100, 30],
  [120, 40],
  [160, 50],
] as const

const ctx: StatusContext = {
  model: 'glm-5.2:cloud',
  provider: 'Ollama',
  mode: 'accept edits',
  effort: 'HIGH',
  contextPercent: 71,
  editsEnabled: true,
  updateVersion: '1.68.10',
  shortcutHint: 'Shift+Tab cycle',
}

test('the house artwork is untouched', () => {
  // The one thing the redesign must not alter. Asserted on content rather
  // than trusting that nobody edited it.
  const source = readFileSync('src/components/LogoV2/UrHouse.tsx', 'utf8')
  expect(source).toContain("'    ╱╲    '")
  expect(source).toContain("' └──────┘ '")
  expect(source).toContain("' ╱╲ '")
  expect(source).toContain("'└▢▢┘'")
})

test('deck columns never exceed the terminal width', () => {
  // Overflow here is what wraps the top region and breaks the fixed layout.
  for (const [columns] of SIZES) {
    const { left, center, right } = deckColumnWidths(columns)
    expect(left + center + right).toBeLessThanOrEqual(columns - 4)
  }
})

test('every column keeps a usable width, including at 80', () => {
  for (const [columns] of SIZES) {
    const { left, center, right } = deckColumnWidths(columns)
    expect(left).toBeGreaterThanOrEqual(14)
    expect(center).toBeGreaterThan(13) // must hold the 13-wide wordmark
    expect(right).toBeGreaterThanOrEqual(12)
  }
})

test('the right column stops growing, so wide terminals do not leave a void', () => {
  // The previous banner gave all slack to the right and left it empty.
  const wide = deckColumnWidths(200)
  expect(wide.right).toBeLessThanOrEqual(22)
  expect(wide.left).toBeLessThanOrEqual(30)
  expect(wide.center).toBeGreaterThan(wide.left + wide.right)
})

test('the status rail never wraps at any supported size', () => {
  for (const [columns] of SIZES) {
    for (const items of [DEFAULT_STATUS_ITEMS, DEFAULT_SECOND_ROW_ITEMS]) {
      const rendered = layoutStatusRow(
        items,
        ctx,
        columns,
        deckWidthMode(columns),
      )
      const width =
        rendered.reduce((sum, r) => sum + r.text.length, 0) +
        Math.max(0, rendered.length - 1) * 3
      expect(width).toBeLessThanOrEqual(columns)
    }
  }
})

test('the three documented presets render as specified', () => {
  const at = (columns: number) =>
    layoutStatusRow(
      DEFAULT_STATUS_ITEMS,
      ctx,
      columns,
      deckWidthMode(columns),
    )
      .map(r => r.text)
      .join('   ')

  expect(at(160)).toBe('glm-5.2:cloud   Ollama   ACCEPT EDITS   HIGH   CTX 71%')
  expect(at(100)).toBe('glm-5.2   EDITS   CTX 71%')
  expect(at(40)).toBe('EDITS   CTX 71%')
})

test('context usage survives every degradation', () => {
  // Priority exists so the two things worth knowing at a glance — what mode
  // you are in and how full the context is — are the last to go.
  for (const columns of [160, 120, 100, 80, 40, 24]) {
    const ids = layoutStatusRow(
      DEFAULT_STATUS_ITEMS,
      ctx,
      columns,
      deckWidthMode(columns),
    ).map(r => r.id)
    expect(ids).toContain('context')
    expect(ids).toContain('mode')
  }
})

test('an absent value hides its item rather than printing a placeholder', () => {
  const bare: StatusContext = {
    ...ctx,
    effort: null,
    updateVersion: null,
    contextPercent: null,
  }
  const ids = layoutStatusRow(
    [...DEFAULT_STATUS_ITEMS, ...DEFAULT_SECOND_ROW_ITEMS],
    bare,
    160,
    'full',
  ).map(r => r.id)
  expect(ids).not.toContain('effort')
  expect(ids).not.toContain('update')
  expect(ids).not.toContain('context')
})

test('metric alignment does not shift as values change', () => {
  // A readout that jitters between 9% and 100% is why the values are padded.
  const widths = [3, 28, 100, null].map(
    percent => metricLine({ label: 'CTX', percent }, 24).value.length,
  )
  expect(new Set(widths).size).toBe(1)
})

test('metric bars are dropped, not squeezed, in a narrow column', () => {
  expect(metricLine({ label: 'CPU', percent: 28 }, 12).bar).toBe('')
  expect(
    metricLine({ label: 'CPU', percent: 28 }, METRIC_BAR_MIN_WIDTH).bar.length,
  ).toBeGreaterThan(0)
})

test('metric colour reports level, so one rule reads every metric', () => {
  expect(metricColor(28)).toBe('accent')
  expect(metricColor(80)).toBe('warning')
  expect(metricColor(95)).toBe('error')
  expect(metricColor(null)).toBe('muted')
})

test('an unknown metric renders as unknown, not as zero', () => {
  expect(formatMetricValue(null).trim()).toBe('--')
  expect(renderMetricBar(null, 9)).toBe('─'.repeat(9))
})

test('width mode matches the documented breakpoints', () => {
  expect(deckWidthMode(160)).toBe('full')
  expect(deckWidthMode(120)).toBe('full')
  expect(deckWidthMode(100)).toBe('compact')
  expect(deckWidthMode(80)).toBe('compact')
  expect(deckWidthMode(60)).toBe('minimal')
})

// --- system metrics + fixed-row budget ---

test('the first CPU reading is null, not zero', async () => {
  // cpus() reports cumulative ticks since boot, so one sample carries no rate.
  // Reporting 0% on the first render would be a fabricated number at every
  // startup, and it would read as "idle" rather than as "not measured yet".
  const { readCpuPercent, resetCpuSampling } = await import(
    '../src/components/commandDeck/systemMetrics.ts'
  )
  resetCpuSampling()
  expect(readCpuPercent()).toBeNull()
})

test('a later CPU reading is a real percentage', async () => {
  const { readCpuPercent, resetCpuSampling } = await import(
    '../src/components/commandDeck/systemMetrics.ts'
  )
  resetCpuSampling()
  readCpuPercent()
  const value = readCpuPercent()
  if (value !== null) {
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(100)
  }
})

test('memory is a bounded percentage', async () => {
  const { readMemoryPercent } = await import(
    '../src/components/commandDeck/systemMetrics.ts'
  )
  const value = readMemoryPercent()
  expect(value).not.toBeNull()
  expect(value!).toBeGreaterThan(0)
  expect(value!).toBeLessThanOrEqual(100)
})

test('context is passed in, not discovered by the deck', async () => {
  // Context usage is session state, not machine state.
  const { readSystemMetrics } = await import(
    '../src/components/commandDeck/systemMetrics.ts'
  )
  const metrics = readSystemMetrics(71)
  expect(metrics.map(m => m.label)).toEqual(['CPU', 'MEM', 'CTX'])
  expect(metrics[2]!.percent).toBe(71)
  expect(readSystemMetrics(null)[2]!.percent).toBeNull()
})

test('the fixed regions leave room to scroll at every required size', async () => {
  const { fixedRowsFor, hasRoomForDeck } = await import(
    '../src/components/commandDeck/CommandDeckLayout.tsx'
  )
  for (const [columns, rows] of SIZES) {
    expect(hasRoomForDeck(columns, rows)).toBe(true)
    expect(rows - fixedRowsFor(columns)).toBeGreaterThanOrEqual(6)
  }
})

test('a terminal too short for the shell is reported, not silently squeezed', async () => {
  // Without flexShrink={0} Ink shrinks the fixed regions instead of scrolling
  // the middle, so the deck loses rows with no indication. Callers check this
  // and fall back rather than rendering a shell with nothing inside it.
  const { hasRoomForDeck } = await import(
    '../src/components/commandDeck/CommandDeckLayout.tsx'
  )
  expect(hasRoomForDeck(120, 20)).toBe(false)
  expect(hasRoomForDeck(80, 16)).toBe(false)
})
