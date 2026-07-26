import { describe, expect, test } from 'bun:test'
import {
  fileSuffixForOauthConfig,
  getOauthConfig,
} from '../src/constants/oauth.js'

function restoreEnvironment(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('OAuth configuration selection', () => {
  test('honors the explicit local OAuth development configuration', () => {
    const previous = {
      USER_TYPE: process.env.USER_TYPE,
      USE_LOCAL_OAUTH: process.env.USE_LOCAL_OAUTH,
      UR_LOCAL_OAUTH_API_BASE: process.env.UR_LOCAL_OAUTH_API_BASE,
      UR_LOCAL_OAUTH_APPS_BASE: process.env.UR_LOCAL_OAUTH_APPS_BASE,
      UR_LOCAL_OAUTH_CONSOLE_BASE: process.env.UR_LOCAL_OAUTH_CONSOLE_BASE,
    }
    try {
      process.env.USER_TYPE = 'ant'
      process.env.USE_LOCAL_OAUTH = '1'
      process.env.UR_LOCAL_OAUTH_API_BASE = 'http://127.0.0.1:8100/'
      process.env.UR_LOCAL_OAUTH_APPS_BASE = 'http://127.0.0.1:4100/'
      process.env.UR_LOCAL_OAUTH_CONSOLE_BASE = 'http://127.0.0.1:3100/'

      const config = getOauthConfig()
      expect(config.BASE_API_URL).toBe('http://127.0.0.1:8100')
      expect(config.TOKEN_URL).toBe('http://127.0.0.1:8100/v1/oauth/token')
      expect(config.UR_AI_AUTHORIZE_URL).toBe(
        'http://127.0.0.1:4100/oauth/authorize',
      )
      expect(config.CONSOLE_AUTHORIZE_URL).toBe(
        'http://127.0.0.1:3100/oauth/authorize',
      )
      expect(fileSuffixForOauthConfig()).toBe('-local-oauth')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        restoreEnvironment(key, value)
      }
    }
  })
})
