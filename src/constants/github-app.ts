export const PR_TITLE = 'Add UR GitHub Workflow'

export const GITHUB_ACTION_SETUP_DOCS_URL =
  'https://github.com/Maitham16/UR-mapek'

export const WORKFLOW_CONTENT = `name: UR

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  ur:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@ur')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@ur')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@ur')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@ur') || contains(github.event.issue.title, '@ur')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
      actions: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run UR
        id: ur
        uses: Maitham16/UR-mapek@v1
        with:
          ur_api_key: \${{ secrets.UR_API_KEY }}

          additional_permissions: |
            actions: read

`

export const PR_BODY = `## Installing UR GitHub App

This PR adds a GitHub Actions workflow that enables UR integration in our repository.

### What is UR?

[UR](https://github.com/Maitham16/UR-mapek) is a terminal coding agent that can help with:
- Bug fixes and improvements
- Documentation updates
- Implementing new features
- Code reviews and suggestions
- Writing tests
- And more!

### How it works

Once this PR is merged, we'll be able to interact with UR by mentioning @ur in a pull request or issue comment.
Once the workflow is triggered, UR will analyze the comment and surrounding context, and execute on the request in a GitHub action.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- **@ur mentions won't work until after the merge is complete**
- The workflow runs automatically whenever UR is mentioned in PR or issue comments
- UR gets access to the entire PR or issue context including files, diffs, and previous comments

### Security

- The API key is securely stored as a GitHub Actions secret
- Only users with write access to the repository can trigger the workflow
- All UR runs are stored in the GitHub Actions run history
- UR's default tools are limited to reading/writing files and interacting with our repo by creating comments, branches, and commits.
- We can add more allowed tools by adding them to the workflow file like:

\`\`\`
allowed_tools: Bash(npm install),Bash(npm run build),Bash(npm run lint),Bash(npm run test)
\`\`\`

There's more information in the [UR repository](https://github.com/Maitham16/UR-mapek).

After merging this PR, let's try mentioning @ur in a comment on any PR to get started!`

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
        uses: Maitham16/UR-mapek@v1
        with:
          ur_api_key: \${{ secrets.UR_API_KEY }}
          plugin_marketplaces: 'https://github.com/Maitham16/UR-mapek.git'
          plugins: 'code-review@ur-plugins'
          prompt: '/code-review:code-review \${{ github.repository }}/pull/\${{ github.event.pull_request.number }}'

`
