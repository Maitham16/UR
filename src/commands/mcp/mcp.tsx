import React from 'react';
import { MCPSettings } from '../../components/mcp/index.js';
import { MCPReconnect } from '../../components/mcp/MCPReconnect.js';
import { setMcpServersDesiredState } from '../../services/mcp/desiredStateController.js';
import { formatMcpEnablementResult } from '../../services/mcp/enablement.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { errorMessage } from '../../utils/errors.js';
import { PluginSettings } from '../plugin/PluginSettings.js';

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);

    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }
    if (parts[0] === 'reconnect' && parts[1]) {
      return <MCPReconnect serverName={parts.slice(1).join(' ')} onComplete={onDone} />;
    }
    if (parts[0] === 'enable' || parts[0] === 'disable') {
      const action = parts[0];
      const target = parts.length > 1 ? parts.slice(1).join(' ') : 'all';
      const enabled = action === 'enable';
      try {
        const result = await setMcpServersDesiredState(target, enabled);
        onDone(formatMcpEnablementResult(target, enabled, result));
      } catch (error) {
        onDone(`Unable to ${action} MCP server(s): ${errorMessage(error)}`);
      }
      return null;
    }
  }

  // Redirect base /mcp command to /plugins installed tab for ant users
  if (false) {
    return <PluginSettings onComplete={onDone} args="manage" showMcpRedirectMessage />;
  }
  return <MCPSettings onComplete={onDone} />;
}
