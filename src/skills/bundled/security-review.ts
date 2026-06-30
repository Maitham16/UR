import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const SECURITY_REVIEW_PROMPT = `# Security Review Skill

Audit code for security issues in an isolated worktree. Fix only what is safe and low-risk, then open a PR. Escalate high-risk or architectural issues to the user with evidence.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" to create a fresh git worktree and branch named "ur/security-<timestamp>-<slug>".
2. Identify the target surface: file paths, entry points, dependencies, or user-facing inputs.

## Audit checklist

Focus on:

- OWASP Top 10 categories relevant to the project type (injection, XSS, auth, secrets, access control, etc.)
- Secret or credential leaks in code, logs, or config
- Unsafe shell, SQL, eval, path, or deserialization patterns
- Missing input validation or output encoding
- Overly broad permissions, unsafe defaults, or debug endpoints
- Dependency versions with known advisories (mention if found, do not auto-upgrade major versions)

## Process

1. Read the target files and related tests. Grep for dangerous patterns (exec, eval, innerHTML, dangerouslySetInnerHTML, query with string interpolation, raw file paths, etc.).
2. For each finding, rate severity (critical/high/medium/low) and explain exploitability.
3. Fix low-risk issues directly (e.g., input validation, output encoding, replacing unsafe string construction with parameterized APIs, removing debug logs with secrets).
4. For medium+ risk or architectural changes, describe the issue, affected path, and recommended remediation in the PR body instead of changing behavior unilaterally.

## Verification

1. Run the relevant tests and linters.
2. If any fix changes behavior, add or update tests.
3. Commit fixes with messages like "security(scope): validate X" or "security(scope): remove secret from log".

## PR Output

1. Push the branch.
2. Open a PR with:
   - Title: "security(scope): audit and harden X"
   - Body: scope, findings table (severity, path, note), fixes applied, deferred issues, and verification command.

Return a concise summary: branch name, commits, PR URL, and the findings overview.
`

export function registerSecurityReviewSkill(): void {
  registerBundledSkill({
    name: 'security-review',
    aliases: ['security', 'audit'],
    description:
      'Audit code for security issues in an isolated worktree, fix low-risk issues, and open a PR with findings.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner'],
    argumentHint: '[target files or area to audit]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = SECURITY_REVIEW_PROMPT
      if (args) {
        prompt += `\n\n## Audit target\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
