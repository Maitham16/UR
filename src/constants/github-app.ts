import { stringify as stringifyYaml } from 'yaml'
import {
  compileAgenticCiWorkflow,
  defaultAgenticCiSpec,
} from '../services/agents/agenticCi.js'

export const PR_TITLE = 'Add UR GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://github.com/Maitham16/UR'

const urVersion =
  typeof MACRO !== 'undefined' ? MACRO.VERSION : '1.50.2'

export const WORKFLOW_CONTENT = compileAgenticCiWorkflow('default', {
  packageVersion: urVersion,
})

/**
 * `ur agent-ci run` resolves its policy from the repository, so the installer
 * has to commit the spec next to the workflow. Without it every run aborts
 * with "Spec not found" before the agent starts.
 */
export const AGENTIC_CI_SPEC_PATH = '.ur/agentic-ci/default.yaml'

export const AGENTIC_CI_SPEC_CONTENT = stringifyYaml(
  defaultAgenticCiSpec('default'),
)

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

Once this PR is merged, trusted collaborators can summon UR by writing \`@ur\` followed by a task:

- an issue comment or pull-request comment
- an inline review comment on a diff
- a submitted pull-request review
- the body or title of a new issue

UR reacts with 👀, posts a tracking comment, works in an isolated checkout, and
then edits that comment with the summary, verification results, and the proposed
patch. The legacy \`/ur\` form still works.

### Files in this PR

- \`.github/workflows/ur.yml\` — the workflow
- \`.ur/agentic-ci/default.yaml\` — the policy spec that governs the run

Edit the spec to change the keyword, the trusted associations, which events are
allowed, the verification commands, or the writable path allowlist.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- Event text is passed as data, never interpolated into shell source
- \`@urgent\` and mentions inside code fences or quoted replies do not trigger a run

### Security

- The API key is securely stored as a GitHub Actions secret
- Only owners, members, and collaborators can trigger runs
- All UR runs are stored in the GitHub Actions run history
- The job that reads untrusted comment text holds **no write token**. It runs in
  a detached worktree and emits a bounded, hash-addressed patch artifact
- A separate publisher job holds the write scopes and only ever consumes that
  artifact, so untrusted input and write access never share a job
- Opening pull requests is opt-in: set \`publish.mode: pull-request\` in the spec

There's more information in the [UR repository](https://github.com/Maitham16/UR).

After merging this PR, try \`@ur investigate this\` in a comment to get started.`

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
