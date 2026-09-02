/**
 * Anthropic personal and service-account keys can span multiple workspaces.
 * Anthropic requires those identity-linked keys to select a workspace on every
 * inference and discovery request with the `anthropic-workspace-id` header.
 */

export const ANTHROPIC_WORKSPACE_ENV_KEY = 'ANTHROPIC_WORKSPACE_ID'

const ANTHROPIC_WORKSPACE_ID_PATTERN = /^wrkspc_[A-Za-z0-9]+$/u

export function isAnthropicWorkspaceId(value: string): boolean {
  return ANTHROPIC_WORKSPACE_ID_PATTERN.test(value.trim())
}

export function validateAnthropicWorkspaceId(
  value: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = value.trim()
  if (!isAnthropicWorkspaceId(trimmed)) {
    return {
      ok: false,
      message:
        'Anthropic workspace IDs start with "wrkspc_". Find the ID in Claude Console → Settings → Workspaces.',
    }
  }
  return { ok: true, value: trimmed }
}

export function resolveAnthropicWorkspaceId(
  configured: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = configured?.trim() || env[ANTHROPIC_WORKSPACE_ENV_KEY]?.trim()
  if (!raw) return undefined
  const validated = validateAnthropicWorkspaceId(raw)
  if (validated.ok === false) {
    throw new Error(
      `${configured?.trim() ? 'provider.anthropic.workspaceId' : ANTHROPIC_WORKSPACE_ENV_KEY} is invalid. ${validated.message}`,
    )
  }
  return validated.value
}

export function anthropicWorkspaceHeaders(
  configured: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const workspaceId = resolveAnthropicWorkspaceId(configured, env)
  return workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}
}

export function isAnthropicWorkspaceRequiredError(message: string): boolean {
  return /anthropic-workspace-id is required|identity-linked API key/iu.test(message)
}

export function anthropicWorkspaceFix(): string {
  return 'Set ANTHROPIC_WORKSPACE_ID, run `ur connect anthropic-api --workspace-id wrkspc_...`, or run `ur config set anthropic.workspace_id wrkspc_...`'
}
