# marketplace-plugins/

First-party plugins for the **ur-plugins-official** marketplace.

Each subdirectory here is a self-contained plugin. The marketplace
manifest at `.ur-plugin/marketplace.json` (at the repo root) lists which of
them are published.

## Shipped plugins

| Plugin | Slash command | What it does |
| --- | --- | --- |
| [`hello`](./hello) | `/hello [name]` | Example greeting. Use as a template. |
| [`git-summary`](./git-summary) | `/git-summary` | One-paragraph factual summary of the working tree and recent commits. |
| [`code-review`](./code-review) | `/code-review [base-ref]` | Structured review of the working diff. Correctness, style, test coverage, security, TL;DR verdict. |
| [`explain-error`](./explain-error) | `/explain-error [command]` | Re-runs a failing command and decodes the error in plain English with two next steps. |
| [`release-notes`](./release-notes) | `/release-notes [since-ref]` | Drafts release notes grouped by Features / Fixes / Documentation / Other since the last tag. |
| [`evaluate-response`](./evaluate-response) | `/evaluate-response` | Adversarial self-evaluation of the most recent assistant turn. |

## Adding a new plugin

1. Copy `hello/` to a new directory, e.g. `marketplace-plugins/my-plugin/`.
2. Edit `my-plugin/.ur-plugin/plugin.json` with the plugin's real metadata.
3. Replace the example command in `my-plugin/commands/` with your own.
4. Add an entry to `.ur-plugin/marketplace.json` (sibling to existing
   entries).
5. Open a PR against `Maitham16/ur-agent`.

See [`hello/README.md`](./hello/README.md) for the smallest possible example.

## Schemas

The shapes for `marketplace.json` and `plugin.json` are defined in the
agent source — see `src/utils/plugins/schemas.ts` (`PluginMarketplaceSchema`
and `PluginManifestSchema`). The schemas are strict-by-default but
unknown fields on marketplace entries are silently stripped so future
versions stay forward-compatible.
