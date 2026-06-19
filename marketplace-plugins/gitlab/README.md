# gitlab

Drive GitLab from any UR session: review and open merge requests, triage issues,
and watch CI/CD pipelines. Backed by GitLab's official MCP server, with the
`glab` CLI as a fallback that works on any tier.

## Commands

| Command | Argument | What it does |
| --- | --- | --- |
| `/gl-mr-review` | `[mr-id \| url]` | Structured review of a merge request with a TL;DR verdict. |
| `/gl-mr-create` | `[target-branch]` | Open an MR from the current branch with a generated title and description. |
| `/gl-issues` | `[label \| query]` | Cluster, label, and prioritize open issues. |
| `/gl-pipeline` | `[branch]` | Pipeline status with a one-line cause for each failed job. |

A bundled `gitlab-workflow` skill documents the MCP transport, the `glab`
cheatsheet, token scopes, and guardrails.

## Setup

```sh
/plugin install gitlab@ur-plugins-official
```

On enable:
- **GITLAB_MCP_URL** — default `https://gitlab.com/api/v4/mcp`; set your host for
  self-managed. The MCP server authenticates via OAuth on first connect and
  requires GitLab Duo (Premium/Ultimate) with beta features enabled.
- **GITLAB_HOST** / **GITLAB_TOKEN** — for the `glab` CLI fallback, which works
  on any tier. The token is optional if you have run `glab auth login`.

The commands prefer the MCP server and fall back to `glab` when it is not
reachable, so the plugin is useful even without GitLab Duo.

## Security

The token is stored in secure storage (keychain / credentials file), never in
plaintext settings. Mutating actions — opening MRs, labeling, retrying jobs — are
proposed, not taken, unless you ask. Merging is never done automatically.
