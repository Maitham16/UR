# Compressed Task Context

Entries: 3
Updated: 2026-06-30T04:21:11.864Z

## Decisions
- 2026-06-30T04:21:03.610Z: Version bumps follow semver: patch for fixes/docs, minor for features, major for breaking. After every task that changes product behavior or docs, bump package.json/bunfig.toml, rebuild dist/cli.js, update README/docs/CHANGELOG/upgrade notes, and run release:check.

## Constraints
- 2026-06-30T04:21:05.888Z: Must keep documentation set consistent: root README, CHANGELOG, QUALITY.md, docs/*.md, documentation/index.html+app.js+README.md, examples, and extension/marketplace docs when affected.

## Commands
- 2026-06-30T04:21:07.352Z: Release gate: bun run typecheck; bun test; bun run bundle; bun run smoke; bun run secrets:scan; bun run release:check; npm pack --dry-run

## Diffs
- none

## Notes
- none
