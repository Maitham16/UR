# UR-Nexus release runbook

Release target:

- GitHub: `https://github.com/Maitham16/UR.git`
- npm package: `ur-agent`
- CLI binary: `ur`

## Required checks

Run from the repository root:

```bash
bun ci
bun run dependencies:audit
bun test
bun run typecheck
bun run lint
bun run build
bun run release:check
node ./bin/ur.js --version
node ./bin/ur.js --help
node ./bin/ur.js upgrade
npm pack --dry-run
npm publish --dry-run
```

If publishing or attaching a source archive, verify the actual zip artifact
before release:

```bash
bun run release:create-source-zip
bun run release:check-source-zip -- artifacts/source/ur-nexus-$(node -p "require('./package.json').version")-source.zip
```

The source zip must contain source inputs such as `package.json`, `bun.lock`,
`src/`, `bin/`, `scripts/`, `README.md`, `CHANGELOG.md`, and `SECURITY.md`,
and must not contain local dependencies, runtime binaries, env files, logs,
caches, test output folders, temp files, or nested archives.

Also verify:

```bash
git remote -v
npm whoami
npm view ur-agent@$(node -p "require('./package.json').version") version
```

Before committing a release, verify the public docs match the current feature
set and version:

```bash
rg -n "Version [0-9]|expected: [0-9]|UR-Nexus v[0-9]" README.md docs documentation
bun test test/docsCoverage.test.ts test/docsCommands.test.ts
```

Version bump checklist (all versioned release surfaces must move together):

1. `package.json` `version`
2. `bunfig.toml` `MACRO.VERSION`
3. `documentation/index.html` version eyebrow
4. `extensions/vscode-ur-inline-diffs/package.json` and its lockfile version
   fields (the VSIX test requires them to match the root package version)
5. `extensions/jetbrains-ur/build.gradle.kts` `version`
6. Add a `CHANGELOG.md` entry, then run `bun run build` so `dist/cli.js`
   embeds the new version (`bun run release:check` verifies all of this).

If `npm whoami` fails, run:

```bash
npm login
```

Do not publish if the package version already exists on npm.

## Publish

Only after every check passes and the working tree is clean:

```bash
git add .
git commit -m "chore: polish UR-Nexus production release"
git push origin master
npm publish
```

If the remote default branch is not `master`, push the checked-out release
branch instead.
