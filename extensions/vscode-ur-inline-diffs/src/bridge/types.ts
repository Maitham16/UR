// Shared bridge types. Mirrors src/services/agents/ideDiffs.ts (IdeDiffBundle)
// so the extension never invents its own status vocabulary.

export type IdeDiffStatus = 'pending' | 'commented' | 'approved' | 'rejected'

export interface DiffComment {
  at: string
  file?: string
  line?: number
  text: string
}

export interface DiffFileChange {
  path: string
  additions: number
  deletions: number
}

/** 1:1 with IdeDiffBundle in src/services/agents/ideDiffs.ts. */
export interface DiffArtifact {
  id: string
  title: string
  status: IdeDiffStatus
  baseRef?: string
  staged?: boolean
  patchFile: string
  metadataFile: string
  files: DiffFileChange[]
  comments: DiffComment[]
  createdAt: string
  updatedAt: string
}

export interface DiffManifest {
  version: number
  diffs: DiffArtifact[]
}

/**
 * Placeholder only for this PR. The full status card (acp, provider,
 * sandbox/verifier mode, warnings) lands with the agent identity panel.
 */
export interface AgentStatus {
  workspaceRoot: string
  raw: string
}
