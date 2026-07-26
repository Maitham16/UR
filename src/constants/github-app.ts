import { compileAgenticCiWorkflow } from '../services/agents/agenticCi.js'

export const PR_TITLE = 'Add UR GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://github.com/Maitham16/UR'

const urVersion =
  typeof MACRO !== 'undefined' ? MACRO.VERSION : '1.48.0'

export const WORKFLOW_CONTENT = compileAgenticCiWorkflow('default', {
  packageVersion: urVersion,
})

export const PR_BODY = `## Installing UR GitHub App

This PR adds a GitHub Actions workflow that enables UR integration in our repository.

### What is UR?

[UR](https://github.com/Maitham16/UR) is a terminal coding agent that can help with:
- Bug fixes and improvements
- Documentation updates
- Implementing new features
- Code reviews and suggestions
- Writing tests
- And more!

### How it works

Once this PR is merged, trusted collaborators can interact with UR by using \`/ur\` in an issue or pull-request comment.
Once the workflow is triggered, UR will analyze the comment and surrounding context, and execute on the request in a GitHub action.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- The workflow runs for manual dispatches and trusted issue comments containing \`/ur\`
- Event text is passed as data, never interpolated into shell source

### Security

- The API key is securely stored as a GitHub Actions secret
- Only owners, members, and collaborators can trigger comment runs
- All UR runs are stored in the GitHub Actions run history
- The agent receives read-only GitHub permissions, runs in a detached worktree,
  and emits a bounded hash-addressed patch artifact for trusted review

There's more information in the [UR repository](https://github.com/Maitham16/UR).

After merging this PR, try \`/ur investigate this\` in a comment to get started.`

// Keep the opt-in PR review plugin workflow distinct from Agentic CI. It has a
// different trigger and action contract and must not create a second /ur job.
export const CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT = `name: UR Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

jobs:
  ur-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run UR Review
        id: ur-review
        uses: Maitham16/UR@v1
        with:
          ur_api_key: \${{ secrets.UR_API_KEY }}
          plugin_marketplaces: 'https://github.com/Maitham16/UR.git'
          plugins: 'code-review@ur-plugins-official'
          prompt: '/code-review:code-review \${{ github.repository }}/pull/\${{ github.event.pull_request.number }}'

`
