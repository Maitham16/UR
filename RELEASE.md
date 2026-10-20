# UR-Nexus release runbook

Release target:

- GitHub: `https://github.com/Maitham16/UR.git`
- npm package: `ur-agent`
- CLI binary: `ur`

## Standalone artifacts

Native releases are built on five matching OS/CPU runners and contain the
executable, runtime, and a versioned resource tree. `native.yml` tests the exact
archived payload with Node, npm, and Bun absent from PATH, including real image,
search, compiler-library, task/write/read, streaming, timeout, and resume checks.
The release publishes no npm package or GitHub release until the native matrix
and existing verification gate succeed for the same immutable tag.

On a matching local development host:

```sh
bun ci
npm --prefix extensions/vscode-ur-inline-diffs ci
npm --prefix extensions/vscode-ur-inline-diffs run build
bun run native:build
bun run native:pack
bun run native:smoke -- --artifact-dir dist-release/native
```

Keep native output in ignored `dist-native/` and `dist-release/`. The GitHub
release includes all target archives, merged `manifest.json`, `SHA256SUMS`,
install/uninstall scripts, and build-provenance attestations. All manifests
must identify the exact source commit. Channel selection uses GitHub's latest
non-prerelease release; a failed qualification must never advance it.

OS signing uses configured Apple/Windows publisher credentials. An incomplete
signing configuration fails; absent credentials produce an explicit unsigned
status in `resources/signing.json`. Never claim an unsigned artifact is signed
or notarized. See [native installation](docs/NATIVE_INSTALL.md) for verification,
platform support, recovery, and user-facing install commands.

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

Run the repository-owned bump script so dependency ranges cannot be changed by
an accidental text replacement:

```bash
node scripts/version-bump.mjs <next-version>
```

Version bump checklist (all versioned release surfaces must move together):

1. `package.json` `version`
2. `bunfig.toml` `MACRO.VERSION`
3. `documentation/index.html` version eyebrow and the expected version in
   `docs/VALIDATION.md`
4. `extensions/vscode-ur-inline-diffs/package.json` and its lockfile version
   fields (the VSIX test requires them to match the root package version)
5. `extensions/jetbrains-ur/build.gradle.kts` `version`
6. The `MACRO.VERSION` fallbacks in `src/commands/agent-ci/agent-ci.ts`,
   `src/services/agents/agenticCi.ts`, and
   `src/services/agents/featureScaffolds.ts`, and
   `src/services/agents/trends.ts`
7. Add a `CHANGELOG.md` entry, then run `bun run build` so `dist/cli.js`
   embeds the new version (`bun run release:check` verifies all of this).

If `npm whoami` fails, run:

```bash
npm login
```

Do not publish if the package version already exists on npm.

## Publish

GitHub Actions publishes the exact tarball that passes the release workflow.
Do not run `npm publish` separately and do not create a tag before the release
commit is on the remote branch.

Configure npm trusted publishing for package `ur-agent` before tagging a version
that is not already published. In npm package settings, select GitHub Actions
with owner `Maitham16`, repository `UR`, workflow `release.yml`, no environment,
and allow `npm publish`. The publish job uses GitHub OIDC (`id-token: write`), so
it needs no long-lived `NPM_TOKEN` and cannot stall on interactive 2FA. The
GitHub Release waits for npm publication, preventing a registry authentication
failure from creating a new partial GitHub-only release. Treat a failed publish
as a release blocker; fix trusted-publisher configuration and dispatch the same
immutable tag rather than publishing manually.
The npm publish step uses `./dist-release/<tarball>.tgz`: the explicit relative
path marker prevents npm from interpreting the artifact name as GitHub
`owner/repository` shorthand.

If an immutable tag failed only during publication, fix the trusted-publisher
configuration and retry that tag through the default branch workflow:

```bash
gh workflow run release.yml -f tag=v$(node -p "require('./package.json').version")
```

Do not move or recreate the tag. Once OIDC publication succeeds, the workflow
updates or creates the matching GitHub Release from the verified tarball.
After a successful migration, remove the obsolete `NPM_TOKEN` repository secret
and revoke that npm token so CI has no dormant long-lived publish credential.

Only after every check passes, commit the complete release and push it:

```bash
git add .
git commit -m "chore: polish UR-Nexus production release"
git push origin master
```

Wait for the `Test Production` workflow on that commit to pass. Then use the
guarded tag command; its default mode is a read-only preflight:

```bash
bun run release:tag
bun run release:tag -- --push
```

The command refuses to tag a dirty tree, an uncommitted version, a commit that
is not yet the remote branch tip, a mismatched changelog, or a local/remote tag
that already exists. `--push` creates one annotated immutable tag pointing at
the verified commit. That tag starts `.github/workflows/release.yml`, which
rebuilds and verifies the package, publishes the GitHub Release, and publishes
the same verified tarball to npm.

If a tag was accidentally pushed from the wrong commit, keep it as failed
release history and bump to a fresh patch version. Do not move a published tag.
If the remote default branch is not `master`, push the checked-out release
branch instead; the tag command verifies that branch by name.
