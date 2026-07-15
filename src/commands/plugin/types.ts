import type { LocalJSXCommandOnDone } from '../../types/command.js'

export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone
  args: string
  showMcpRedirectMessage?: boolean
}

export type ViewState =
  | { type: 'menu' | 'help' | 'marketplace-list' | 'marketplace-menu' }
  | { type: 'validate'; path?: string }
  | {
      type: 'browse-marketplace'
      targetMarketplace?: string
      targetPlugin?: string
    }
  | { type: 'discover-plugins'; targetPlugin?: string }
  | {
      type: 'manage-plugins'
      targetPlugin?: string
      targetMarketplace?: string
      action?: 'uninstall' | 'enable' | 'disable'
    }
  | { type: 'add-marketplace'; initialValue?: string }
  | {
      type: 'manage-marketplaces'
      targetMarketplace?: string
      action?: 'remove' | 'update'
    }
