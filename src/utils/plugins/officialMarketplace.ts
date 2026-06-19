/**
 * Constants for the official UR plugins marketplace.
 *
 * The marketplace is hosted on GitHub in the same repository as the agent
 * itself. This file defines the constants needed to install and identify
 * this marketplace.
 */

import type { MarketplaceSource } from './schemas.js'

/**
 * Source configuration for the official UR plugins marketplace.
 * Used when auto-installing the marketplace on startup.
 */
export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: 'Maitham16/UR-mapek',
} as const satisfies MarketplaceSource

/**
 * Display name for the official marketplace.
 * This is the name under which the marketplace will be registered
 * in the known_marketplaces.json file.
 */
export const OFFICIAL_MARKETPLACE_NAME = 'ur-plugins-official'
