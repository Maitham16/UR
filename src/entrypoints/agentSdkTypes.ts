/**
 * Internal type barrel shared by the CLI's structured I/O, hooks, and remote
 * transport code. UR's supported programmatic interface is the documented
 * `ur -p` stream-json protocol; this module deliberately exposes no runtime
 * SDK functions.
 */

/** @alpha */
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'
export * from './sdk/coreTypes.js'
export type { SettingsJson as Settings } from '../utils/settings/types.js'
