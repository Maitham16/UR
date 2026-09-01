import { feature } from 'bun:bundle'
import React from 'react'
import { AskUserQuestionPermissionRequest } from './AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.js'
import { BashPermissionRequest } from './BashPermissionRequest/BashPermissionRequest.js'
import { EnterPlanModePermissionRequest } from './EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.js'
import { ExitPlanModePermissionRequest } from './ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js'
import { FallbackPermissionRequest } from './FallbackPermissionRequest.js'
import { FileEditPermissionRequest } from './FileEditPermissionRequest/FileEditPermissionRequest.js'
import { FilesystemPermissionRequest } from './FilesystemPermissionRequest/FilesystemPermissionRequest.js'
import { FileWritePermissionRequest } from './FileWritePermissionRequest/FileWritePermissionRequest.js'
import { NotebookEditPermissionRequest } from './NotebookEditPermissionRequest/NotebookEditPermissionRequest.js'
import { PowerShellPermissionRequest } from './PowerShellPermissionRequest/PowerShellPermissionRequest.js'
import { SkillPermissionRequest } from './SkillPermissionRequest/SkillPermissionRequest.js'
import { WebFetchPermissionRequest } from './WebFetchPermissionRequest/WebFetchPermissionRequest.js'
import type { PermissionRequestProps } from './PermissionRequest.js'

/** Stable, serializable selector used by Tool definitions without UI imports. */
export type ToolPermissionRequestKind =
  | 'ask-user-question'
  | 'bash'
  | 'enter-plan-mode'
  | 'exit-plan-mode'
  | 'fallback'
  | 'file-edit'
  | 'file-write'
  | 'filesystem'
  | 'notebook-edit'
  | 'monitor'
  | 'powershell'
  | 'review-artifact'
  | 'skill'
  | 'web-fetch'
  | 'workflow'

const PERMISSION_COMPONENTS: Partial<Record<
  ToolPermissionRequestKind,
  React.ComponentType<PermissionRequestProps>
>> = {
  'ask-user-question': AskUserQuestionPermissionRequest,
  bash: BashPermissionRequest,
  'enter-plan-mode': EnterPlanModePermissionRequest,
  'exit-plan-mode': ExitPlanModePermissionRequest,
  fallback: FallbackPermissionRequest,
  'file-edit': FileEditPermissionRequest,
  'file-write': FileWritePermissionRequest,
  filesystem: FilesystemPermissionRequest,
  'notebook-edit': NotebookEditPermissionRequest,
  powershell: PowerShellPermissionRequest,
  skill: SkillPermissionRequest,
  'web-fetch': WebFetchPermissionRequest,
}

/* eslint-disable @typescript-eslint/no-require-imports */
const ReviewArtifactTool = feature('REVIEW_ARTIFACT')
  ? (
      require('../../tools/ReviewArtifactTool/ReviewArtifactTool.js') as typeof import('../../tools/ReviewArtifactTool/ReviewArtifactTool.js')
    ).ReviewArtifactTool
  : null
const ReviewArtifactPermissionRequest = feature('REVIEW_ARTIFACT')
  ? (
      require('./ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.js') as typeof import('./ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.js')
    ).ReviewArtifactPermissionRequest
  : null
const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? (
      require('../../tools/WorkflowTool/WorkflowTool.js') as typeof import('../../tools/WorkflowTool/WorkflowTool.js')
    ).WorkflowTool
  : null
const WorkflowPermissionRequest = feature('WORKFLOW_SCRIPTS')
  ? (
      require('../../tools/WorkflowTool/WorkflowPermissionRequest.js') as typeof import('../../tools/WorkflowTool/WorkflowPermissionRequest.js')
    ).WorkflowPermissionRequest
  : null
const MonitorTool = feature('MONITOR_TOOL')
  ? (
      require('../../tools/MonitorTool/MonitorTool.js') as typeof import('../../tools/MonitorTool/MonitorTool.js')
    ).MonitorTool
  : null
const MonitorPermissionRequest = feature('MONITOR_TOOL')
  ? (
      require('./MonitorPermissionRequest/MonitorPermissionRequest.js') as typeof import('./MonitorPermissionRequest/MonitorPermissionRequest.js')
    ).MonitorPermissionRequest
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

const OPTIONAL_PERMISSION_COMPONENTS: Partial<
  Record<ToolPermissionRequestKind, React.ComponentType<PermissionRequestProps>>
> = {
  monitor: MonitorPermissionRequest ?? undefined,
  'review-artifact': ReviewArtifactPermissionRequest ?? undefined,
  workflow: WorkflowPermissionRequest ?? undefined,
}

/** Compatibility selector for feature-gated tools whose sources are injected at build time. */
export function permissionRequestKindForTool(
  tool: unknown,
): ToolPermissionRequestKind | undefined {
  if (tool === ReviewArtifactTool) return 'review-artifact'
  if (tool === WorkflowTool) return 'workflow'
  if (tool === MonitorTool) return 'monitor'
  return undefined
}

/**
 * Render a permission request selected by a Tool's declared presentation.
 * Unknown tools never disappear: `buildTool` always selects `fallback`.
 */
export function renderToolPermissionRequest(
  kind: ToolPermissionRequestKind,
  props: PermissionRequestProps,
): React.ReactNode {
  const component =
    PERMISSION_COMPONENTS[kind] ??
    OPTIONAL_PERMISSION_COMPONENTS[kind] ??
    FallbackPermissionRequest
  return React.createElement(component, props)
}
