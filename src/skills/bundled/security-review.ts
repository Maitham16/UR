import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const SECURITY_REVIEW_PROMPT = `# Security Review Skill

Audit code for security issues in an isolated worktree. Fix only what is safe and low-risk. Escalate high-risk or architectural issues to the user with evidence.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" and model "route: strong" to create a fresh git worktree and branch named "ur/security-<timestamp>-<slug>". This task needs a strong model for security analysis.
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
4. For medium+ risk or architectural changes, describe the issue, affected path, and recommended remediation instead of changing behavior unilaterally.

## Verification

1. Run focused tests and linters for each applied fix.
2. If any fix changes behavior, add or update tests.
3. Keep all fixes local in the worktree.

## Finish

1. Use AskUserQuestion to ask whether the user wants the full verification suite run.
2. Run it only if approved; otherwise report the focused evidence.
3. Do not commit, push, or open a PR unless separately requested.

Return a concise summary: branch name, findings, fixes, deferred issues, and verification evidence.
`

export function registerSecurityReviewSkill(): void {
  registerBundledSkill({
    name: 'security-review',
    aliases: ['secure-review', 'sec-review'],
    description:
      'Audit code for security issues in an isolated worktree, fix low-risk issues, and report findings.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'TestRunner', 'AskUserQuestion'],
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
