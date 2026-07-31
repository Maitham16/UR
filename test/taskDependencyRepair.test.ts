import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..')
const TOOL = readFileSync(
  path.join(repoRoot, 'src/tools/TaskUpdateTool/TaskUpdateTool.ts'),
  'utf8',
)

/**
 * Reproduces the shape of the edge list the tool builds, so the self-edge rule
 * can be asserted without standing up a task store.
 */
function buildEdges(
  taskId: string,
  addBlocks: string[] | undefined,
  addBlockedBy: string[] | undefined,
): Array<{ fromTaskId: string; toTaskId: string; field: string }> {
  return [
    ...(addBlocks ?? []).map(targetId => ({
      fromTaskId: taskId,
      toTaskId: targetId,
      field: 'addBlocks',
    })),
    ...(addBlockedBy ?? []).map(blockerId => ({
      fromTaskId: blockerId,
      toTaskId: taskId,
      field: 'addBlockedBy',
    })),
  ].filter(edge => edge.fromTaskId !== edge.toTaskId)
}

describe('self-dependencies are dropped, not fatal', () => {
  test('a task blocking itself produces no edge', () => {
    // The reported failure: "Invalid blockedBy dependency #3 -> #3:
    // self_dependency" rejected the entire update, discarding the status
    // change and every other valid edge in the same call.
    expect(buildEdges('3', undefined, ['3'])).toEqual([])
    expect(buildEdges('8', ['8'], undefined)).toEqual([])
  })

  test('valid edges in the same call survive alongside a self-edge', () => {
    const edges = buildEdges('3', undefined, ['3', '1', '2'])
    expect(edges.map(e => e.fromTaskId)).toEqual(['1', '2'])
    expect(edges.every(e => e.toTaskId === '3')).toBe(true)
  })

  test('both directions are filtered independently', () => {
    const edges = buildEdges('4', ['4', '5'], ['4', '6'])
    expect(edges).toEqual([
      { fromTaskId: '4', toTaskId: '5', field: 'addBlocks' },
      { fromTaskId: '6', toTaskId: '4', field: 'addBlockedBy' },
    ])
  })

  test('an update with only a self-edge still has no dependencies to validate', () => {
    expect(buildEdges('7', ['7'], ['7'])).toHaveLength(0)
  })
})

describe('the tool applies the self-edge rule', () => {
  test('requestedDependencies filters self-edges before validation', () => {
    expect(TOOL).toContain('.filter(edge => edge.fromTaskId !== edge.toTaskId)')
  })

  test('the reported field list excludes self-edges too', () => {
    // Otherwise the tool would claim it updated `blocks` while committing nothing.
    expect(TOOL).toContain("id => id !== taskId && !existingTask.blocks.includes(id)")
    expect(TOOL).toContain("id => id !== taskId && !existingTask.blockedBy.includes(id)")
  })
})

describe('unknown dependency targets are reported actionably', () => {
  test('the error names the missing id and lists what exists', () => {
    // A bare "task_not_found" gave the caller nothing to correct, so the usual
    // response was to retry the identical edge.
    expect(TOOL).toContain('no such task')
    expect(TOOL).toContain('existing tasks:')
  })

  test('the detail is only computed for task_not_found', () => {
    expect(TOOL).toContain("dependencyValidation.reason === 'task_not_found'")
  })

  test('an empty task list is described rather than rendered blank', () => {
    expect(TOOL).toContain("|| 'none'")
  })
})
