import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Box } from '../../ink.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { CommandDeck } from './CommandDeck.js'
import { hasRoomForDeck } from './CommandDeckLayout.js'
import { StatusRail } from './StatusRail.js'
import type { Metric } from './metrics.js'
import { readSystemMetrics } from './systemMetrics.js'
import type { StatusContext, StatusItem } from './statusItems.js'

/**
 * Drop-in shell: renders the fixed deck, the caller's existing content, and the
 * fixed rail, sized against the live terminal.
 *
 * Wrapping from outside rather than adding a `top` slot to FullscreenLayout is
 * deliberate. That file is React-Compiler output with hand-numbered memo slots
 * ($[11]..$[23] in one fragment) and @ts-nocheck on top; inserting a slot means
 * renumbering the sequence, and an off-by-one there yields cached JSX rendered
 * against changed props — a bug that neither throws nor typechecks. Composing
 * around it needs no edit to generated code.
 *
 * AlternateScreen already supplies <Box height={rows}>, so this nests inside an
 * existing constraint rather than introducing a second one.
 *
 * Presentational on purpose: it imports nothing but ink and useTerminalSize.
 * An earlier version read live state itself — settings, provider registry,
 * app state, git — and importing this from REPL changed REPL's module graph
 * enough to flip a command from hidden to visible, caught by
 * commandRegistryIntegrity. Loading a module is not free in this codebase;
 * some of them register things. Values now arrive as props from a caller that
 * already has them.
 */

export type CommandDeckShellProps = {
  version: string
  /**
   * Supplied by the caller. Anything omitted renders empty rather than being
   * looked up here — see the note above on why this component stays inert.
   */
  workspaceBasename?: string
  repository?: string
  workspacePath?: string
  branch?: string | null
  model?: string
  provider?: string
  mode?: string
  effort?: string | null
  contextPercent?: number | null
  editsEnabled?: boolean
  updateVersion?: string | null
  shortcutHint?: string | null
  /** Session start, for the SESSION field. */
  startedAt?: number
  /** Sampling period for CPU/MEM. */
  metricIntervalMs?: number
  statusItems?: StatusItem[]
  secondRowItems?: StatusItem[]
  children: React.ReactNode
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function formatClock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
}

export function CommandDeckShell({
  version,
  workspaceBasename: workspaceBasenameProp,
  repository: repositoryProp,
  workspacePath: workspacePathProp,
  branch: branchProp,
  model: modelProp,
  provider: providerProp,
  mode: modeProp,
  effort = null,
  contextPercent = null,
  editsEnabled: editsEnabledProp,
  updateVersion = null,
  shortcutHint = 'Shift+Tab cycle',
  startedAt,
  metricIntervalMs = 2000,
  statusItems,
  secondRowItems,
  children,
}: CommandDeckShellProps): React.ReactNode {
  const { columns, rows } = useTerminalSize()
  const [tick, setTick] = useState(0)

  // process.cwd() is a syscall, not a module import: no registration side
  // effects, which is the whole point of keeping this component inert.
  const cwd = process.cwd()
  const folder = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
  const workspaceBasename = workspaceBasenameProp ?? folder
  const repository = repositoryProp ?? folder
  const workspacePath = workspacePathProp ?? cwd
  const model = modelProp ?? ''
  const provider = providerProp ?? ''
  const branch = branchProp ?? null
  const mode = modeProp ?? ''
  const editsEnabled = editsEnabledProp ?? false

  // One timer drives the clock, the session elapsed time and the CPU delta.
  // CPU is only meaningful as a difference between samples, so it has to be
  // read on a schedule rather than per render — a render-time read would
  // report the gap since the last repaint, which varies with typing speed.
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), metricIntervalMs)
    return () => clearInterval(timer)
  }, [metricIntervalMs])

  const metrics: Metric[] = useMemo(
    () => readSystemMetrics(contextPercent),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, contextPercent],
  )

  const statusContext: StatusContext = {
    model,
    provider,
    mode,
    effort,
    contextPercent,
    editsEnabled,
    updateVersion,
    shortcutHint,
  }

  // Too short for deck + rail + a few lines of conversation: render the
  // content alone. A shell with no room inside it is worse than no shell,
  // and Ink would otherwise shrink the fixed regions silently.
  if (!hasRoomForDeck(columns, rows)) {
    return <>{children}</>
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexShrink={0} flexDirection="column">
        <CommandDeck
          columns={columns}
          version={version}
          workspaceBasename={workspaceBasename}
          branch={branch}
          clock={formatClock(new Date())}
          model={model}
          repository={repository}
          workspacePath={workspacePath}
          sessionTime={formatElapsed(
            startedAt === undefined ? 0 : Date.now() - startedAt,
          )}
          metrics={metrics}
        />
      </Box>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {children}
      </Box>
      <Box flexShrink={0} flexDirection="column">
        <StatusRail
          columns={columns}
          context={statusContext}
          items={statusItems}
          secondRowItems={secondRowItems}
        />
      </Box>
    </Box>
  )
}
