import React, { useEffect, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import { executeURTmuxCommand } from '../../utils/tmuxSocket.js'

const POLL_INTERVAL_MS = 750
const PANEL_LINES = 24

/** Live, read-only view of the active Tungsten pane. */
export function TungstenLiveMonitor(): React.ReactNode {
  const activeSession = useAppState(state => state.tungstenActiveSession)
  const panelVisible = useAppState(
    state =>
      (state.tungstenPanelVisible ?? true) &&
      !state.tungstenPanelAutoHidden,
  )
  const [frame, setFrame] = useState('')

  useEffect(() => {
    if (!activeSession || !panelVisible) return

    let cancelled = false
    const refresh = async () => {
      const result = await executeURTmuxCommand([
        'capture-pane',
        '-p',
        '-J',
        '-S',
        `-${PANEL_LINES}`,
        '-t',
        activeSession.target,
      ])
      if (cancelled) return
      setFrame(
        result.code === 0
          ? result.stdout.trimEnd()
          : `Unable to capture ${activeSession.target}: ${result.stderr.trim()}`,
      )
    }

    void refresh()
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeSession, panelVisible])

  if (!activeSession || !panelVisible) return null

  return React.createElement(
    Box,
    { flexDirection: 'column', paddingX: 1 },
    React.createElement(
      Text,
      { bold: true },
      `tmux · ${activeSession.sessionName} · ${activeSession.target}`,
    ),
    React.createElement(
      Text,
      null,
      frame || 'Waiting for terminal output…',
    ),
  )
}
