import { expect, test } from 'bun:test'
import { migratemodelOTomodelO1m } from '../src/migrations/migratemodelOTomodelO1m.js'
import { ismodelO1mMergeEnabled } from '../src/utils/model/model.js'

test('model preference migration never blocks credential-free CI startup', () => {
  const names = [
    'CI',
    'UR_CODE_OAUTH_TOKEN',
    'UR_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    'UR_CODE_API_KEY_FILE_DESCRIPTOR',
  ] as const
  const previous = Object.fromEntries(
    names.map(name => [name, process.env[name]]),
  )
  try {
    process.env.CI = '1'
    delete process.env.UR_CODE_OAUTH_TOKEN
    delete process.env.UR_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
    delete process.env.UR_CODE_API_KEY_FILE_DESCRIPTOR
    expect(ismodelO1mMergeEnabled()).toBe(false)
    expect(() => migratemodelOTomodelO1m()).not.toThrow()
  } finally {
    for (const name of names) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
