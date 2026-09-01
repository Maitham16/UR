import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { getAllBaseTools } from '../src/tools.js'

describe('complete Tool contracts', () => {
  test('every registered tool has output validation and permission rendering', () => {
    for (const tool of getAllBaseTools()) {
      expect(tool, `${tool.name} is a non-null Tool`).toBeTruthy()
      expect(tool.outputSchema, `${tool.name} has outputSchema`).toBeDefined()
      expect(
        typeof tool.renderPermissionRequest,
        `${tool.name} has renderPermissionRequest`,
      ).toBe('function')
    }
  })

  test('feature-injected tools retain their specialized permission renderers', () => {
    const source = readFileSync(
      'src/components/permissions/toolPermissionRenderer.tsx',
      'utf8',
    )
    for (const featureName of [
      'REVIEW_ARTIFACT',
      'WORKFLOW_SCRIPTS',
      'MONITOR_TOOL',
    ]) {
      expect(source).toContain(`feature('${featureName}')`)
    }
    for (const kind of ['review-artifact', 'workflow', 'monitor']) {
      expect(source).toContain(`'${kind}'`)
    }
  })
})
