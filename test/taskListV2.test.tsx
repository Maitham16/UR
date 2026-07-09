import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render } from 'ink-testing-library'
import React from 'react'
import { TaskListV2 } from '../src/components/TaskListV2.js'
import { AppStateProvider } from '../src/state/AppState.js'
import { Task } from '../src/utils/tasks.js'
import { stripAnsi } from '../src/utils/format.js'

// Mock the useTerminalSize hook
mock.module('../src/hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ rows: 24, columns: 80 }),
}))

// Mock the useAppState hook
mock.module('../src/state/AppState.js', () => ({
  useAppState: (selector) => {
    if (selector.toString().includes('tasks')) {
      return {}
    }
    if (selector.toString().includes('showTeammateMessagePreview')) {
      return false
    }
    if (selector.toString().includes('teamContext')) {
      return null
    }
    return undefined
  },
  useSetAppState: () => () => {},
}))

// Mock the isTodoV2Enabled function
mock.module('../src/utils/tasks.js', () => ({
  isTodoV2Enabled: () => true,
}))

describe('TaskListV2', () => {
  let tasks: Task[]

  beforeEach(() => {
    tasks = [
      {
        id: '1',
        subject: 'Test task 1',
        description: 'Description 1',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
      {
        id: '2',
        subject: 'Test task 2',
        description: 'Description 2',
        status: 'in_progress',
        blocks: [],
        blockedBy: [],
      },
      {
        id: '3',
        subject: 'Test task 3',
        description: 'Description 3',
        status: 'completed',
        blocks: [],
        blockedBy: [],
      },
    ]
  })

  afterEach(() => {
    mock.restore()
  })

  it('should render all tasks with correct status indicators', () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <TaskListV2 tasks={tasks} />
      </AppStateProvider>
    )

    const output = stripAnsi(lastFrame() || '')

    // Check that pending task is shown with square icon
    expect(output).toContain('□')
    expect(output).toContain('Test task 1')

    // Check that in_progress task is shown with filled square icon
    expect(output).toContain('■')
    expect(output).toContain('Test task 2')

    // Check that completed task is shown with checkmark icon
    expect(output).toContain('✓')
    expect(output).toContain('Test task 3')
  })

  it('should show completed tasks as checked', () => {
    const completedTasks = tasks.map(task => ({
      ...task,
      status: 'completed' as const,
    }))

    const { lastFrame } = render(
      <AppStateProvider>
        <TaskListV2 tasks={completedTasks} />
      </AppStateProvider>
    )

    const output = stripAnsi(lastFrame() || '')

    // All tasks should show checkmark icon
    expect(output).toMatch(/✓.*Test task 1/)
    expect(output).toMatch(/✓.*Test task 2/)
    expect(output).toMatch(/✓.*Test task 3/)
  })

  it('should not show duplicate separators or stale blocks', () => {
    const { lastFrame, rerender } = render(
      <AppStateProvider>
        <TaskListV2 tasks={tasks} />
      </AppStateProvider>
    )

    const firstOutput = stripAnsi(lastFrame() || '')

    // Update tasks to simulate progress
    const updatedTasks = tasks.map(task => ({
      ...task,
      status: task.id === '1' ? 'in_progress' : task.status,
    }))

    rerender(
      <AppStateProvider>
        <TaskListV2 tasks={updatedTasks} />
      </AppStateProvider>
    )

    const secondOutput = stripAnsi(lastFrame() || '')

    // Count occurrences of separators
    const firstSeparatorCount = (firstOutput.match(/─/g) || []).length
    const secondSeparatorCount = (secondOutput.match(/─/g) || []).length

    // Should not have duplicate separators
    expect(secondSeparatorCount).toBeLessThanOrEqual(firstSeparatorCount + 2) // Allow for minor changes

    // Should not show stale status for updated task
    expect(secondOutput).toContain('■ Test task 1') // Should now be in progress
  })

  it('should handle empty task list', () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <TaskListV2 tasks={[]} />
      </AppStateProvider>
    )

    const output = lastFrame()
    expect(output).toBeNull()
  })
})