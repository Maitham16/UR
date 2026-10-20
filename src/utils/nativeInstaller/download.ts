/** Public native release metadata and downloads use the same GitHub release contract. */
export {
  fetchNativeVersion as getLatestVersion,
  fetchNativeManifest,
  nativeAssetUrl,
  parseNativeManifest,
  validateNativeVersion,
} from '../nativeRelease.js'
