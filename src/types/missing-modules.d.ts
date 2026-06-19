// Ambient declarations for modules that are referenced but not present in
// this distribution. External providers (Bedrock/Vertex/Foundry/Azure) and
// optional NAPI binaries are not part of the Ollama-only build; internal
// modules listed here belong to features that were not carried over.
//
// Each declaration is intentionally permissive — `any` everywhere — because
// the importing code paths are either dead in this build, gated behind
// feature flags that are off, or dynamically optional.

declare module '@anthropic-ai/bedrock-sdk' {
  export const AnthropicBedrock: any
  const defaultExport: any
  export default defaultExport
}

declare module '@anthropic-ai/foundry-sdk' {
  export const AnthropicFoundry: any
  const defaultExport: any
  export default defaultExport
}

declare module '@anthropic-ai/vertex-sdk' {
  export const AnthropicVertex: any
  const defaultExport: any
  export default defaultExport
}

declare module '@aws-sdk/client-bedrock' {
  const value: any
  export = value
}

declare module '@aws-sdk/client-sts' {
  const value: any
  export = value
}

declare module '@aws-sdk/credential-providers' {
  const value: any
  export = value
}

declare module '@azure/identity' {
  export const DefaultAzureCredential: any
  export const getBearerTokenProvider: any
  const defaultExport: any
  export default defaultExport
}

declare module '@opentelemetry/exporter-logs-otlp-grpc' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-logs-otlp-http' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-logs-otlp-proto' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-metrics-otlp-grpc' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-metrics-otlp-http' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-metrics-otlp-proto' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-prometheus' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-trace-otlp-grpc' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-trace-otlp-http' {
  const value: any
  export = value
}

declare module '@opentelemetry/exporter-trace-otlp-proto' {
  const value: any
  export = value
}

declare module 'audio-capture-napi' {
  const value: any
  export = value
}

declare module 'cacache' {
  const value: any
  export = value
}

declare module 'cli-highlight' {
  const value: any
  export = value
}

declare module 'fflate' {
  export const unzip: any
  export const unzipSync: any
  export const zipSync: any
  export const zip: any
  const defaultExport: any
  export default defaultExport
}

declare module 'image-processor-napi' {
  export const sharp: any
  export const getNativeModule: any
  const defaultExport: any
  export default defaultExport
}

declare module 'plist' {
  const value: any
  export = value
}

declare module 'turndown' {
  const value: any
  export = value
}

declare module 'url-handler-napi' {
  const value: any
  export = value
}

declare module 'yaml' {
  export const parse: any
  export const stringify: any
  export const parseDocument: any
  const defaultExport: any
  export default defaultExport
}

declare module 'bun:bundle' {
  export function feature(flag: string): boolean
}

// Internal modules that are referenced from the leaked source but not
// shipped in this distribution. Permissive any-exports keep callers happy.

declare module 'src/cli/rollback.js' {
  const value: any
  export = value
}

declare module 'src/cli/up.js' {
  const value: any
  export = value
}

// Catch-all for any other internal module path that has no file backing it.
// These are dead-import paths in feature-gated code that does not execute.
declare module '*/assistant/index.js' {
  const value: any
  export = value
}

declare module '*/proactive/index.js' {
  const value: any
  export = value
}

declare module '*/services/compact/reactiveCompact.js' {
  const value: any
  export = value
}

declare module '*/services/compact/snipCompact.js' {
  const value: any
  export = value
}

declare module '*/services/compact/snipProjection.js' {
  const value: any
  export = value
}

declare module '*/services/compact/cachedMCConfig.js' {
  const value: any
  export = value
}

declare module '*/services/contextCollapse/index.js' {
  const value: any
  export = value
}

declare module '*/services/contextCollapse/operations.js' {
  const value: any
  export = value
}

declare module '*/services/contextCollapse/persist.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/featureCheck.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/localSearch.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/prefetch.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/remoteSkillLoader.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/remoteSkillState.js' {
  const value: any
  export = value
}

declare module '*/services/skillSearch/telemetry.js' {
  const value: any
  export = value
}

declare module '*/services/sessionTranscript/sessionTranscript.js' {
  const value: any
  export = value
}

declare module '*/sessionTranscript/sessionTranscript.js' {
  const value: any
  export = value
}

declare module '*/skills/mcpSkills.js' {
  const value: any
  export = value
}

declare module '*/tools/ReviewArtifactTool/ReviewArtifactTool.js' {
  const value: any
  export = value
}

declare module '*/tools/TerminalCaptureTool/prompt.js' {
  const value: any
  export = value
}

declare module '*/tools/VerifyPlanExecutionTool/constants.js' {
  const value: any
  export = value
}

declare module '*/tools/WorkflowTool/WorkflowPermissionRequest.js' {
  const value: any
  export = value
}

declare module '*/tools/WorkflowTool/createWorkflowCommand.js' {
  const value: any
  export = value
}

declare module '*/tools/SendUserFileTool/prompt.js' {
  const value: any
  export = value
}

declare module '*/tools/SnipTool/prompt.js' {
  const value: any
  export = value
}

declare module '*/tools/WebBrowserTool/WebBrowserPanel.js' {
  const value: any
  export = value
}

declare module '*/tools/DiscoverSkillsTool/prompt.js' {
  const value: any
  export = value
}

declare module '*/utils/attributionHooks.js' {
  const value: any
  export = value
}

declare module '*/utils/systemThemeWatcher.js' {
  const value: any
  export = value
}

declare module '*/utils/udsClient.js' {
  const value: any
  export = value
}

declare module '*/utils/ccshareResume.js' {
  const value: any
  export = value
}

declare module '*/utils/eventLoopStallDetector.js' {
  const value: any
  export = value
}

declare module '*/utils/sdkHeapDumpMonitor.js' {
  const value: any
  export = value
}

declare module '*/utils/sessionDataUploader.js' {
  const value: any
  export = value
}

declare module '*/utils/taskSummary.js' {
  const value: any
  export = value
}

declare module '*/utils/udsMessaging.js' {
  const value: any
  export = value
}

declare module '*/bridge/peerSessions.js' {
  const value: any
  export = value
}

declare module '*/bridge/webhookSanitizer.js' {
  const value: any
  export = value
}

declare module '*/coordinator/workerAgent.js' {
  const value: any
  export = value
}

declare module '*/compact/cachedMicrocompact.js' {
  const value: any
  export = value
}

declare module '*/cachedMicrocompact.js' {
  const value: any
  export = value
}

declare module '*/components/FeedbackSurvey/useFrustrationDetection.js' {
  const value: any
  export = value
}

declare module '*/components/AgentMdExternalIncludesDialog.js' {
  const value: any
  export = value
}

declare module '*/components/agents/SnapshotUpdateDialog.js' {
  const value: any
  export = value
}

declare module '*/AgentMdExternalIncludesDialog.js' {
  const value: any
  export = value
}

declare module '*/MonitorMcpDetailDialog.js' {
  const value: any
  export = value
}

declare module '*/MonitorPermissionRequest/MonitorPermissionRequest.js' {
  const value: any
  export = value
}

declare module '*/ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.js' {
  const value: any
  export = value
}

declare module '*/UserCrossSessionMessage.js' {
  const value: any
  export = value
}

declare module '*/UserForkBoilerplateMessage.js' {
  const value: any
  export = value
}

declare module '*/UserGitHubWebhookMessage.js' {
  const value: any
  export = value
}

declare module '*/WorkflowDetailDialog.js' {
  const value: any
  export = value
}

declare module '*/SnipBoundaryMessage.js' {
  const value: any
  export = value
}

declare module '*/hooks/notifs/useAntOrgWarningNotification.js' {
  const value: any
  export = value
}

declare module '*/jobs/classifier.js' {
  const value: any
  export = value
}

declare module '*/memdir/memoryShapeTelemetry.js' {
  const value: any
  export = value
}

declare module '*/memoryShapeTelemetry.js' {
  const value: any
  export = value
}

declare module '*/cli/bg.js' {
  const value: any
  export = value
}

declare module '*/cli/handlers/templateJobs.js' {
  const value: any
  export = value
}

declare module '*/cli/handlers/ant.js' {
  const value: any
  export = value
}

declare module '*/daemon/main.js' {
  const value: any
  export = value
}

declare module '*/daemon/workerRegistry.js' {
  const value: any
  export = value
}

declare module '*/environment-runner/main.js' {
  const value: any
  export = value
}

declare module '*/self-hosted-runner/main.js' {
  const value: any
  export = value
}

declare module '*/commands/assistant/assistant.js' {
  const value: any
  export = value
}

declare module '*/commands/buddy/index.js' {
  const value: any
  export = value
}

declare module '*/commands/fork/index.js' {
  const value: any
  export = value
}

declare module '*/commands/peers/index.js' {
  const value: any
  export = value
}

declare module '*/commands/workflows/index.js' {
  const value: any
  export = value
}

declare module '*/assistant/AssistantSessionChooser.js' {
  const value: any
  export = value
}

declare module '*/assistant/gate.js' {
  const value: any
  export = value
}

declare module '*/attributionTrailer.js' {
  const value: any
  export = value
}

declare module '*/devtools.js' {
  const value: any
  export = value
}

declare module '*/postCommitAttribution.js' {
  const value: any
  export = value
}

declare module '*/protectedNamespace.js' {
  const value: any
  export = value
}

declare module '*/udsClient.js' {
  const value: any
  export = value
}

declare module '*/server/backends/dangerousBackend.js' {
  const value: any
  export = value
}

declare module '*/server/connectHeadless.js' {
  const value: any
  export = value
}

declare module '*/server/lockfile.js' {
  const value: any
  export = value
}

declare module '*/server/parseConnectUrl.js' {
  const value: any
  export = value
}

declare module '*/server/server.js' {
  const value: any
  export = value
}

declare module '*/server/serverBanner.js' {
  const value: any
  export = value
}

declare module '*/server/serverLog.js' {
  const value: any
  export = value
}

declare module '*/server/sessionManager.js' {
  const value: any
  export = value
}

// MACRO constants injected at build time by Bun's --define.
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string | undefined
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG: string
}
