export type McpbUserConfigurationOption = {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file'
  title: string
  description: string
  required?: boolean
  default?: string | number | boolean | string[]
  multiple?: boolean
  sensitive?: boolean
  min?: number
  max?: number
}

export type McpbManifest = {
  name: string
  version?: string
  description?: string
  userConfig?: Record<string, McpbUserConfigurationOption>
  user_config?: Record<string, McpbUserConfigurationOption>
  server?: unknown
  mcpServers?: unknown
  [key: string]: unknown
}

type SafeParseResult =
  | { success: true; data: McpbManifest }
  | {
      success: false
      error: {
        flatten(): { fieldErrors: Record<string, string[]>; formErrors: string[] }
      }
    }

export const McpbManifestSchema = {
  safeParse(input: unknown): SafeParseResult {
    if (
      input &&
      typeof input === 'object' &&
      typeof (input as { name?: unknown }).name === 'string'
    ) {
      return { success: true, data: input as McpbManifest }
    }
    return {
      success: false,
      error: {
        flatten: () => ({
          fieldErrors: { name: ['Required string'] },
          formErrors: [],
        }),
      },
    }
  },
}

export async function getMcpConfigForManifest({
  manifest,
}: {
  manifest: McpbManifest
  extensionPath: string
  systemDirs: unknown
  userConfig: Record<string, string | number | boolean | string[]>
  pathSeparator: string
}): Promise<unknown> {
  return manifest.mcpServers ?? manifest.server ?? null
}

export async function mcpbRun(): Promise<null> {
  return null
}

export async function mcpbInstall(): Promise<null> {
  return null
}

export function validateManifest(): boolean {
  return true
}
