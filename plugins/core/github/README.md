# github

Drive GitHub from any UR session: review and open pull requests, triage issues,
and check repository health. Backed by GitHub's official remote MCP server, with
the `gh` CLI as a fallback.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/gh-pr-review` | `[pr-number \| url]` | Structured review of a PR with a TL;DR verdict. |
| `/gh-pr-create` | `[base-branch]` | Open a PR from the current branch with a generated title and body. |
| `/gh-issues` | `[label \| query]` | Cluster, label, and prioritize open issues. |
| `/gh-repo-health` | `[owner/repo]` | One-screen snapshot of PRs, issues, CI, and releases. |

A bundled `github-workflow` skill documents toolsets, the `gh` cheatsheet, token
scopes, and guardrails.

## Setup

```sh
/plugin install github@ur-plugins-official
```

On enable, set **GITHUB_TOKEN** — a fine-grained or classic personal access
token for the official MCP server (`https://api.githubcopilot.com/mcp/`). Scope
it to the repositories and toolsets you want UR to reach.

The `gh` CLI uses its own `gh auth login` session and does not read this token;
the commands work through whichever path is available.

## Security

The token is stored in secure storage (keychain / credentials file), never in
plaintext settings. Mutating actions — opening PRs, labeling, closing — are
proposed, not taken, unless you ask for them. Force-pushing protected branches
and merging are never done automatically.
