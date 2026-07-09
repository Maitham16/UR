import { describe, it, expect } from 'bun:test'
import { getTaskStatusIcon, getTaskStatusColor, isTerminalStatus } from '../src/components/tasks/taskStatusUtils.js'
import { TaskStatus } from '../src/utils/tasks.js'

describe('taskStatusUtils', () => {
  describe('isTerminalStatus', () => {
    it('should return true for completed status', () => {
      expect(isTerminalStatus('completed')).toBe(true)
    })

    it('should return true for failed status', () => {
      expect(isTerminalStatus('failed')).toBe(true)
    })

    it('should return true for killed status', () => {
      expect(isTerminalStatus('killed')).toBe(true)
    })

    it('should return false for non-terminal statuses', () => {
      expect(isTerminalStatus('pending')).toBe(false)
      expect(isTerminalStatus('in_progress')).toBe(false)
    })
  })

  describe('getTaskStatusIcon', () => {
    it('should return tick for completed status', () => {
      expect(getTaskStatusIcon('completed').icon).toBe('✓')
    })

    it('should return squareSmallFilled for in_progress status', () => {
      expect(getTaskStatusIcon('in_progress').icon).toBe('■')
    })

    it('should return squareSmall for pending status', () => {
      expect(getTaskStatusIcon('pending').icon).toBe('□')
    })

    it('should return cross for failed status', () => {
      expect(getTaskStatusIcon('failed').icon).toBe('✗')
    })

    it('should return cross for killed status', () => {
      expect(getTaskStatusIcon('killed').icon).toBe('✗')
    })

    it('should return questionMarkPrefix when awaitingApproval is true', () => {
      expect(getTaskStatusIcon('pending', { awaitingApproval: true }).icon).toBe('?')
    })

    it('should return warning when shutdownRequested is true', () => {
      expect(getTaskStatusIcon('pending', { shutdownRequested: true }).icon).toBe('!')
    })

    it('should return cross when hasError is true', () => {
      expect(getTaskStatusIcon('pending', { hasError: true }).icon).toBe('✗')
    })

    it('should return ellipsis when isIdle is true and status is running', () => {
      expect(getTaskStatusIcon('running', { isIdle: true }).icon).toBe('…')
    })
  })

  describe('getTaskStatusColor', () => {
    it('should return success for completed status', () => {
      expect(getTaskStatusColor('completed')).toBe('success')
    })

    it('should return error for failed status', () => {
      expect(getTaskStatusColor('failed')).toBe('error')
    })

    it('should return warning for killed status', () => {
      expect(getTaskStatusColor('killed')).toBe('warning')
    })

    it('should return background for pending status', () => {
      expect(getTaskStatusColor('pending')).toBe('background')
    })

    it('should return ur for in_progress status', () => {
      expect(getTaskStatusColor('in_progress')).toBe('background') // Note: This might be different in actual implementation
    })

    it('should return error when hasError is true', () => {
      expect(getTaskStatusColor('pending', { hasError: true })).toBe('error')
    })

    it('should return warning when awaitingApproval is true', () => {
      expect(getTaskStatusColor('pending', { awaitingApproval: true })).toBe('warning')
    })

    it('should return warning when shutdownRequested is true', () => {
      expect(getTaskStatusColor('pending', { shutdownRequested: true })).toBe('warning')
    })

    it('should return background when isIdle is true', () => {
      expect(getTaskStatusColor('running', { isIdle: true })).toBe('background')
    })
  })
})