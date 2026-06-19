/**
 * Bun plugin that provides a runtime implementation of the `bun:bundle` module.
 *
 * In production, Bun's bundler statically replaces `feature()` calls at compile
 * time. During development (running unbundled with `bun run`), this plugin
 * intercepts `bun:bundle` imports and returns a stub where every feature flag
 * is `false` by default.
 *
 * To enable specific flags during dev, set the env var FEATURE_FLAGS as a
 * comma-separated list:
 *
 *   FEATURE_FLAGS=KAIROS,VOICE_MODE bun run src/main.tsx
 */
import { plugin } from 'bun'

const enabledFlags = new Set(
  (process.env.FEATURE_FLAGS ?? '').split(',').filter(Boolean),
)

plugin({
  name: 'bun-bundle-dev',
  setup(build) {
    build.module('bun:bundle', () => ({
      exports: {
        feature(flag: string): boolean {
          return enabledFlags.has(flag)
        },
      },
      loader: 'object',
    }))
  },
})
