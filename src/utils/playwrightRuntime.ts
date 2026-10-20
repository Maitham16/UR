import type * as Playwright from 'playwright-core'
import { isInBundledMode } from './bundledMode.js'
import { loadNativeModule } from './nativeResources.js'

let loaded: typeof Playwright | undefined

/** The native install owns Playwright's JS/resources; the project need not. */
export async function loadPlaywright(): Promise<typeof Playwright> {
  if (!loaded) {
    loaded = isInBundledMode()
      ? loadNativeModule<typeof Playwright>('playwright-core')
      : await import('playwright-core')
  }
  return loaded
}
