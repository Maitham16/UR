import { describe, expect, it } from 'bun:test'
import figures from 'figures'
import {
  getTaskStatusColor,
  getTaskStatusIcon,
  isTerminalStatus,
} from '../src/components/tasks/taskStatusUtils.js'

// getTaskStatusIcon/getTaskStatusColor take the background-task TaskStatus
// union from src/Task.ts ('pending' | 'running' | 'completed' | 'failed' |
// 'killed') and return a plain figures glyph string / theme color name.
// (An earlier version of this file asserted a {icon} object shape and an
// 'in_progress' status that never existed — it tested an imagined API.)

describe('taskStatusUtils', () => {
  describe('isTerminalStatus', () => {
    it('returns true for completed status', () => {
      expect(isTerminalStatus('completed')).toBe(true)
    })

    it('returns true for failed status', () => {
      expect(isTerminalStatus('failed')).toBe(true)
    })

    it('returns true for killed status', () => {
      expect(isTerminalStatus('killed')).toBe(true)
    })

    it('returns false for non-terminal statuses', () => {
      expect(isTerminalStatus('pending')).toBe(false)
      expect(isTerminalStatus('running')).toBe(false)
    })
  })

  describe('getTaskStatusIcon', () => {
    it('returns tick for completed status', () => {
      expect(getTaskStatusIcon('completed')).toBe(figures.tick)
    })

    it('returns play for running status', () => {
      expect(getTaskStatusIcon('running')).toBe(figures.play)
    })

    it('returns bullet for pending status', () => {
      expect(getTaskStatusIcon('pending')).toBe(figures.bullet)
    })

    it('returns cross for failed status', () => {
      expect(getTaskStatusIcon('failed')).toBe(figures.cross)
    })

    it('returns cross for killed status', () => {
      expect(getTaskStatusIcon('killed')).toBe(figures.cross)
    })

    it('returns questionMarkPrefix when awaitingApproval is true', () => {
      expect(getTaskStatusIcon('running', { awaitingApproval: true })).toBe(
        figures.questionMarkPrefix,
      )
    })

    it('returns warning when shutdownRequested is true', () => {
      expect(getTaskStatusIcon('running', { shutdownRequested: true })).toBe(
        figures.warning,
      )
    })

    it('returns cross when hasError is true', () => {
      expect(getTaskStatusIcon('running', { hasError: true })).toBe(
        figures.cross,
      )
    })

    it('returns ellipsis when isIdle is true and status is running', () => {
      expect(getTaskStatusIcon('running', { isIdle: true })).toBe(
        figures.ellipsis,
      )
    })

    it('prioritizes hasError over other state flags', () => {
      expect(
        getTaskStatusIcon('running', {
          hasError: true,
          awaitingApproval: true,
          shutdownRequested: true,
        }),
      ).toBe(figures.cross)
    })
  })

  describe('getTaskStatusColor', () => {
    it('returns success for completed status', () => {
      expect(getTaskStatusColor('completed')).toBe('success')
    })

    it('returns error for failed status', () => {
      expect(getTaskStatusColor('failed')).toBe('error')
    })

    it('returns warning for killed status', () => {
      expect(getTaskStatusColor('killed')).toBe('warning')
    })

    it('returns background for pending and running statuses', () => {
      expect(getTaskStatusColor('pending')).toBe('background')
      expect(getTaskStatusColor('running')).toBe('background')
    })

    it('returns error when hasError is true', () => {
      expect(getTaskStatusColor('completed', { hasError: true })).toBe('error')
    })

    it('returns warning when awaitingApproval or shutdownRequested', () => {
      expect(getTaskStatusColor('running', { awaitingApproval: true })).toBe(
        'warning',
      )
      expect(getTaskStatusColor('running', { shutdownRequested: true })).toBe(
        'warning',
      )
    })

    it('returns background when isIdle is true', () => {
      expect(getTaskStatusColor('completed', { isIdle: true })).toBe(
        'background',
      )
    })
  })
})
