---
name: GitHub Workflow
description: Reference for operating GitHub safely from an agent — the official MCP server toolsets, gh CLI cheatsheet, token scopes, pull-request etiquette, and guardrails. Use when reviewing or creating PRs, triaging issues, or inspecting CI on GitHub.
version: 0.1.0
---

# GitHub Workflow

Two access paths, same operations. Prefer the MCP server for structured reads;
use `gh` for quick local actions.

## Official MCP server

- Remote endpoint: `https://api.githubcopilot.com/mcp/` (hosted by GitHub).
- Auth: OAuth, or a personal access token in the `Authorization: Bearer` header.
- Toolsets gate functionality: `repos`, `issues`, `pull_requests`, `actions`,
  `code_security`. Enable only what you need.
- A read-only mode exists for review-only workflows.

## gh CLI cheatsheet

```sh
gh auth login                      # one-time, stores its own session
gh pr list / gh pr view <n>        # list / inspect PRs
gh pr diff <n>                     # unified diff for review
gh pr create -B <base> -t .. -b .. # open a PR
gh issue list --label bug          # filter issues
gh run list / gh run view <id>     # CI runs
gh release view --json tagName     # latest release
```

## Token scopes

- Fine-grained tokens: grant per-repository access and the minimum permissions
  (Contents, Pull requests, Issues, Actions) the task needs.
- Classic tokens: `repo` is broad — avoid unless required. Never use a token
  with `admin:org` for routine work.
- Tokens are write-capable. Treat them as production credentials.

## Pull-request etiquette

- One logical change per PR. A reviewer should hold it in their head.
- Title in Conventional-Commit form; body answers what, why, and how-tested.
- Review the code, not the author. Quote the line; propose the fix.
- A blocking finding is correctness or security — say so explicitly in the TL;DR.

## Guardrails

- Never force-push a protected or shared branch.
- Never merge on the user's behalf unless explicitly told to.
- Never echo a token into logs, commit messages, or PR bodies.
- Mutating actions (label, close, comment, merge) require explicit user intent;
  default to proposing them.
