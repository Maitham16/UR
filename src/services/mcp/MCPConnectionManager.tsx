import React, { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import type { Command } from '../../commands.js';
import type { Tool } from '../../Tool.js';
import type { MCPServerConnection, ScopedMcpServerConfig, ServerResource } from './types.js';
import { registerMcpDesiredStateHandler } from './desiredStateController.js';
import { useManageMCPConnections } from './useManageMCPConnections.js';
interface MCPConnectionContextValue {
  reconnectMcpServer: (serverName: string) => Promise<{
    client: MCPServerConnection;
    tools: Tool[];
    commands: Command[];
    resources?: ServerResource[];
  }>;
  toggleMcpServer: (serverName: string) => Promise<void>;
}
const MCPConnectionContext = createContext<MCPConnectionContextValue | null>(null);
export function useMcpReconnect() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error("useMcpReconnect must be used within MCPConnectionManager");
  }
  return context.reconnectMcpServer;
}
export function useMcpToggleEnabled() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error("useMcpToggleEnabled must be used within MCPConnectionManager");
  }
  return context.toggleMcpServer;
}
interface MCPConnectionManagerProps {
  children: ReactNode;
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined;
  isStrictMcpConfig: boolean;
}

export function MCPConnectionManager({
    children,
    dynamicMcpConfig,
    isStrictMcpConfig,
  }: MCPConnectionManagerProps) {
  const {
    reconnectMcpServer,
    toggleMcpServer,
    setMcpServersEnabled,
  } = useManageMCPConnections(dynamicMcpConfig, isStrictMcpConfig);

  useEffect(
    () => registerMcpDesiredStateHandler(setMcpServersEnabled),
    [setMcpServersEnabled],
  );

  const value = useMemo<MCPConnectionContextValue>(
    () => ({
      reconnectMcpServer,
      toggleMcpServer,
    }),
    [reconnectMcpServer, toggleMcpServer],
  );

  return <MCPConnectionContext.Provider value={value}>{children}</MCPConnectionContext.Provider>;
}
