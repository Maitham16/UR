# engineering-discipline

Reference plugin for UR's marketplace extensibility.

It demonstrates how a marketplace plugin can add more than a slash command:

- command: `/discipline-check`
- skill: `engineering-discipline:reproducible-release`
- agent template: `release-verifier`
- validator: `release-gate`
- language adapter: Markdown/MDX through an LSP declaration

## Install

```sh
/plugin install engineering-discipline@ur-plugins-official
```

The validator is intentionally conservative and mirrors the release gate used
for production readiness. The language adapter only activates when the matching
Markdown language server is installed locally.
