import { describe, expect, test } from 'bun:test'
import {
  getOfflineMode,
  setOfflineMode,
} from '../src/bootstrap/state.js'
import {
  formatLocalFirstProfile,
  isNetworkRestricted,
  localFirstProfile,
  offlineBlockReason,
  offlineModeSummary,
} from '../src/utils/offlineMode.js'

describe('offline mode', () => {
  test('get/set offline mode state', () => {
    setOfflineMode(false)
    expect(getOfflineMode()).toBe(false)
    setOfflineMode(true)
    expect(getOfflineMode()).toBe(true)
    setOfflineMode(false)
  })

  test('isNetworkRestricted follows state and env', () => {
    const oldOffline = process.env.UR_OFFLINE
    const oldNoCloud = process.env.UR_NO_CLOUD
    delete process.env.UR_OFFLINE
    delete process.env.UR_NO_CLOUD
    setOfflineMode(false)
    expect(isNetworkRestricted()).toBe(false)

    setOfflineMode(true)
    expect(isNetworkRestricted()).toBe(true)
    setOfflineMode(false)

    process.env.UR_OFFLINE = '1'
    expect(isNetworkRestricted()).toBe(true)

    delete process.env.UR_OFFLINE
    process.env.UR_NO_CLOUD = 'true'
    expect(isNetworkRestricted()).toBe(true)

    process.env.UR_OFFLINE = oldOffline
    process.env.UR_NO_CLOUD = oldNoCloud
    setOfflineMode(false)
  })

  test('offlineBlockReason returns clear message', () => {
    const reason = offlineBlockReason('cloud-api')
    expect(reason).toContain('offline')
    expect(reason).toContain('cloud API call')
  })

  test('offlineModeSummary includes blocked categories', () => {
    setOfflineMode(true)
    const summary = offlineModeSummary()
    expect(summary.offline).toBe(true)
    expect(summary.blockedCategories).toContain('cloud model APIs')
    expect(summary.blockedCategories).toContain('telemetry')
    setOfflineMode(false)
  })

  test('localFirstProfile describes no-cloud/private/offline strengths', () => {
    setOfflineMode(true)
    const profile = localFirstProfile(process.cwd())
    expect(profile.offline).toBe(true)
    expect(profile.posture).toContain('no cloud required')
    expect(profile.posture).toContain('private codebase friendly')
    expect(profile.posture).toContain('offline environment compatible')
    expect(profile.blockedCloudSurfaces).toContain('cloud model APIs')
    expect(profile.recommendedCommands).toContain('ur --offline')
    const formatted = formatLocalFirstProfile(profile, false)
    expect(formatted).toContain('Local-first mode: active')
    expect(formatted).toContain('edge and server development oriented')
    setOfflineMode(false)
  })
})
