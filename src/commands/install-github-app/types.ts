// Permissive shapes for the /install-github-app multi-step flow.
// Concrete fields are added by the steps that produce them; everything
// downstream just reads strings + booleans.

export type Workflow = 'ur' | 'ur-review'

export interface State {
  repoName?: string
  apiKeyOrOAuthToken?: string
  secretName?: string
  selectedWorkflows?: Workflow[]
  useExistingSecret?: boolean
  secretExists?: boolean
  workflowExists?: boolean
  [key: string]: any
}

export interface Warning {
  message: string
  severity?: 'info' | 'warning' | 'error'
  errorInstructions?: string[]
  errorReason?: string
  [key: string]: any
}
