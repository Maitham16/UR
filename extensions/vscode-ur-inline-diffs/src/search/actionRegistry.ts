// Static registry backing the "UR: Search Actions" quick-pick. Stable ids and
// command ids so downstream tooling/tests can depend on them; adding an
// action later must not change an existing id.

export interface ActionEntry {
  id: string
  label: string
  commandId: string
  description: string
}

export const ACTION_REGISTRY: ActionEntry[] = [
  { id: 'newChat', label: 'New Chat', commandId: 'urInlineDiffs.chat.new', description: 'Start a new UR chat session' },
  { id: 'openChat', label: 'Open Chat', commandId: 'urInlineDiffs.chat.open', description: 'Open or resume a UR chat session' },
  { id: 'explainSelection', label: 'Explain Selection', commandId: 'urInlineDiffs.chat.explainSelection', description: 'Ask UR to explain the current editor selection' },
  { id: 'fixSelection', label: 'Fix Selection', commandId: 'urInlineDiffs.chat.fixSelection', description: 'Ask UR to fix the current editor selection' },
  { id: 'generateTests', label: 'Generate Tests', commandId: 'urInlineDiffs.chat.generateTests', description: 'Ask UR to generate tests for the current selection' },
  { id: 'reviewCurrentDiff', label: 'Review Current Diff', commandId: 'urInlineDiffs.reviewCurrentDiff', description: 'Send the current git diff to UR for review' },
  { id: 'runVerifier', label: 'Run Verifier', commandId: 'urInlineDiffs.runVerifier', description: 'Run the UR verifier against the current changes' },
  { id: 'providerStatus', label: 'Provider Status', commandId: 'urInlineDiffs.status', description: 'Show provider, model, and plugin status' },
  { id: 'agentStatus', label: 'Agent Status', commandId: 'urInlineDiffs.agentStatus', description: 'Open the UR agent status card' },
  { id: 'agentOptions', label: 'Agent Options', commandId: 'urInlineDiffs.agentOptions', description: 'Open curated provider recommendations' },
  { id: 'openSettings', label: 'Open Settings', commandId: 'urInlineDiffs.openSettings', description: 'Open VS Code settings filtered to UR' },
  { id: 'openDocs', label: 'Open Docs', commandId: 'urInlineDiffs.openDocs', description: 'Open the UR documentation' },
  { id: 'openArtifacts', label: 'Open Artifacts', commandId: 'urInlineDiffs.openArtifacts', description: 'Reveal the .ur workspace directory' },
  { id: 'runSpec', label: 'Run Spec', commandId: 'urInlineDiffs.runSpec', description: 'Ask UR to list and run specs (ur spec)' },
  { id: 'runWorkflow', label: 'Run Workflow', commandId: 'urInlineDiffs.runWorkflow', description: 'Ask UR to list and run workflows (ur workflow)' },
  { id: 'refreshActions', label: 'Refresh IDE Actions', commandId: 'urActions.refresh', description: 'Refresh the UR actions panel' },
]
