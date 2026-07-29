import { describe, expect, it } from 'bun:test'
import {
  getProviderApiKeyInputColumns,
  PROVIDER_API_KEY_LABEL,
} from '../src/components/providerApiKeyInputLayout.js'

describe('provider API-key input layout', () => {
  it('uses the available pane width instead of the two-column fallback', () => {
    expect(getProviderApiKeyInputColumns(200, true)).toBe(
      200 - 4 - PROVIDER_API_KEY_LABEL.length,
    )
  })

  it('does not subtract Pane padding for an embedded picker', () => {
    expect(getProviderApiKeyInputColumns(80, false)).toBe(
      80 - PROVIDER_API_KEY_LABEL.length,
    )
  })

  it('stays safe during tiny or invalid terminal resize states', () => {
    expect(getProviderApiKeyInputColumns(5, true)).toBe(2)
    expect(getProviderApiKeyInputColumns(Number.NaN, false)).toBe(2)
  })
})
